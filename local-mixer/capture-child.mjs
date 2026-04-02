/**
 * Captures two mics via naudiodon, mixes to mono int16 PCM, writes chunks to stdout.
 * First stderr line is either "OK" or "ERR ...". Parent must not load naudiodon.
 */

const SAMPLE_RATE = 48000;
const FRAMES_PER_BUFFER = 480;

function errOut(msg) {
  process.stderr.write(`ERR ${msg}\n`);
}

let portAudio;
try {
  const mod = await import("naudiodon");
  portAudio = mod.default || mod;
} catch (e) {
  errOut(e?.message || "Could not load naudiodon");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(process.argv[2] || "{}");
} catch {
  errOut("Invalid JSON argument");
  process.exit(1);
}

const { mic1, mic2 } = payload;
if (mic1 === undefined || mic1 === null || mic1 === "" || mic2 === undefined || mic2 === null || mic2 === "") {
  errOut("mic1 and mic2 required");
  process.exit(1);
}

function getInputDevices() {
  return portAudio.getDevices().filter((d) => d.maxInputChannels > 0);
}

function pickDeviceIndex(deviceIdOrName) {
  const inputs = getInputDevices();
  const byId = inputs.find((d) => String(d.id) === String(deviceIdOrName));
  if (byId) return byId.id;
  const byName = inputs.find((d) => d.name === deviceIdOrName);
  return byName ? byName.id : null;
}

const d1 = pickDeviceIndex(mic1);
const d2 = pickDeviceIndex(mic2);
if (d1 == null || d2 == null) {
  errOut(`Device not found: ${d1 == null ? "mic1" : "mic2"}`);
  process.exit(1);
}

let q1 = Buffer.alloc(0);
let q2 = Buffer.alloc(0);
let readySent = false;

function sendReady() {
  if (!readySent) {
    readySent = true;
    process.stderr.write("OK\n");
  }
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
  process.stdout.write(out);
}

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

const in1 = mkInput(d1);
const in2 = mkInput(d2);

in1.on("data", (buf) => {
  q1 = Buffer.concat([q1, buf]);
  mixAndFlush();
});
in2.on("data", (buf) => {
  q2 = Buffer.concat([q2, buf]);
  mixAndFlush();
});

try {
  in1.start();
  in2.start();
  sendReady();
} catch (e) {
  errOut(e?.message || "Failed to start capture");
  process.exit(1);
}

process.on("SIGTERM", () => {
  try {
    in1.quit();
  } catch {
    /* ignore */
  }
  try {
    in2.quit();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
