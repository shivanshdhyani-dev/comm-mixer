import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIST_DEVICES_SCRIPT = path.join(__dirname, "list-devices-child.mjs");
const CAPTURE_SCRIPT = path.join(__dirname, "capture-child.mjs");

const app = express();
app.use(cors());
app.use(express.json());

const HTTP_PORT = Number(process.env.LOCAL_MIXER_PORT || 17777);
const WS_PORT = Number(process.env.LOCAL_MIXER_WS_PORT || 17778);

let captureChild = null;
let audioModuleError = "";
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

function stopCapture() {
  if (captureChild) {
    const c = captureChild;
    captureChild = null;
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  current = { active: false, mic1: null, mic2: null };
}

function runDevicesChild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LIST_DEVICES_SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `list-devices exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Invalid JSON from list-devices child"));
      }
    });
  });
}

// Parent never imports naudiodon — native crashes stay in child processes.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ...current,
    wsPort: WS_PORT,
    sampleRate: 48000,
    audioModuleLoaded: false,
    audioModuleError,
    captureChildProcess: true,
  });
});

app.get("/devices", async (_req, res) => {
  try {
    const parsed = await runDevicesChild();
    res.json(parsed);
  } catch (err) {
    audioModuleError = err?.message || "devices failed";
    res.status(500).json({ ok: false, message: audioModuleError });
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

  stopCapture();

  const payload = JSON.stringify({ mic1, mic2 });
  const child = spawn(process.execPath, [CAPTURE_SCRIPT, payload], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureChild = child;

  let responded = false;
  let stderrBuf = "";
  const startupTimeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    clearTimeout(startupTimeout);
    audioModuleError = "Capture startup timed out (native module may have crashed)";
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    captureChild = null;
    current = { active: false, mic1: null, mic2: null };
    res.status(500).json({ ok: false, message: audioModuleError });
  }, 10000);

  const done = () => {
    clearTimeout(startupTimeout);
  };

  const finishError = (msg) => {
    if (responded) return;
    responded = true;
    done();
    audioModuleError = msg;
    if (captureChild === child) {
      captureChild = null;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    current = { active: false, mic1: null, mic2: null };
    if (!res.headersSent) {
      res.status(500).json({ ok: false, message: msg });
    }
  };

  const finishOk = () => {
    if (responded) return;
    responded = true;
    done();
    audioModuleError = "";
    current = { active: true, mic1, mic2 };
    res.json({ ok: true, active: true, mic1, mic2 });
  };

  child.stdout.on("data", (buf) => {
    broadcastMixed(buf);
  });

  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "").trim();
      if (line === "OK") {
        finishOk();
      } else if (line.startsWith("ERR ")) {
        finishError(line.slice(4).trim() || "capture failed");
      }
    }
  });

  child.on("error", (e) => {
    finishError(e?.message || "Failed to spawn capture process");
  });

  child.on("close", (code, signal) => {
    if (captureChild === child) {
      captureChild = null;
    }
    if (!responded) {
      finishError(
        signal
          ? `Capture process stopped (${signal})`
          : code !== 0
            ? `Capture process exited (${code})`
            : "Capture ended"
      );
      return;
    }
    done();
    current = { active: false, mic1: null, mic2: null };
  });
});

app.post("/stop", (_req, res) => {
  stopCapture();
  res.json({ ok: true, active: false });
});

app.listen(HTTP_PORT, () => {
  console.log(`Local mixer HTTP listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`Local mixer WS listening on ws://127.0.0.1:${WS_PORT}/`);
});
