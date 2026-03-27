import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import ParticipantsSidebar from "./components/ParticipantsSidebar";
import AudioRoutingGraph from "./components/AudioRoutingGraph";
import SupervisorControls from "./components/SupervisorControls";
import BottomBar from "./components/BottomBar";
import AuthPanel from "./components/AuthPanel";
import FloorStationPanel from "./components/FloorStationPanel";
import { createMixerSocket } from "./services/socket";
import useLocalMixer from "./hooks/useLocalMixer";

const initialState = {
  mode: "listen",
  volume: 75,
  channelL: 68,
  channelR: 72,
  ringing: false,
  focusOn: false,
  recordOn: false,
  connected: true,
  participants: [
    {
      id: "customer",
      name: "Customer",
      role: "Customer",
      initial: "C",
      micOn: true,
      monitoring: false,
    },
    {
      id: "sales",
      name: "Priya Mehta",
      role: "Sales Executive",
      initial: "S",
      micOn: true,
      monitoring: false,
    },
    {
      id: "supervisor",
      name: "Ankit Verma",
      role: "Supervisor",
      initial: "SV",
      micOn: false,
      monitoring: true,
    },
  ],
};

export default function App() {
  const [mixerState, setMixerState] = useState(initialState);
  const [backendConnected, setBackendConnected] = useState(false);
  const [presence, setPresence] = useState([]);
  const [auth, setAuth] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [floorInbound, setFloorInbound] = useState({ customer: null, sales: null });
  const socket = useMemo(() => createMixerSocket(), []);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioFloorCustomerRef = useRef(null);
  const audioFloorSalesRef = useRef(null);
  const floorInboundOrderRef = useRef(0);
  const loginTimeoutRef = useRef(null);
  const authRef = useRef(null);
  authRef.current = auth;

  const isAuthed = Boolean(auth?.role);
  const isSupervisor = auth?.role === "supervisor";
  const isFloor = auth?.role === "floor";
  const canRingBell = auth?.role === "supervisor" || auth?.role === "floor";
  const localMixer = useLocalMixer({
    connected: mixerState.connected,
    mode: mixerState.mode,
  });

  useEffect(() => {
    const handleConnect = () => setBackendConnected(true);
    const handleDisconnect = () => setBackendConnected(false);
    const handleStateUpdate = (nextState) => setMixerState(nextState);
    const handlePresenceUpdate = (nextPresence) => setPresence(nextPresence);
    const handleAuthOk = (session) => {
      if (loginTimeoutRef.current) {
        clearTimeout(loginTimeoutRef.current);
        loginTimeoutRef.current = null;
      }
      setAuth(session);
      setAuthError("");
      setAuthLoading(false);
    };
    const handleAuthError = ({ message }) => {
      if (loginTimeoutRef.current) {
        clearTimeout(loginTimeoutRef.current);
        loginTimeoutRef.current = null;
      }
      setAuthError(message || "Authentication failed");
      setAuthLoading(false);
    };
    const handleSessionReplaced = () => {
      setAuth(null);
      setPresence([]);
      setAuthError("Session ended: this role logged in from another device.");
      cleanupPeers();
    };

    const handleOffer = async ({ fromSocketId, fromRole, sdp }) => {
      if (!sdp || authRef.current?.role !== "supervisor" || fromRole !== "floor") return;
      floorInboundOrderRef.current = 0;
      setFloorInbound({ customer: null, sales: null });
      const existing = peerConnectionsRef.current.get(fromSocketId);
      if (existing) existing.close();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peerConnectionsRef.current.set(fromSocketId, pc);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        socket.emit("webrtc:ice", {
          targetSocketId: fromSocketId,
          candidate: event.candidate,
        });
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        const idx = floorInboundOrderRef.current++;
        const key = idx === 0 ? "customer" : "sales";
        setFloorInbound((prev) => ({ ...prev, [key]: stream }));
      };

      await pc.setRemoteDescription(sdp);
      if (!localStreamRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          localStreamRef.current = stream;
          setMediaError("");
        } catch {
          setMediaError("Supervisor microphone unavailable.");
          return;
        }
      }
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) pc.addTrack(track, localStreamRef.current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { targetSocketId: fromSocketId, sdp: answer });
    };

    const handleIce = async ({ fromSocketId, candidate }) => {
      if (!candidate) return;
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) return;
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    };

    const handlePeerLeft = ({ socketId, role }) => {
      if (role !== "floor") return;
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
      setFloorInbound({ customer: null, sales: null });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("state:update", handleStateUpdate);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("auth:ok", handleAuthOk);
    socket.on("auth:error", handleAuthError);
    socket.on("session:replaced", handleSessionReplaced);
    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:ice", handleIce);
    socket.on("peer:left", handlePeerLeft);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("state:update", handleStateUpdate);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("auth:ok", handleAuthOk);
      socket.off("auth:error", handleAuthError);
      socket.off("session:replaced", handleSessionReplaced);
      socket.off("webrtc:offer", handleOffer);
      socket.off("webrtc:ice", handleIce);
      socket.off("peer:left", handlePeerLeft);
      cleanupPeers();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (loginTimeoutRef.current) {
        clearTimeout(loginTimeoutRef.current);
      }
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  function cleanupPeers() {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setFloorInbound({ customer: null, sales: null });
  }

  async function startLocalAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      setMediaError("");
      if (authRef.current?.role === "supervisor") {
        socket.emit("media:micState", { micOn: true });
      }
    } catch (error) {
      setMediaError("Microphone permission denied or unavailable.");
      if (authRef.current?.role === "supervisor") {
        socket.emit("media:micState", { micOn: false });
      }
    }
  }

  useEffect(() => {
    if (!isAuthed || auth?.role !== "supervisor") return;
    if (!localStreamRef.current) {
      startLocalAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, auth?.role]);

  useEffect(() => {
    if (auth?.role !== "supervisor") return;
    const self = mixerState.participants.find((p) => p.id === "supervisor");
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (track && self) {
      track.enabled = Boolean(self.micOn);
    }
  }, [mixerState.participants, auth?.role]);

  const vol = mixerState.connected ? 1 : 0;
  useEffect(() => {
    if (auth?.role !== "supervisor") return;
    const c = audioFloorCustomerRef.current;
    const s = audioFloorSalesRef.current;
    if (c && floorInbound.customer) {
      c.srcObject = floorInbound.customer;
      c.volume = vol;
      c.play().catch(() => {});
    }
    if (s && floorInbound.sales) {
      s.srcObject = floorInbound.sales;
      s.volume = vol;
      s.play().catch(() => {});
    }
  }, [auth?.role, floorInbound.customer, floorInbound.sales, vol]);

  const handleLogin = ({ role, name, pin }) => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
    setAuthLoading(true);
    setAuthError("");
    const emitLogin = () => socket.emit("auth:login", { role, name, pin });

    if (!socket.connected) {
      socket.connect();
      setAuthError("Connecting to backend...");
      const onConnectOnce = () => {
        socket.off("connect", onConnectOnce);
        emitLogin();
      };
      socket.on("connect", onConnectOnce);
    } else {
      emitLogin();
    }

    loginTimeoutRef.current = setTimeout(() => {
      setAuthLoading(false);
      setAuthError("Login timed out. Please retry.");
    }, 7000);
  };

  if (!isAuthed) {
    return (
      <AuthPanel
        onLogin={handleLogin}
        loading={authLoading}
        error={authError}
        backendConnected={backendConnected}
      />
    );
  }

  const isTalkToCustomer =
    mixerState.mode === "talk-customer" || mixerState.mode === "talk-both";
  const isTalkToSales =
    mixerState.mode === "talk-sales" || mixerState.mode === "talk-both";

  const useLiveLevels = isSupervisor && localMixer.running;
  const speaking = {
    customer:
      Boolean(mixerState.participants.find((p) => p.id === "customer")?.micOn) &&
      mixerState.connected &&
      (useLiveLevels ? localMixer.levels.customer > 6 : true),
    sales:
      Boolean(mixerState.participants.find((p) => p.id === "sales")?.micOn) &&
      mixerState.connected &&
      (useLiveLevels ? localMixer.levels.sales > 6 : true),
    supervisor:
      Boolean(mixerState.participants.find((p) => p.id === "supervisor")?.micOn) &&
      mixerState.connected &&
      mixerState.mode !== "listen" &&
      (useLiveLevels ? localMixer.levels.supervisor > 6 : true),
  };

  const routes = {
    customerSalesActive:
      mixerState.connected && speaking.customer && speaking.sales,
    customerToSupervisor: mixerState.connected && speaking.customer,
    salesToSupervisor: mixerState.connected && speaking.sales,
    supervisorToCustomer:
      mixerState.connected && isTalkToCustomer && speaking.supervisor,
    supervisorToSales: mixerState.connected && isTalkToSales && speaking.supervisor,
  };

  const simulateLevels = () => {
    if (localMixer.running) {
      return {
        l: localMixer.levels.monitorL,
        r: localMixer.levels.monitorR,
      };
    }
    const t = Date.now() / 420;
    return {
      l: mixerState.connected
        ? Math.min(100, Math.max(8, mixerState.channelL + Math.sin(t) * 14))
        : 0,
      r: mixerState.connected
        ? Math.min(100, Math.max(8, mixerState.channelR + Math.cos(t * 1.07) * 14))
        : 0,
    };
  };

  const onToggleMic = (id) => {
    if (!isSupervisor && !isFloor && id !== auth.role) return;
    if (isFloor && id !== "customer" && id !== "sales") return;
    socket.emit("control:toggleMic", { id });
  };

  return (
    <div className="flex h-full min-h-[720px] flex-col bg-surface p-3 md:p-4">
      <Header connected={mixerState.connected && backendConnected} />

      {isFloor && (
        <div className="mt-3 shrink-0">
          <FloorStationPanel
            socket={socket}
            presence={presence}
            mixerState={mixerState}
            backendConnected={backendConnected}
          />
        </div>
      )}

      <main className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1.35fr)_280px] lg:gap-4 lg:items-stretch">
        <ParticipantsSidebar
          participants={mixerState.participants}
          speaking={speaking}
          onToggleMic={onToggleMic}
          focusOn={mixerState.focusOn}
          currentRole={auth.role}
          canToggleAll={isSupervisor || isFloor}
        />
        <AudioRoutingGraph routes={routes} mode={mixerState.mode} />
        <SupervisorControls
          mode={mixerState.mode}
          onModeChange={(mode) => {
            if (!isSupervisor) return;
            socket.emit("control:setMode", { mode });
          }}
          volume={mixerState.volume}
          onVolumeChange={(volume) => {
            if (!isSupervisor) return;
            socket.emit("control:setVolume", { volume });
          }}
          channelL={mixerState.channelL}
          channelR={mixerState.channelR}
          onChannelLChange={(channelL) =>
            isSupervisor && socket.emit("control:setChannelL", { channelL })
          }
          onChannelRChange={(channelR) =>
            isSupervisor && socket.emit("control:setChannelR", { channelR })
          }
          liveLevels={simulateLevels}
          connected={mixerState.connected && backendConnected}
          canManage={isSupervisor}
          inputDevices={isSupervisor ? localMixer.inputDevices : []}
          selectedInputs={isSupervisor ? localMixer.selectedInputs : {}}
          onSelectInput={(role, deviceId) =>
            isSupervisor &&
            localMixer.setSelectedInputs((prev) => ({ ...prev, [role]: deviceId }))
          }
          onStartMixer={isSupervisor ? localMixer.start : () => {}}
          onStopMixer={isSupervisor ? localMixer.stop : () => {}}
          mixerRunning={isSupervisor && localMixer.running}
          mixerError={isSupervisor ? localMixer.error : ""}
          floorHint={isFloor}
        />
      </main>

      {mediaError && (
        <p className="mt-2 text-center text-sm text-red-400">{mediaError}</p>
      )}

      <BottomBar
        ringing={mixerState.ringing}
        onRingToggle={() =>
          canRingBell &&
          socket.emit("control:setRinging", { ringing: !mixerState.ringing })
        }
        focusOn={mixerState.focusOn}
        onFocusToggle={() =>
          isSupervisor &&
          socket.emit("control:setFocus", { focusOn: !mixerState.focusOn })
        }
        recordOn={mixerState.recordOn}
        onRecordToggle={() =>
          isSupervisor &&
          socket.emit("control:setRecord", { recordOn: !mixerState.recordOn })
        }
        connected={mixerState.connected && backendConnected}
        onConnectedToggle={() =>
          isSupervisor &&
          socket.emit("control:setConnected", { connected: !mixerState.connected })
        }
        canRing={canRingBell}
        canManage={isSupervisor}
      />

      {isSupervisor && (
        <>
          <audio ref={audioFloorCustomerRef} className="hidden" playsInline autoPlay />
          <audio ref={audioFloorSalesRef} className="hidden" playsInline autoPlay />
        </>
      )}
    </div>
  );
}
