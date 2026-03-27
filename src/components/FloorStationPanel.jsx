import { useCallback, useEffect, useRef, useState } from "react";
import { getIceServers } from "../webrtcConfig";
import {
  checkLocalMixerHealth,
  openLocalMixerStream,
  startLocalMixerCapture,
  stopLocalMixerCapture,
} from "../services/localMixerBridge";

/**
 * Store laptop: two headset mics (customer + sales) → supervisor;
 * supervisor talk-back → split to customer vs sales headset outputs.
 */
export default function FloorStationPanel({
  socket,
  presence,
  mixerState,
  backendConnected,
}) {
  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [micCustomer, setMicCustomer] = useState("");
  const [micSales, setMicSales] = useState("");
  const [sinkCustomer, setSinkCustomer] = useState("");
  const [sinkSales, setSinkSales] = useState("");
  const [status, setStatus] = useState("");
  const [linking, setLinking] = useState(false);
  const [inputLevels, setInputLevels] = useState({ customer: 0, sales: 0 });
  const [useLocalMixer, setUseLocalMixer] = useState(true);
  const [localMixerAvailable, setLocalMixerAvailable] = useState(false);
  const [localMixerBusy, setLocalMixerBusy] = useState(false);

  const pcRef = useRef(null);
  const customerStreamRef = useRef(null);
  const salesStreamRef = useRef(null);
  const mixedOutStreamRef = useRef(null);
  const captureMixCtxRef = useRef(null);
  const meterRafRef = useRef(null);
  const meterCtxRef = useRef(null);
  const localMixerBridgeRef = useRef(null);
  const lastUsedLocalMixerRef = useRef(false);
  const supervisorStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainCustomerRef = useRef(null);
  const gainSalesRef = useRef(null);
  const outAudioCustomerRef = useRef(null);
  const outAudioSalesRef = useRef(null);

  const supervisor = presence.find((p) => p.role === "supervisor");

  const getInputLabelById = useCallback(
    (deviceId) => inputs.find((d) => d.deviceId === deviceId)?.label || "",
    [inputs]
  );

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    setInputs(list.filter((d) => d.kind === "audioinput"));
    setOutputs(list.filter((d) => d.kind === "audiooutput"));
  }, []);

  useEffect(() => {
    refreshDevices().catch(() => {});
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (inputs.length && !micCustomer) setMicCustomer(inputs[0]?.deviceId || "");
    if (inputs.length && !micSales)
      setMicSales(inputs[1]?.deviceId || inputs[0]?.deviceId || "");
  }, [inputs, micCustomer, micSales]);

  const refreshLocalMixerHealth = useCallback(async () => {
    setLocalMixerBusy(true);
    try {
      const health = await checkLocalMixerHealth();
      setLocalMixerAvailable(Boolean(health?.ok));
    } catch {
      setLocalMixerAvailable(false);
    } finally {
      setLocalMixerBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!useLocalMixer) return;
    refreshLocalMixerHealth().catch(() => {});
    const id = window.setInterval(() => {
      refreshLocalMixerHealth().catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [refreshLocalMixerHealth, useLocalMixer]);

  const teardownPlaybackOnly = useCallback(() => {
    supervisorStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    gainCustomerRef.current = null;
    gainSalesRef.current = null;
    if (outAudioCustomerRef.current) outAudioCustomerRef.current.srcObject = null;
    if (outAudioSalesRef.current) outAudioSalesRef.current.srcObject = null;
  }, []);

  const teardown = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    customerStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    salesStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    customerStreamRef.current = null;
    salesStreamRef.current = null;
    mixedOutStreamRef.current = null;
    if (captureMixCtxRef.current) {
      captureMixCtxRef.current.close();
      captureMixCtxRef.current = null;
    }
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (meterCtxRef.current) {
      meterCtxRef.current.close();
      meterCtxRef.current = null;
    }
    if (localMixerBridgeRef.current) {
      localMixerBridgeRef.current.close();
      localMixerBridgeRef.current = null;
    }
    if (lastUsedLocalMixerRef.current) {
      stopLocalMixerCapture().catch(() => {});
      lastUsedLocalMixerRef.current = false;
    }
    setInputLevels({ customer: 0, sales: 0 });
    teardownPlaybackOnly();
  }, [teardownPlaybackOnly]);

  const startMeters = useCallback((cStream, sStream) => {
    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    if (meterCtxRef.current) meterCtxRef.current.close();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    meterCtxRef.current = ctx;
    void ctx.resume().catch(() => {});
    const cSrc = ctx.createMediaStreamSource(cStream);
    const sSrc = ctx.createMediaStreamSource(sStream);
    const cAn = ctx.createAnalyser();
    const sAn = ctx.createAnalyser();
    cAn.fftSize = 256;
    sAn.fftSize = 256;
    cSrc.connect(cAn);
    sSrc.connect(sAn);
    const cData = new Uint8Array(cAn.fftSize);
    const sData = new Uint8Array(sAn.fftSize);

    const tick = () => {
      cAn.getByteTimeDomainData(cData);
      sAn.getByteTimeDomainData(sData);
      const rms = (arr) => {
        let sum = 0;
        for (let i = 0; i < arr.length; i += 1) {
          const v = (arr[i] - 128) / 128;
          sum += v * v;
        }
        return Math.sqrt(sum / arr.length);
      };
      const cLevel = Math.min(100, Math.round(rms(cData) * 240));
      const sLevel = Math.min(100, Math.round(rms(sData) * 240));
      setInputLevels({ customer: cLevel, sales: sLevel });
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
  }, []);

  const buildTalkbackGraph = useCallback(
    (supervisorStream) => {
      teardownPlaybackOnly();
      supervisorStreamRef.current = supervisorStream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      void ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(supervisorStream);
      const gC = ctx.createGain();
      const gS = ctx.createGain();
      gainCustomerRef.current = gC;
      gainSalesRef.current = gS;
      src.connect(gC);
      src.connect(gS);
      const destC = ctx.createMediaStreamDestination();
      const destS = ctx.createMediaStreamDestination();
      gC.connect(destC);
      gS.connect(destS);

      const elC = outAudioCustomerRef.current;
      const elS = outAudioSalesRef.current;
      if (elC) {
        elC.srcObject = destC.stream;
        elC.autoplay = true;
        elC.play().catch(() => {});
        if (sinkCustomer && elC.setSinkId) {
          elC.setSinkId(sinkCustomer).catch(() => {});
        }
      }
      if (elS) {
        elS.srcObject = destS.stream;
        elS.autoplay = true;
        elS.play().catch(() => {});
        if (sinkSales && elS.setSinkId) {
          elS.setSinkId(sinkSales).catch(() => {});
        }
      }
    },
    [sinkCustomer, sinkSales, teardownPlaybackOnly]
  );

  useEffect(() => {
    const mode = mixerState.mode;
    const listen = mode === "listen";
    const gC = gainCustomerRef.current;
    const gS = gainSalesRef.current;
    if (!gC || !gS) return;
    if (listen) {
      gC.gain.value = 0;
      gS.gain.value = 0;
      return;
    }
    gC.gain.value = mode === "talk-customer" || mode === "talk-both" ? 1 : 0;
    gS.gain.value = mode === "talk-sales" || mode === "talk-both" ? 1 : 0;
  }, [mixerState.mode]);

  useEffect(() => {
    const elC = outAudioCustomerRef.current;
    const elS = outAudioSalesRef.current;
    if (elC && sinkCustomer && elC.setSinkId) elC.setSinkId(sinkCustomer).catch(() => {});
    if (elS && sinkSales && elS.setSinkId) elS.setSinkId(sinkSales).catch(() => {});
  }, [sinkCustomer, sinkSales]);

  const applyMicMutes = useCallback(() => {
    const cust = mixerState.participants.find((p) => p.id === "customer");
    const sale = mixerState.participants.find((p) => p.id === "sales");
    const t1 = customerStreamRef.current?.getAudioTracks?.()[0];
    const t2 = salesStreamRef.current?.getAudioTracks?.()[0];
    if (t1) t1.enabled = Boolean(cust?.micOn);
    if (t2) t2.enabled = Boolean(sale?.micOn);
  }, [mixerState.participants]);

  useEffect(() => {
    applyMicMutes();
  }, [applyMicMutes]);

  useEffect(() => {
    const onAnswer = async ({ fromSocketId, sdp }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId) return;
      const pc = pcRef.current;
      if (!pc || !sdp) return;
      try {
        await pc.setRemoteDescription(sdp);
        setStatus("Linked with supervisor");
      } catch {
        setStatus("Failed to apply answer");
      }
    };

    const onIce = async ({ fromSocketId, candidate }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId || !candidate) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    };

    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    return () => {
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
    };
  }, [socket, supervisor]);

  const startLink = async () => {
    if (!supervisor) {
      setStatus("Supervisor is not online yet.");
      return;
    }
    if (!micCustomer || !micSales) {
      setStatus("Select both headset microphones.");
      return;
    }
    setLinking(true);
    setStatus("Connecting…");
    teardown();

    try {
      const shouldUseLocalMixer = useLocalMixer && localMixerAvailable;
      let cStream = null;
      let sStream = null;
      lastUsedLocalMixerRef.current = shouldUseLocalMixer;

      if (!shouldUseLocalMixer) {
        cStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: micCustomer },
            // Disable voice-processing to reduce single-mic takeover behavior.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
          video: false,
        });
        sStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: micSales },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
          video: false,
        });
        const cTrack = cStream.getAudioTracks()[0];
        const sTrack = sStream.getAudioTracks()[0];
        if (!cTrack || !sTrack) {
          throw new Error("One or both selected microphones are unavailable.");
        }
        customerStreamRef.current = cStream;
        salesStreamRef.current = sStream;
        startMeters(cStream, sStream);
        applyMicMutes();
      } else {
        setInputLevels({ customer: 0, sales: 0 });
      }

      const pc = new RTCPeerConnection({
        iceServers: getIceServers(),
      });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate || !supervisor) return;
        socket.emit("webrtc:ice", {
          targetSocketId: supervisor.socketId,
          candidate: e.candidate,
        });
      };

      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (stream?.getAudioTracks().length) {
          buildTalkbackGraph(stream);
        }
      };

      if (shouldUseLocalMixer) {
        const customerName = getInputLabelById(micCustomer);
        const salesName = getInputLabelById(micSales);
        await startLocalMixerCapture({
          mic1: customerName || micCustomer,
          mic2: salesName || micSales,
        });
        const bridge = openLocalMixerStream();
        localMixerBridgeRef.current = bridge;
        mixedOutStreamRef.current = bridge.stream;
        const track = bridge.stream.getAudioTracks()[0];
        if (track) pc.addTrack(track, bridge.stream);
      } else {
        // Mix both headset mics into one outgoing channel to avoid multi-track
        // device capture inconsistencies on single-laptop store setups.
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const mixCtx = new AudioCtx();
        captureMixCtxRef.current = mixCtx;
        void mixCtx.resume().catch(() => {});
        const dest = mixCtx.createMediaStreamDestination();
        const cSrc = mixCtx.createMediaStreamSource(cStream);
        const sSrc = mixCtx.createMediaStreamSource(sStream);
        cSrc.connect(dest);
        sSrc.connect(dest);
        mixedOutStreamRef.current = dest.stream;
        const mixedTrack = dest.stream.getAudioTracks()[0];
        if (mixedTrack) pc.addTrack(mixedTrack, dest.stream);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", {
        targetSocketId: supervisor.socketId,
        sdp: offer,
      });
      if (!shouldUseLocalMixer) {
        setTimeout(() => {
          setInputLevels((levels) => {
            if (levels.customer < 4 || levels.sales < 4) {
              setStatus(
                "One selected mic looks inactive. Check mic selection and speak closer to each mic."
              );
            }
            return levels;
          });
        }, 1600);
      }
      setStatus(
        shouldUseLocalMixer
          ? "Offer sent (store audio service) — waiting for supervisor…"
          : "Offer sent — waiting for supervisor…"
      );
    } catch (e) {
      setStatus(
        e?.message
          ? `Could not start link: ${e.message}`
          : "Could not access mics or start link."
      );
      teardown();
    } finally {
      setLinking(false);
    }
  };

  useEffect(() => () => teardown(), [teardown]);

  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-white">Store desk (Meet laptop)</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Two headsets on this machine: customer mic + sales mic go to the supervisor.
        Supervisor talk-back plays on the outputs you pick below.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Customer headset mic</label>
          <select
            value={micCustomer}
            onChange={(e) => setMicCustomer(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Sales headset mic</label>
          <select
            value={micSales}
            onChange={(e) => setMicSales(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            {inputs.map((d) => (
              <option key={`s-${d.deviceId}`} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Play supervisor → customer earpiece</label>
          <select
            value={sinkCustomer}
            onChange={(e) => setSinkCustomer(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            <option value="">Default output</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Speaker"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Play supervisor → sales earpiece</label>
          <select
            value={sinkSales}
            onChange={(e) => setSinkSales(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            <option value="">Default output</option>
            {outputs.map((d) => (
              <option key={`o-${d.deviceId}`} value={d.deviceId}>
                {d.label || "Speaker"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="mr-2 inline-flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={useLocalMixer}
            onChange={(e) => setUseLocalMixer(e.target.checked)}
          />
          Use store audio service
        </label>
        {useLocalMixer && (
          <span
            className={`text-xs ${
              localMixerAvailable ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {localMixerBusy
              ? "Checking store audio service..."
              : localMixerAvailable
                ? "Store audio service reachable"
                : "Service offline: browser fallback will be used"}
          </span>
        )}
        <button
          type="button"
          disabled={linking || !backendConnected || !supervisor}
          onClick={startLink}
          className="rounded-xl bg-accent-teal/25 px-4 py-2 text-sm font-semibold text-accent-teal disabled:opacity-50"
        >
          {linking ? "Connecting…" : "Start audio link to supervisor"}
        </button>
        {!supervisor && (
          <span className="text-xs text-amber-300">Waiting for supervisor to sign in…</span>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-zinc-500">Customer mic level</p>
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div
              className="h-full bg-accent-teal transition-all"
              style={{ width: `${inputLevels.customer}%` }}
            />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-zinc-500">Sales mic level</p>
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div
              className="h-full bg-accent-teal transition-all"
              style={{ width: `${inputLevels.sales}%` }}
            />
          </div>
        </div>
      </div>
      {status && <p className="mt-3 text-sm text-zinc-400">{status}</p>}

      <audio ref={outAudioCustomerRef} className="hidden" playsInline />
      <audio ref={outAudioSalesRef} className="hidden" playsInline />
    </div>
  );
}
