import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import ParticipantsSidebar from "./components/ParticipantsSidebar";
import AudioRoutingGraph from "./components/AudioRoutingGraph";
import SupervisorControls from "./components/SupervisorControls";
import BottomBar from "./components/BottomBar";
import AuthPanel from "./components/AuthPanel";
import { createMixerSocket } from "./services/socket";

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
  const [remoteStreams, setRemoteStreams] = useState([]);
  const socket = useMemo(() => createMixerSocket(), []);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioRefs = useRef(new Map());
  const loginTimeoutRef = useRef(null);

  const isAuthed = Boolean(auth?.role);
  const isSupervisor = auth?.role === "supervisor";
  const canRingBell = auth?.role === "supervisor" || auth?.role === "sales";

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
      const pc = ensurePeerConnection(fromSocketId, fromRole);
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { targetSocketId: fromSocketId, sdp: answer });
    };

    const handleAnswer = async ({ fromSocketId, sdp }) => {
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) return;
      await pc.setRemoteDescription(sdp);
    };

    const handleIce = async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) return;
      await pc.addIceCandidate(candidate);
    };

    const handlePeerLeft = ({ socketId }) => {
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(socketId);
      }
      setRemoteStreams((prev) => prev.filter((p) => p.socketId !== socketId));
      audioRefs.current.delete(socketId);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("state:update", handleStateUpdate);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("auth:ok", handleAuthOk);
    socket.on("auth:error", handleAuthError);
    socket.on("session:replaced", handleSessionReplaced);
    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
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
      socket.off("webrtc:answer", handleAnswer);
      socket.off("webrtc:ice", handleIce);
      socket.off("peer:left", handlePeerLeft);
      cleanupPeers();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
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
    setRemoteStreams([]);
  }

  function ensurePeerConnection(targetSocketId, targetRole) {
    if (peerConnectionsRef.current.has(targetSocketId)) {
      return peerConnectionsRef.current.get(targetSocketId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("webrtc:ice", {
        targetSocketId,
        candidate: event.candidate,
      });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteStreams((prev) => {
        const exists = prev.find((p) => p.socketId === targetSocketId);
        if (exists) {
          return prev.map((p) =>
            p.socketId === targetSocketId ? { ...p, role: targetRole, stream } : p
          );
        }
        return [...prev, { socketId: targetSocketId, role: targetRole, stream }];
      });
    };

    peerConnectionsRef.current.set(targetSocketId, pc);
    return pc;
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
      socket.emit("media:micState", { micOn: true });
    } catch (error) {
      setMediaError("Microphone permission denied or unavailable.");
      socket.emit("media:micState", { micOn: false });
    }
  }

  useEffect(() => {
    if (!isAuthed) return;
    if (!localStreamRef.current) {
      startLocalAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || !backendConnected) return;
    const currentPeers = presence.filter((p) => p.socketId !== socket.id);
    currentPeers.forEach(async (peer) => {
      const pc = ensurePeerConnection(peer.socketId, peer.role);
      const shouldInitiate = socket.id > peer.socketId;
      if (!shouldInitiate) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { targetSocketId: peer.socketId, sdp: offer });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, isAuthed, backendConnected]);

  useEffect(() => {
    if (!auth?.role) return;
    const self = mixerState.participants.find((p) => p.id === auth.role);
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (track && self) {
      track.enabled = Boolean(self.micOn);
    }
  }, [mixerState.participants, auth]);

  useEffect(() => {
    const connected = mixerState.connected;
    remoteStreams.forEach(({ socketId, role }) => {
      const el = audioRefs.current.get(socketId);
      if (!el) return;
      el.volume = getPlaybackVolume({
        viewerRole: auth?.role,
        remoteRole: role,
        mode: mixerState.mode,
        connected,
      });
    });
  }, [remoteStreams, mixerState.mode, mixerState.connected, auth]);

  function getPlaybackVolume({ viewerRole, remoteRole, mode, connected }) {
    if (!connected || !viewerRole || viewerRole === remoteRole) return 0;
    if (viewerRole === "supervisor") {
      return remoteRole === "customer" || remoteRole === "sales" ? 1 : 0;
    }
    if (viewerRole === "customer") {
      if (remoteRole === "sales") return 1;
      if (remoteRole === "supervisor") {
        return mode === "talk-customer" || mode === "talk-both" ? 1 : 0;
      }
    }
    if (viewerRole === "sales") {
      if (remoteRole === "customer") return 1;
      if (remoteRole === "supervisor") {
        return mode === "talk-sales" || mode === "talk-both" ? 1 : 0;
      }
    }
    return 0;
  }

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

  const speaking = {
    customer:
      mixerState.participants.find((p) => p.id === "customer")?.micOn &&
      mixerState.connected,
    sales:
      mixerState.participants.find((p) => p.id === "sales")?.micOn &&
      mixerState.connected,
    supervisor:
      mixerState.participants.find((p) => p.id === "supervisor")?.micOn &&
      mixerState.connected &&
      mixerState.mode !== "listen",
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
    if (!isSupervisor && id !== auth.role) return;
    socket.emit("control:toggleMic", { id });
  };

  return (
    <div className="flex h-full min-h-[720px] flex-col bg-surface p-3 md:p-4">
      <Header connected={mixerState.connected && backendConnected} />

      <main className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1.35fr)_280px] lg:gap-4 lg:items-stretch">
        <ParticipantsSidebar
          participants={mixerState.participants}
          speaking={speaking}
          onToggleMic={onToggleMic}
          focusOn={mixerState.focusOn}
          currentRole={auth.role}
          canToggleAll={isSupervisor}
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

      {remoteStreams.map(({ socketId, stream }) => (
        <audio
          key={socketId}
          autoPlay
          playsInline
          ref={(el) => {
            if (!el) return;
            el.srcObject = stream;
            audioRefs.current.set(socketId, el);
          }}
        />
      ))}
    </div>
  );
}
