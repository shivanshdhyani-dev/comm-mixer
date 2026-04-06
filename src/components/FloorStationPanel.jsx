import { useCallback, useEffect, useRef, useState } from "react";
import { getIceServers } from "../webrtcConfig";

/**
 * Store laptop: two headset mics (customer + sales) → supervisor.
 * Uses TWO separate RTCPeerConnections (one per channel) so each
 * supervisor talk-back track plays on its own <audio> element.
 * Chrome only allows one WebRTC remote track per audio element,
 * so a single PC with two tracks cannot route to two headsets.
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
  const [testing, setTesting] = useState("");

  const pcCustomerRef = useRef(null);
  const pcSalesRef = useRef(null);
  const customerStreamRef = useRef(null);
  const salesStreamRef = useRef(null);
  const meterRafRef = useRef(null);
  const meterCtxRef = useRef(null);
  const outAudioCustomerRef = useRef(null);
  const outAudioSalesRef = useRef(null);
  const pendingCandidatesRef = useRef({ customer: [], sales: [] });
  const permissionGrantedRef = useRef(false);

  const supervisor = presence.find((p) => p.role === "supervisor");

  // ─── Device enumeration ───

  const refreshDevices = useCallback(async () => {
    if (!permissionGrantedRef.current) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        permissionGrantedRef.current = true;
      } catch {
        /* permission denied — carry on with what we can get */
      }
    }

    const list = await navigator.mediaDevices.enumerateDevices();
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
    const elC = outAudioCustomerRef.current;
    const elS = outAudioSalesRef.current;
    if (elC) elC.srcObject = null;
    if (elS) elS.srcObject = null;
  }, []);

  const teardown = useCallback(() => {
    if (pcCustomerRef.current) {
      pcCustomerRef.current.close();
      pcCustomerRef.current = null;
    }
    if (pcSalesRef.current) {
      pcSalesRef.current.close();
      pcSalesRef.current = null;
    }
    customerStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    salesStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    customerStreamRef.current = null;
    salesStreamRef.current = null;
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

  // ─── Supervisor talk-back volume (mode-based) ───

  const modeRef = useRef(mixerState.mode);
  modeRef.current = mixerState.mode;

  useEffect(() => {
    const mode = mixerState.mode;
    const cVal = mode === "talk-customer" || mode === "talk-both" ? 1 : 0;
    const sVal = mode === "talk-sales" || mode === "talk-both" ? 1 : 0;
    const elC = outAudioCustomerRef.current;
    const elS = outAudioSalesRef.current;
    if (elC?.srcObject) elC.volume = cVal;
    if (elS?.srcObject) elS.volume = sVal;
    console.log(`[Floor] Talkback volume: mode="${mode}" customer=${cVal} sales=${sVal}`);
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

  // ─── Test a single mic ───

  const testMic = useCallback(async (deviceId, label) => {
    if (testing || linked) return;
    setTesting(label);
    let stream = null;
    let ctx = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      permissionGrantedRef.current = true;
      refreshDevices().catch(() => {});

      const track = stream.getAudioTracks()[0];
      console.log(`[Floor] Testing mic: ${track.label} (enabled=${track.enabled} readyState=${track.readyState})`);

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(256);

      let maxLevel = 0;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let j = 0; j < buf.length; j++) {
          const v = (buf[j] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length) * 100;
        if (rms > maxLevel) maxLevel = rms;
        const pct = Math.min(100, Math.round(rms * 2.4));
        if (label === "customer") setInputLevels((l) => ({ ...l, customer: pct }));
        else setInputLevels((l) => ({ ...l, sales: pct }));
      }

      if (maxLevel < 0.5) {
        setStatus(`"${track.label}" captured but SILENT (0% audio). Check: hardware mute button, Windows mic volume, headset connection.`);
        console.warn(`[Floor] Mic test FAILED — "${track.label}" produced 0% audio for 3 seconds`);
      } else {
        setStatus(`"${track.label}" is working (peak ${maxLevel.toFixed(1)}%)`);
        console.log(`[Floor] Mic test OK — "${track.label}" peak level ${maxLevel.toFixed(1)}%`);
      }
    } catch (e) {
      setStatus(`Mic test failed: ${e.message}`);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      setTesting("");
      setInputLevels({ customer: 0, sales: 0 });
    }
  }, [testing, linked, refreshDevices]);

  // ─── WebRTC answer / ICE from supervisor (channel-aware) ───

  useEffect(() => {
    const onAnswer = async ({ fromSocketId, sdp, channel }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId) return;
      const ch = channel || "customer";
      const pc = ch === "sales" ? pcSalesRef.current : pcCustomerRef.current;
      if (!pc || !sdp) return;
      try {
        await pc.setRemoteDescription(sdp);
        console.log(`[Floor] Remote description set for ${ch}, flushing buffered candidates`);
        const buffered = pendingCandidatesRef.current[ch] || [];
        for (const c of buffered) {
          try {
            await pc.addIceCandidate(c);
          } catch (err) {
            console.warn(`[Floor] Failed to add buffered ICE candidate (${ch}):`, err.message);
          }
        }
        pendingCandidatesRef.current[ch] = [];
        // Mark linked once both PCs have remote descriptions
        const otherPc = ch === "sales" ? pcCustomerRef.current : pcSalesRef.current;
        if (otherPc?.remoteDescription) {
          setStatus("Linked with supervisor — both mics streaming");
          setLinked(true);
        } else {
          setStatus(`${ch} channel linked, waiting for other…`);
        }
      } catch (e) {
        setStatus(`Failed to apply answer from supervisor (${ch})`);
      }
    };

    const onIce = async ({ fromSocketId, candidate, channel }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId || !candidate) return;
      const ch = channel || "customer";
      const pc = ch === "sales" ? pcSalesRef.current : pcCustomerRef.current;
      if (!pc) return;
      if (!pc.remoteDescription) {
        pendingCandidatesRef.current[ch] = pendingCandidatesRef.current[ch] || [];
        pendingCandidatesRef.current[ch].push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(`[Floor] Failed to add ICE candidate (${ch}):`, err.message);
      }
    };

    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    return () => {
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
    };
  }, [socket, supervisor]);

  // ─── Core: start link (two PCs — one per channel) ───

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
    pendingCandidatesRef.current = { customer: [], sales: [] };
    teardown();

    try {
      const [cStream, sStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: micCustomer } },
          video: false,
        }),
        navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: micSales } },
          video: false,
        }),
      ]);

      permissionGrantedRef.current = true;
      refreshDevices().catch(() => {});

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

      setStatus("Setting up WebRTC (two channels)…");

      const rtcConfig = {
        iceServers: getIceServers(),
        bundlePolicy: "max-bundle",
        iceTransportPolicy: "relay",
      };

      // Helper: create one RTCPeerConnection for a single channel
      const createChannelPC = (track, stream, channel, audioElRef, sinkId) => {
        const pc = new RTCPeerConnection(rtcConfig);

        pc.onicecandidate = (e) => {
          if (!e.candidate || !supervisor) return;
          socket.emit("webrtc:ice", {
            targetSocketId: supervisor.socketId,
            candidate: e.candidate,
            channel,
          });
        };

        pc.ontrack = (ev) => {
          if (ev.track.kind !== "audio") return;
          const el = audioElRef.current;
          if (!el) return;
          el.srcObject = new MediaStream([ev.track]);
          el.volume = 1;
          if (sinkId && el.setSinkId) el.setSinkId(sinkId).catch(() => {});
          el.play().then(() => {
            const mode = modeRef.current;
            const isActive = channel === "customer"
              ? (mode === "talk-customer" || mode === "talk-both")
              : (mode === "talk-sales" || mode === "talk-both");
            el.volume = isActive ? 1 : 0;
            console.log(`[Floor] Talkback → ${channel} headset (audio element, vol=${el.volume})`);
          }).catch((err) => console.warn(`[Floor] ${channel} talkback play failed:`, err.message));
        };

        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          console.log(`[Floor] ICE ${channel}: ${state}`);
          if (state === "connected" || state === "completed") {
            setLinked(true);
            setStatus("Connected — supervisor hearing both mics");
          } else if (state === "checking") {
            setStatus(`Connecting ${channel} channel…`);
          } else if (state === "disconnected") {
            setStatus(`${channel} channel interrupted — reconnecting…`);
          } else if (state === "failed") {
            setStatus(`${channel} channel failed — TURN relay may be down. Try again.`);
          }
        };

        pc.addTrack(track, stream);
        return pc;
      };

      const pcC = createChannelPC(cTrack, cStream, "customer", outAudioCustomerRef, sinkCustomer);
      const pcS = createChannelPC(sTrack, sStream, "sales", outAudioSalesRef, sinkSales);
      pcCustomerRef.current = pcC;
      pcSalesRef.current = pcS;

      // Send offers for both channels
      const offerC = await pcC.createOffer();
      await pcC.setLocalDescription(offerC);
      socket.emit("webrtc:offer", {
        targetSocketId: supervisor.socketId,
        sdp: offerC,
        channel: "customer",
      });

      const offerS = await pcS.createOffer();
      await pcS.setLocalDescription(offerS);
      socket.emit("webrtc:offer", {
        targetSocketId: supervisor.socketId,
        sdp: offerS,
        channel: "sales",
      });

      setStatus("Offers sent — waiting for supervisor…");

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
          <div className="flex gap-2">
            <select
              value={micCustomer}
              onChange={(e) => setMicCustomer(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!micCustomer || !!testing || linked}
              onClick={() => testMic(micCustomer, "customer")}
              className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-40"
            >
              {testing === "customer" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Sales headset mic</label>
          <div className="flex gap-2">
            <select
              value={micSales}
              onChange={(e) => setMicSales(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {inputs.map((d) => (
                <option key={`s-${d.deviceId}`} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!micSales || !!testing || linked}
              onClick={() => testMic(micSales, "sales")}
              className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-40"
            >
              {testing === "sales" ? "Testing…" : "Test"}
            </button>
          </div>
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
