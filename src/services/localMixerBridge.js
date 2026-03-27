const LOCAL_MIXER_HTTP = import.meta.env.VITE_LOCAL_MIXER_HTTP || "http://127.0.0.1:17777";
const LOCAL_MIXER_WS = import.meta.env.VITE_LOCAL_MIXER_WS || "ws://127.0.0.1:17778";

export async function checkLocalMixerHealth() {
  const res = await fetch(`${LOCAL_MIXER_HTTP}/health`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.message || "Local mixer health check failed");
  }
  return body;
}

export async function startLocalMixerCapture({ mic1, mic2 }) {
  const res = await fetch(`${LOCAL_MIXER_HTTP}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mic1, mic2 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.message || "Failed to start local mixer capture");
  }
}

export async function stopLocalMixerCapture() {
  try {
    await fetch(`${LOCAL_MIXER_HTTP}/stop`, { method: "POST" });
  } catch {
    /* ignore */
  }
}

export function openLocalMixerStream() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 48000 });
  const proc = ctx.createScriptProcessor(1024, 0, 1);
  const dest = ctx.createMediaStreamDestination();
  proc.connect(dest);
  void ctx.resume().catch(() => {});

  const queue = [];
  let qOffset = 0;

  const ws = new WebSocket(LOCAL_MIXER_WS);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    const buf = new Int16Array(event.data);
    queue.push(buf);
  };

  proc.onaudioprocess = (ev) => {
    const out = ev.outputBuffer.getChannelData(0);
    for (let i = 0; i < out.length; i += 1) {
      if (queue.length === 0) {
        out[i] = 0;
        continue;
      }
      const cur = queue[0];
      out[i] = cur[qOffset] / 32768;
      qOffset += 1;
      if (qOffset >= cur.length) {
        queue.shift();
        qOffset = 0;
      }
    }
  };

  return {
    stream: dest.stream,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      try {
        proc.disconnect();
      } catch {
        /* ignore */
      }
      try {
        dest.disconnect?.();
      } catch {
        /* ignore */
      }
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
    },
  };
}
