import { useCallback, useEffect, useRef, useState } from "react";
import { getIceServers } from "../webrtcConfig";

/**
 * Store laptop: two headset mics (customer + sales) → supervisor.
 *
 * Supervisor talk-back uses a hybrid approach:
 *   Customer earpiece: <audio> element + setSinkId (non-default device)
 *   Sales earpiece: AudioContext → ctx.destination (system default device)
 * Chrome on Mac can't reliably play two <audio> elements on different
 * setSinkId devices simultaneously, so we mix the two pipelines.
 *
 * Mode controls gain values: 0 = muted, 1 = active.
 * Output elements play LOCAL streams (not WebRTC), so Chrome allows both.
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

  const pcRef = useRef(null);
  const customerStreamRef = useRef(null);
  const salesStreamRef = useRef(null);
  const meterRafRef = useRef(null);
  const meterCtxRef = useRef(null);

  // Talkback: customer uses setSinkId, sales uses AudioContext default output
  const outAudioCustomerRef = useRef(null);  // → customer headset (setSinkId)
  const outAudioSalesRef = useRef(null);     // → sales headset (AudioContext default)
  const talkbackCtxRef = useRef(null);
  const gainSalesRef = useRef(null);

  const pendingCandidatesRef = useRef([]);
  const permissionGrantedRef = useRef(false);
  const modeRef = useRef(mixerState.mode);
  modeRef.current = mixerState.mode;
  const sinkCustomerRef = useRef(sinkCustomer);
  sinkCustomerRef.current = sinkCustomer;
  const sinkSalesRef = useRef(sinkSales);
  sinkSalesRef.current = sinkSales;

  const supervisor = presence.find((p) => p.role === "supervisor");

  // ─── Device enumeration ───

  const refreshDevices = useCallback(async () => {
    if (!permissionGrantedRef.current) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        permissionGrantedRef.current = true;
      } catch { /* carry on */ }
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

  // ─── Teardown ───

  const teardown = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    customerStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    salesStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    customerStreamRef.current = null;
    salesStreamRef.current = null;
    if (meterRafRef.current) { cancelAnimationFrame(meterRafRef.current); meterRafRef.current = null; }
    if (meterCtxRef.current) { meterCtxRef.current.close(); meterCtxRef.current = null; }
    if (talkbackCtxRef.current) { talkbackCtxRef.current.close(); talkbackCtxRef.current = null; }
    gainSalesRef.current = null;
    if (outAudioCustomerRef.current) outAudioCustomerRef.current.srcObject = null;
    setInputLevels({ customer: 0, sales: 0 });
    setLinked(false);
  }, []);

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
      for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
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

  // ─── Talkback routing ───
  // Customer: volume on <audio> element (setSinkId route)
  // Sales: GainNode on AudioContext (default output route)

  const applyTalkbackRouting = useCallback((mode) => {
    const elC = outAudioCustomerRef.current;
    const gS = gainSalesRef.current;
    const cVal = (mode === "talk-customer" || mode === "talk-both") ? 1 : 0;
    const sVal = (mode === "talk-sales" || mode === "talk-both") ? 1 : 0;
    if (elC) elC.volume = cVal;
    if (gS) gS.gain.value = sVal;
    console.log(`[Floor] Talkback: mode="${mode}" customer=${cVal} sales=${sVal}`);
  }, []);

  useEffect(() => {
    applyTalkbackRouting(mixerState.mode);
  }, [mixerState.mode, applyTalkbackRouting]);

  // Re-apply setSinkId for customer earpiece (sales uses AudioContext default)
  useEffect(() => {
    const elC = outAudioCustomerRef.current;
    const cLabel = outputs.find((d) => d.deviceId === sinkCustomer)?.label || "default";
    const sLabel = outputs.find((d) => d.deviceId === sinkSales)?.label || "default";
    console.log(`[Floor] Earpiece config — Customer: "${cLabel}" (setSinkId) | Sales: "${sLabel}" (AudioContext default)`);
    if (elC && sinkCustomer && elC.setSinkId)
      elC.setSinkId(sinkCustomer)
        .then(() => console.log("[Floor] Customer earpiece setSinkId OK:", cLabel))
        .catch((e) => console.warn("[Floor] Customer earpiece setSinkId FAILED:", e.message));
  }, [sinkCustomer, sinkSales, outputs]);

  // ─── Mic mute sync ───

  const applyMicMutes = useCallback(() => {
    const cust = mixerState.participants.find((p) => p.id === "customer");
    const sale = mixerState.participants.find((p) => p.id === "sales");
    const t1 = customerStreamRef.current?.getAudioTracks?.()[0];
    const t2 = salesStreamRef.current?.getAudioTracks?.()[0];
    if (t1) t1.enabled = Boolean(cust?.micOn);
    if (t2) t2.enabled = Boolean(sale?.micOn);
  }, [mixerState.participants]);

  useEffect(() => { applyMicMutes(); }, [applyMicMutes]);

  // ─── Test a single mic ───

  const testMic = useCallback(async (deviceId, label) => {
    if (testing || linked) return;
    setTesting(label);
    let stream = null;
    let ctx = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }, video: false,
      });
      permissionGrantedRef.current = true;
      refreshDevices().catch(() => {});
      const track = stream.getAudioTracks()[0];
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
        for (let j = 0; j < buf.length; j++) { const v = (buf[j] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length) * 100;
        if (rms > maxLevel) maxLevel = rms;
        const pct = Math.min(100, Math.round(rms * 2.4));
        if (label === "customer") setInputLevels((l) => ({ ...l, customer: pct }));
        else setInputLevels((l) => ({ ...l, sales: pct }));
      }
      if (maxLevel < 0.5) {
        setStatus(`"${track.label}" captured but SILENT. Check: hardware mute, mic volume, headset connection.`);
      } else {
        setStatus(`"${track.label}" is working (peak ${maxLevel.toFixed(1)}%)`);
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

  // ─── WebRTC answer / ICE from supervisor ───

  useEffect(() => {
    const onAnswer = async ({ fromSocketId, sdp }) => {
      if (!supervisor || fromSocketId !== supervisor.socketId) return;
      const pc = pcRef.current;
      if (!pc || !sdp) return;
      try {
        await pc.setRemoteDescription(sdp);
        for (const c of pendingCandidatesRef.current) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        pendingCandidatesRef.current = [];
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
      if (!pc.remoteDescription) { pendingCandidatesRef.current.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch {}
    };
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    return () => { socket.off("webrtc:answer", onAnswer); socket.off("webrtc:ice", onIce); };
  }, [socket, supervisor]);

  // ─── Core: start link ───

  const startLink = async () => {
    if (!supervisor) { setStatus("Supervisor is not online yet."); return; }
    if (!micCustomer || !micSales) { setStatus("Select both headset microphones."); return; }
    if (micCustomer === micSales) { setStatus("Customer and Sales must use different microphones."); return; }

    setLinking(true);
    setStatus("Requesting microphone access…");
    pendingCandidatesRef.current = [];
    teardown();

    try {
      const [cStream, sStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micCustomer } }, video: false }),
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micSales } }, video: false }),
      ]);
      permissionGrantedRef.current = true;
      refreshDevices().catch(() => {});

      const cTrack = cStream.getAudioTracks()[0];
      const sTrack = sStream.getAudioTracks()[0];
      if (!cTrack || !sTrack) throw new Error("One or both selected microphones are unavailable.");

      customerStreamRef.current = cStream;
      salesStreamRef.current = sStream;
      console.log("[Floor] Customer mic:", cTrack.label, "| Sales mic:", sTrack.label);
      setStatus(`Capturing: "${cTrack.label}" + "${sTrack.label}"`);

      startMeters(cStream, sStream);
      applyMicMutes();

      setStatus("Setting up WebRTC…");
      const pc = new RTCPeerConnection({
        iceServers: getIceServers(),
        bundlePolicy: "max-bundle",
        iceTransportPolicy: "relay",
      });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate || !supervisor) return;
        socket.emit("webrtc:ice", { targetSocketId: supervisor.socketId, candidate: e.candidate });
      };

      // ── Talkback: clone WebRTC track to TWO audio elements ──
      let talkbackReceived = false;
      pc.ontrack = async (ev) => {
        if (ev.track.kind !== "audio" || talkbackReceived) return;
        talkbackReceived = true;
        console.log("[Floor] Talkback track received, setting up hybrid output");

        const track = ev.track;

        // ── Customer: <audio> element with setSinkId ──
        const elC = outAudioCustomerRef.current;
        if (elC) {
          elC.srcObject = new MediaStream([track.clone()]);
          elC.volume = 0;
          const sinkC = sinkCustomerRef.current;
          if (sinkC && elC.setSinkId) {
            try {
              await elC.setSinkId(sinkC);
              console.log("[Floor] Customer earpiece setSinkId OK:", sinkC);
            } catch (e) {
              console.warn("[Floor] Customer setSinkId FAILED:", e.message);
            }
          }
          await elC.play().catch((e) => console.warn("[Floor] Customer play failed:", e.message));
          console.log("[Floor] Customer output playing via setSinkId");
        }

        // ── Sales: AudioContext → default output (system default device) ──
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        talkbackCtxRef.current = ctx;
        await ctx.resume();
        const source = ctx.createMediaStreamSource(new MediaStream([track.clone()]));
        const gainS = ctx.createGain();
        gainS.gain.value = 0; // start muted
        source.connect(gainS);
        gainS.connect(ctx.destination); // → system default output
        gainSalesRef.current = gainS;
        console.log("[Floor] Sales output playing via AudioContext default destination");

        applyTalkbackRouting(modeRef.current);
        console.log("[Floor] Hybrid talkback ready: customer=setSinkId, sales=AudioContext");
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

      pc.addTrack(cTrack, cStream);
      pc.addTrack(sTrack, sStream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { targetSocketId: supervisor.socketId, sdp: offer });
      setStatus("Offer sent — waiting for supervisor…");
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

  const stopLink = () => { teardown(); setStatus("Disconnected."); };
  useEffect(() => () => teardown(), [teardown]);

  // ─── UI ───

  const sameMicWarning = micCustomer && micSales && micCustomer === micSales;
  const sameEarpieceWarning = sinkCustomer && sinkSales && sinkCustomer === sinkSales;

  return (
    <div className="glass rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-white">Store desk (Meet laptop)</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Two headsets on this machine: customer mic + sales mic go to the supervisor.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Customer headset mic</label>
          <div className="flex gap-2">
            <select value={micCustomer} onChange={(e) => setMicCustomer(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
              ))}
            </select>
            <button type="button" disabled={!micCustomer || !!testing || linked}
              onClick={() => testMic(micCustomer, "customer")}
              className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-40">
              {testing === "customer" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Sales headset mic</label>
          <div className="flex gap-2">
            <select value={micSales} onChange={(e) => setMicSales(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
              {inputs.map((d) => (
                <option key={`s-${d.deviceId}`} value={d.deviceId}>{d.label || "Microphone"}</option>
              ))}
            </select>
            <button type="button" disabled={!micSales || !!testing || linked}
              onClick={() => testMic(micSales, "sales")}
              className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-40">
              {testing === "sales" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Supervisor → customer earpiece</label>
          <select value={sinkCustomer} onChange={(e) => setSinkCustomer(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
            <option value="">Default output</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Supervisor → sales earpiece</label>
          <select value={sinkSales} onChange={(e) => setSinkSales(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
            <option value="">Default output</option>
            {outputs.map((d) => (
              <option key={`o-${d.deviceId}`} value={d.deviceId}>{d.label || "Speaker"}</option>
            ))}
          </select>
        </div>
      </div>

      {sameMicWarning && (
        <p className="mt-2 text-xs text-amber-300">Customer and Sales are set to the same microphone.</p>
      )}
      {sameEarpieceWarning && (
        <p className="mt-2 text-xs text-amber-300">Customer and Sales earpieces are set to the same output device — select different devices.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!linked ? (
          <button type="button" disabled={linking || !backendConnected || !supervisor || sameMicWarning}
            onClick={startLink}
            className="rounded-xl bg-accent-teal/25 px-4 py-2 text-sm font-semibold text-accent-teal disabled:opacity-50">
            {linking ? "Connecting…" : "Start audio link to supervisor"}
          </button>
        ) : (
          <button type="button" onClick={stopLink}
            className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-400">
            Stop link
          </button>
        )}
        {!supervisor && <span className="text-xs text-amber-300">Waiting for supervisor to sign in…</span>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-zinc-500">Customer mic level</p>
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-accent-teal transition-all" style={{ width: `${inputLevels.customer}%` }} />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-zinc-500">Sales mic level</p>
          <div className="h-2 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-accent-teal transition-all" style={{ width: `${inputLevels.sales}%` }} />
          </div>
        </div>
      </div>

      {status && (
        <p className={`mt-3 text-sm ${
          status.includes("Error") || status.includes("failed") || status.includes("denied")
            ? "text-red-400"
            : status.includes("Connected") || status.includes("Linked")
              ? "text-emerald-400"
              : "text-zinc-400"
        }`}>{status}</p>
      )}

      {/* Customer earpiece (setSinkId route) — sales goes via AudioContext */}
      <audio ref={outAudioCustomerRef} className="hidden" playsInline />
    </div>
  );
}
