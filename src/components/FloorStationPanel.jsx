import { useCallback, useEffect, useRef, useState } from "react";
import { getIceServers } from "../webrtcConfig";

/**
 * Store laptop: two headset mics (customer + sales) → mixed into one stream → supervisor.
 * Supervisor talk-back → split to customer vs sales headset outputs via setSinkId.
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
  const [linked, setLinked] = useState(false);
  const [inputLevels, setInputLevels] = useState({ customer: 0, sales: 0 });

  const pcRef = useRef(null);
  const customerStreamRef = useRef(null);
  const salesStreamRef = useRef(null);
  const captureMixCtxRef = useRef(null);
  const meterRafRef = useRef(null);
  const meterCtxRef = useRef(null);
  const supervisorStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainCustomerRef = useRef(null);
  const gainSalesRef = useRef(null);
  const outAudioCustomerRef = useRef(null);
  const outAudioSalesRef = useRef(null);

  const supervisor = presence.find((p) => p.role === "supervisor");

  // ─── Device enumeration ───

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    // Filter out "default" and "communications" virtual devices — they alias real
    // hardware and cause both dropdowns to capture the same physical mic.
    setInputs(
      list.filter(
        (d) =>
          d.kind === "audioinput" &&
          d.deviceId !== "default" &&
          d.deviceId !== "communications"
      )
    );
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

  // ─── Teardown helpers ───

  const teardownPlayback = useCallback(() => {
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
    setInputLevels({ customer: 0, sales: 0 });
    setLinked(false);
    teardownPlayback();
  }, [teardownPlayback]);

  // ─── Level meters ───

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

    const rms = (arr) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i += 1) {
        const v = (arr[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / arr.length);
    };

    const tick = () => {
      cAn.getByteTimeDomainData(cData);
      sAn.getByteTimeDomainData(sData);
      setInputLevels({
        customer: Math.min(100, Math.round(rms(cData) * 240)),
        sales: Math.min(100, Math.round(rms(sData) * 240)),
      });
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ─── Supervisor talk-back → headset outputs ───

  const buildTalkbackGraph = useCallback(
    (supervisorStream) => {
      teardownPlayback();
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
        if (sinkCustomer && elC.setSinkId) elC.setSinkId(sinkCustomer).catch(() => {});
      }
      if (elS) {
        elS.srcObject = destS.stream;
        elS.autoplay = true;
        elS.play().catch(() => {});
        if (sinkSales && elS.setSinkId) elS.setSinkId(sinkSales).catch(() => {});
      }
    },
    [sinkCustomer, sinkSales, teardownPlayback]
  );

  // ─── React to supervisor mode changes (talk-back gain) ───

  useEffect(() => {
    const mode = mixerState.mode;
    const gC = gainCustomerRef.current;
    const gS = gainSalesRef.current;
    if (!gC || !gS) return;
    if (mode === "listen") {
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

  // ─── Mic mute sync ───

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

  // ─── WebRTC answer / ICE from supervisor ───

  useEffect(() => {
    const onAnswer = async ({ fromSocketId, sdp }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId) return;
      const pc = pcRef.current;
      if (!pc || !sdp) return;
      try {
        await pc.setRemoteDescription(sdp);
        setStatus("Linked with supervisor — both mics streaming");
        setLinked(true);
      } catch {
        setStatus("Failed to apply answer from supervisor");
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

  // ─── Core: start link ───

  const startLink = async () => {
    if (!supervisor) {
      setStatus("Supervisor is not online yet.");
      return;
    }
    if (!micCustomer || !micSales) {
      setStatus("Select both headset microphones.");
      return;
    }
    if (micCustomer === micSales) {
      setStatus("Customer and Sales must use different microphones.");
      return;
    }

    setLinking(true);
    setStatus("Requesting microphone access…");
    teardown();

    try {
      // 1) Capture customer mic
      const cStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: micCustomer },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });

      // 2) Capture sales mic
      const sStream = await navigator.mediaDevices.getUserMedia({
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

      const cActualId = cTrack.getSettings().deviceId;
      const sActualId = sTrack.getSettings().deviceId;
      if (cActualId && sActualId && cActualId === sActualId) {
        setStatus(
          `Warning: Both mics resolved to the same hardware device ("${cTrack.label}"). ` +
          "Pick two physically separate headsets."
        );
      } else {
        console.log("[Floor] Customer mic:", cTrack.label, "| Sales mic:", sTrack.label);
        setStatus(`Capturing: "${cTrack.label}" + "${sTrack.label}"`);
      }

      startMeters(cStream, sStream);
      applyMicMutes();

      // 5) Create WebRTC peer connection — send both tracks separately
      //    so the supervisor can control each mic independently.
      setStatus("Setting up WebRTC…");
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
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

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("[Floor] ICE connection state:", state);
        if (state === "connected" || state === "completed") {
          setStatus("Connected — supervisor hearing both mics");
          setLinked(true);
        } else if (state === "checking") {
          setStatus("Connecting to supervisor…");
        } else if (state === "disconnected") {
          setStatus("Connection interrupted — trying to reconnect…");
        } else if (state === "failed") {
          setStatus("Connection failed — TURN relay may be down. Try again.");
          setLinked(false);
        }
      };

      // 6) Add both mic tracks separately (customer first, then sales)
      pc.addTrack(cTrack, cStream);
      pc.addTrack(sTrack, sStream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", {
        targetSocketId: supervisor.socketId,
        sdp: offer,
      });

      setStatus("Offer sent — waiting for supervisor…");

      const customerLabel = cTrack.label || "Customer mic";
      const salesLabel = sTrack.label || "Sales mic";
      setTimeout(() => {
        setInputLevels((levels) => {
          if (levels.customer < 3 && levels.sales < 3) {
            setStatus(
              `Both mics silent. Check headset connections — "${customerLabel}" and "${salesLabel}".`
            );
          } else if (levels.customer < 3) {
            setStatus(`"${customerLabel}" looks silent — check the customer headset connection.`);
          } else if (levels.sales < 3) {
            setStatus(`"${salesLabel}" looks silent — check the sales headset connection.`);
          }
          return levels;
        });
      }, 2000);
    } catch (e) {
      const msg = e?.message || "Could not access mics or start link.";
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        setStatus("Microphone permission denied. Allow mic access and try again.");
      } else if (msg.includes("NotFoundError") || msg.includes("DevicesNotFound")) {
        setStatus("Selected microphone not found. Replug the headset and try again.");
      } else {
        setStatus(`Error: ${msg}`);
      }
      teardown();
    } finally {
      setLinking(false);
    }
  };

  const stopLink = () => {
    teardown();
    setStatus("Disconnected.");
  };

  useEffect(() => () => teardown(), [teardown]);

  // ─── UI ───

  const sameMicWarning = micCustomer && micSales && micCustomer === micSales;
  const sameHardwareWarning =
    !sameMicWarning &&
    micCustomer &&
    micSales &&
    (() => {
      const c = inputs.find((d) => d.deviceId === micCustomer);
      const s = inputs.find((d) => d.deviceId === micSales);
      return c && s && c.groupId && c.groupId === s.groupId;
    })();

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
          <label className="mb-1 block text-xs text-zinc-500">
            Play supervisor → customer earpiece
          </label>
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
          <label className="mb-1 block text-xs text-zinc-500">
            Play supervisor → sales earpiece
          </label>
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

      {sameMicWarning && (
        <p className="mt-2 text-xs text-amber-300">
          Customer and Sales are set to the same microphone. Choose different devices.
        </p>
      )}
      {sameHardwareWarning && (
        <p className="mt-2 text-xs text-amber-300">
          These two entries appear to be the same physical device. Pick two separate headsets.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!linked ? (
          <button
            type="button"
            disabled={linking || !backendConnected || !supervisor || sameMicWarning}
            onClick={startLink}
            className="rounded-xl bg-accent-teal/25 px-4 py-2 text-sm font-semibold text-accent-teal disabled:opacity-50"
          >
            {linking ? "Connecting…" : "Start audio link to supervisor"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopLink}
            className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-400"
          >
            Stop link
          </button>
        )}
        {!supervisor && (
          <span className="text-xs text-amber-300">
            Waiting for supervisor to sign in…
          </span>
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

      {status && (
        <p
          className={`mt-3 text-sm ${
            status.includes("Error") || status.includes("failed") || status.includes("denied")
              ? "text-red-400"
              : status.includes("Connected") || status.includes("Linked")
                ? "text-emerald-400"
                : "text-zinc-400"
          }`}
        >
          {status}
        </p>
      )}

      <audio ref={outAudioCustomerRef} className="hidden" playsInline />
      <audio ref={outAudioSalesRef} className="hidden" playsInline />
    </div>
  );
}
