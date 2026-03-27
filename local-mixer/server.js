import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const HTTP_PORT = Number(process.env.LOCAL_MIXER_PORT || 17777);
const WS_PORT = Number(process.env.LOCAL_MIXER_WS_PORT || 17778);
const SAMPLE_RATE = 48000;
const FRAMES_PER_BUFFER = 480;
let portAudio = null;
let audioModuleError = "";

let in1 = null;
let in2 = null;
let q1 = Buffer.alloc(0);
let q2 = Buffer.alloc(0);
let current = { active: false, mic1: null, mic2: null };

const wss = new WebSocketServer({ port: WS_PORT });
const peers = new Set();
wss.on("connection", (ws) => {
  peers.add(ws);
  ws.on("close", () => peers.delete(ws));
});

function broadcastMixed(buf) {
  peers.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(buf);
  });
}

async function ensureAudioModule() {
  if (portAudio) return portAudio;
  try {
    const mod = await import("naudiodon");
    portAudio = mod.default || mod;
    return portAudio;
  } catch (err) {
    audioModuleError = err?.message || "Could not load naudiodon";
    throw new Error(
      `Local mixer audio module missing. Run: npm --prefix local-mixer install naudiodon@latest (${audioModuleError})`
    );
  }
}

function stopCapture() {
  if (in1) {
    in1.quit();
    in1 = null;
  }
  if (in2) {
    in2.quit();
    in2 = null;
  }
  q1 = Buffer.alloc(0);
  q2 = Buffer.alloc(0);
  current = { active: false, mic1: null, mic2: null };
}

function mixAndFlush() {
  const bytesPerSample = 2;
  const n = Math.min(q1.length, q2.length);
  const evenN = n - (n % bytesPerSample);
  if (evenN <= 0) return;

  const out = Buffer.allocUnsafe(evenN);
  for (let i = 0; i < evenN; i += 2) {
    const s1 = q1.readInt16LE(i);
    const s2 = q2.readInt16LE(i);
    let mixed = (s1 + s2) >> 1;
    if (mixed > 32767) mixed = 32767;
    if (mixed < -32768) mixed = -32768;
    out.writeInt16LE(mixed, i);
  }

  q1 = q1.subarray(evenN);
  q2 = q2.subarray(evenN);
  broadcastMixed(out);
}

function getInputDevices() {
  if (!portAudio) return [];
  return portAudio.getDevices().filter((d) => d.maxInputChannels > 0);
}

function pickDeviceIndex(deviceIdOrName) {
  const inputs = getInputDevices();
  const byId = inputs.find((d) => String(d.id) === String(deviceIdOrName));
  if (byId) return byId.id;
  const byName = inputs.find((d) => d.name === deviceIdOrName);
  return byName ? byName.id : null;
}

async function startCapture(mic1, mic2) {
  await ensureAudioModule();
  const d1 = pickDeviceIndex(mic1);
  const d2 = pickDeviceIndex(mic2);
  if (d1 == null || d2 == null) {
    const missing = d1 == null ? "mic1" : "mic2";
    throw new Error(`Device not found: ${missing}`);
  }

  stopCapture();

  const mkInput = (deviceId) =>
    new portAudio.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate: SAMPLE_RATE,
        deviceId,
        closeOnError: true,
        framesPerBuffer: FRAMES_PER_BUFFER,
      },
    });

  in1 = mkInput(d1);
  in2 = mkInput(d2);

  in1.on("data", (buf) => {
    q1 = Buffer.concat([q1, buf]);
    mixAndFlush();
  });
  in2.on("data", (buf) => {
    q2 = Buffer.concat([q2, buf]);
    mixAndFlush();
  });

  in1.start();
  in2.start();
  current = { active: true, mic1, mic2 };
}

app.get("/health", async (_req, res) => {
  try {
    await ensureAudioModule();
  } catch {
    // keep health endpoint non-fatal; include error in payload
  }
  res.json({
    ok: true,
    ...current,
    wsPort: WS_PORT,
    sampleRate: SAMPLE_RATE,
    audioModuleLoaded: Boolean(portAudio),
    audioModuleError,
  });
});

app.get("/devices", async (_req, res) => {
  try {
    await ensureAudioModule();
    const devices = getInputDevices().map((d) => ({ id: d.id, name: d.name }));
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || "Could not list devices" });
  }
});

app.post("/start", async (req, res) => {
  const { mic1, mic2 } = req.body || {};
  const missingMic1 = mic1 === undefined || mic1 === null || mic1 === "";
  const missingMic2 = mic2 === undefined || mic2 === null || mic2 === "";
  if (missingMic1 || missingMic2) {
    res.status(400).json({ ok: false, message: "mic1 and mic2 are required" });
    return;
  }
  try {
    await startCapture(mic1, mic2);
    res.json({ ok: true, active: true, mic1, mic2 });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || "Failed to start capture" });
  }
});

app.post("/stop", (_req, res) => {
  stopCapture();
  res.json({ ok: true, active: false });
});

app.listen(HTTP_PORT, () => {
  console.log(`Local mixer HTTP listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`Local mixer WS listening on ws://127.0.0.1:${WS_PORT}/`);
});
