import { useCallback, useEffect, useRef, useState } from "react";

function rmsFromTimeData(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const centered = (data[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

export default function useLocalMixer({ connected, mode }) {
  const [devices, setDevices] = useState([]);
  const [selectedInputs, setSelectedInputs] = useState({
    customer: "",
    sales: "",
    supervisor: "",
  });
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState({
    customer: 0,
    sales: 0,
    supervisor: 0,
    monitorL: 0,
    monitorR: 0,
  });
  const [error, setError] = useState("");

  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const streamsRef = useRef({});
  const analysersRef = useRef({});
  const talkbackGainRef = useRef({ customer: null, sales: null });

  const inputDevices = devices.filter((d) => d.kind === "audioinput");

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    Object.values(streamsRef.current).forEach((stream) => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    });
    streamsRef.current = {};
    analysersRef.current = {};
    if (ctxRef.current) {
      ctxRef.current.close();
      ctxRef.current = null;
    }
    talkbackGainRef.current = { customer: null, sales: null };
    setRunning(false);
    setLevels({
      customer: 0,
      sales: 0,
      supervisor: 0,
      monitorL: 0,
      monitorR: 0,
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list);
    const inputs = list.filter((d) => d.kind === "audioinput");
    setSelectedInputs((prev) => ({
      customer: prev.customer || inputs[0]?.deviceId || "",
      sales: prev.sales || inputs[1]?.deviceId || inputs[0]?.deviceId || "",
      supervisor: prev.supervisor || inputs[2]?.deviceId || inputs[0]?.deviceId || "",
    }));
  }, []);

  useEffect(() => {
    refreshDevices().catch(() => {});
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      stop();
    };
  }, [refreshDevices, stop]);

  const start = useCallback(async () => {
    try {
      setError("");
      stop();

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;

      const monitorMerger = ctx.createChannelMerger(2);
      const monitorAnalyser = ctx.createAnalyser();
      monitorAnalyser.fftSize = 256;
      monitorMerger.connect(monitorAnalyser);
      monitorMerger.connect(ctx.destination);

      const roles = ["customer", "sales", "supervisor"];
      for (const role of roles) {
        const deviceId = selectedInputs[role];
        if (!deviceId) continue;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        streamsRef.current[role] = stream;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analysersRef.current[role] = analyser;

        if (role === "customer" || role === "sales") {
          const gain = ctx.createGain();
          gain.gain.value = connected ? 1 : 0;
          source.connect(gain);
          gain.connect(monitorMerger, 0, 0);
          gain.connect(monitorMerger, 0, 1);
          talkbackGainRef.current[role] = gain;
        }
      }

      analysersRef.current.monitor = monitorAnalyser;
      setRunning(true);

      const customerData = new Uint8Array(analysersRef.current.customer?.frequencyBinCount || 128);
      const salesData = new Uint8Array(analysersRef.current.sales?.frequencyBinCount || 128);
      const supervisorData = new Uint8Array(analysersRef.current.supervisor?.frequencyBinCount || 128);
      const monitorData = new Uint8Array(monitorAnalyser.frequencyBinCount);

      const tick = () => {
        const cA = analysersRef.current.customer;
        const sA = analysersRef.current.sales;
        const svA = analysersRef.current.supervisor;
        if (cA) cA.getByteTimeDomainData(customerData);
        if (sA) sA.getByteTimeDomainData(salesData);
        if (svA) svA.getByteTimeDomainData(supervisorData);
        monitorAnalyser.getByteTimeDomainData(monitorData);

        setLevels({
          customer: Math.min(100, Math.round(rmsFromTimeData(customerData) * 260)),
          sales: Math.min(100, Math.round(rmsFromTimeData(salesData) * 260)),
          supervisor: Math.min(100, Math.round(rmsFromTimeData(supervisorData) * 260)),
          monitorL: Math.min(100, Math.round(rmsFromTimeData(monitorData) * 260)),
          monitorR: Math.min(100, Math.round(rmsFromTimeData(monitorData) * 260)),
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError("Could not start local mixer. Check microphone permissions and device selection.");
      stop();
    }
  }, [connected, selectedInputs, stop]);

  useEffect(() => {
    if (!running) return;
    const gainCustomer = talkbackGainRef.current.customer;
    const gainSales = talkbackGainRef.current.sales;
    const allow = connected ? 1 : 0;
    if (gainCustomer) gainCustomer.gain.value = allow;
    if (gainSales) gainSales.gain.value = allow;
  }, [connected, mode, running]);

  return {
    inputDevices,
    selectedInputs,
    setSelectedInputs,
    start,
    stop,
    running,
    levels,
    error,
  };
}
