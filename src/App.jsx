import { useEffect, useMemo, useRef, useState } from "react";
import SupervisorControls from "./components/SupervisorControls";
import AuthPanel from "./components/AuthPanel";
import FloorStationPanel from "./components/FloorStationPanel";
import { createMixerSocket } from "./services/socket";
import { getIceServers } from "./webrtcConfig";

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
      micOn: true,
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
  const [floorConnectionState, setFloorConnectionState] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const socket = useMemo(() => createMixerSocket(), []);
  const localStreamRef = useRef(null);
  const localStreamPromiseRef = useRef(null);
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
  /* canRingBell removed — ring bell feature stripped from simplified UI */

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

      try {
        floorInboundOrderRef.current = 0;
        setFloorInbound({ customer: null, sales: null });
        setFloorConnectionState("connecting");

        const existing = peerConnectionsRef.current.get(fromSocketId);
        if (existing) existing.close();

        const pc = new RTCPeerConnection({
          iceServers: getIceServers(),
          bundlePolicy: "max-bundle",
          iceTransportPolicy: "relay",
        });
        peerConnectionsRef.current.set(fromSocketId, pc);

        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          console.log("[Supervisor] ICE connection state:", state);
          setFloorConnectionState(state);
        };

        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          socket.emit("webrtc:ice", {
            targetSocketId: fromSocketId,
            candidate: event.candidate,
          });
        };

        pc.ontrack = (event) => {
          const track = event.track;
          if (track.kind !== "audio") return;
          const stream = new MediaStream([track]);
          const idx = floorInboundOrderRef.current++;
          const label = idx === 0 ? "customer" : "sales";
          console.log(`[Supervisor] ontrack #${idx} (${label}): enabled=${track.enabled} readyState=${track.readyState}`);
          if (idx === 0) {
            setFloorInbound((prev) => ({ ...prev, customer: stream }));
          } else {
            setFloorInbound((prev) => ({ ...prev, sales: stream }));
          }
        };

        await pc.setRemoteDescription(sdp);

        // Acquire supervisor mic via shared promise
        if (!localStreamPromiseRef.current) {
          localStreamPromiseRef.current = navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          }).then((stream) => {
            localStreamRef.current = stream;
            setMediaError("");
            socket.emit("media:micState", { micOn: true });
            return stream;
          }).catch((micErr) => {
            console.warn("[Supervisor] Mic unavailable (talk-back disabled):", micErr.message);
            setMediaError("Supervisor mic unavailable — you can hear floor but cannot talk back.");
            return null;
          });
        }
        await localStreamPromiseRef.current;

        // Send supervisor mic on the FIRST audio transceiver only.
        // The floor receives one talkback track and routes it to the
        // correct headset(s) via dynamic setSinkId switching.
        if (localStreamRef.current) {
          const track = localStreamRef.current.getAudioTracks()[0];
          if (track) {
            const transceivers = pc.getTransceivers().filter(
              (t) => t.receiver?.track?.kind === "audio" && !t.stopped
            );
            if (transceivers.length > 0) {
              transceivers[0].direction = "sendrecv";
              await transceivers[0].sender.replaceTrack(track);
              console.log("[Supervisor] Mic on transceiver 0 for talk-back");
            }
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:answer", { targetSocketId: fromSocketId, sdp: answer });
        console.log("[Supervisor] Answer sent to floor");
      } catch (err) {
        console.error("[Supervisor] handleOffer failed:", err);
        setMediaError("Failed to establish connection with floor: " + err.message);
        setFloorConnectionState("failed");
      }
    };

    const handleIce = async ({ fromSocketId, candidate }) => {
      if (!candidate) return;
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) return;
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("[Supervisor] Failed to add ICE candidate:", err.message);
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
    if (localStreamRef.current) {
      if (authRef.current?.role === "supervisor") {
        socket.emit("media:micState", { micOn: true });
      }
      return;
    }
    if (!localStreamPromiseRef.current) {
      localStreamPromiseRef.current = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }).then((stream) => {
        localStreamRef.current = stream;
        setMediaError("");
        if (authRef.current?.role === "supervisor") {
          socket.emit("media:micState", { micOn: true });
        }
        return stream;
      }).catch(() => {
        setMediaError("Microphone permission denied or unavailable.");
        if (authRef.current?.role === "supervisor") {
          socket.emit("media:micState", { micOn: false });
        }
        return null;
      });
    }
    await localStreamPromiseRef.current;
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
    const tryPlay = (el, label) => {
      if (!el) return;
      el.play()
        .then(() => {
          console.log(`[Supervisor] Audio playing: ${label}, volume=${el.volume}, muted=${el.muted}`);
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          console.warn(`[Supervisor] Autoplay blocked for ${label}:`, err.message);
          setAutoplayBlocked(true);
          const once = () => {
            el.play()
              .then(() => setAutoplayBlocked(false))
              .catch(() => {});
            document.removeEventListener("click", once);
            document.removeEventListener("keydown", once);
          };
          document.addEventListener("click", once);
          document.addEventListener("keydown", once);
        });
    };
    if (c && floorInbound.customer) {
      console.log("[Supervisor] Setting customer audio stream, vol=", vol);
      c.srcObject = floorInbound.customer;
      c.volume = vol;
      tryPlay(c, "customer");
    }
    if (s && floorInbound.sales) {
      console.log("[Supervisor] Setting sales audio stream, vol=", vol);
      s.srcObject = floorInbound.sales;
      s.volume = vol;
      tryPlay(s, "sales");
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

  const onToggleMic = (id) => {
    if (!isSupervisor && !isFloor && id !== auth.role) return;
    if (isFloor && id !== "customer" && id !== "sales") return;
    socket.emit("control:toggleMic", { id });
  };

  const participants = mixerState.participants;

  return (
    <div className="flex h-full flex-col bg-surface p-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">CommMixer</h1>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${
          backendConnected ? "text-green-400" : "text-red-400"
        }`}>
          <span className={`inline-block h-2 w-2 rounded-full ${
            backendConnected ? "bg-green-400" : "bg-red-400"
          }`} />
          {backendConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* ── Floor station panel ── */}
      {isFloor && (
        <div className="mt-4">
          <FloorStationPanel
            socket={socket}
            presence={presence}
            mixerState={mixerState}
            backendConnected={backendConnected}
          />
        </div>
      )}

      {/* ── Supervisor panel ── */}
      {isSupervisor && (
        <div className="mt-4 space-y-4">
          {/* Mode buttons */}
          <div className="glass rounded-2xl p-5">
            <h2 className="mb-1 text-base font-semibold text-white">Talk Mode</h2>
            <p className="mb-4 text-xs text-zinc-500">
              Default is Listen Only. Select a mode to talk back.
            </p>
            <SupervisorControls
              mode={mixerState.mode}
              onModeChange={(mode) => socket.emit("control:setMode", { mode })}
              canManage={true}
            />
          </div>

          {/* Mic controls */}
          <div className="glass rounded-2xl p-5">
            <h2 className="mb-3 text-base font-semibold text-white">Participants</h2>
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
                  <div>
                    <span className="text-sm font-medium text-white">{p.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">{p.role}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleMic(p.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      p.micOn
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {p.micOn ? "Mic On" : "Mic Off"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Floor connection status */}
          {floorConnectionState && (
            <p className={`text-center text-xs font-medium ${
              floorConnectionState === "connected" ? "text-green-400" :
              floorConnectionState === "failed" || floorConnectionState === "disconnected" ? "text-red-400" :
              "text-yellow-400"
            }`}>
              Floor connection: {floorConnectionState}
            </p>
          )}

          {autoplayBlocked && (
            <div
              className="cursor-pointer rounded-lg bg-yellow-600/90 px-4 py-2 text-center text-sm font-medium text-white"
              onClick={() => {
                [audioFloorCustomerRef, audioFloorSalesRef].forEach((ref) => {
                  ref.current?.play()
                    .then(() => setAutoplayBlocked(false))
                    .catch(() => {});
                });
              }}
            >
              Click here to enable audio playback
            </div>
          )}

          {mediaError && (
            <p className="text-center text-sm text-red-400">{mediaError}</p>
          )}

          <audio ref={audioFloorCustomerRef} className="hidden" playsInline autoPlay />
          <audio ref={audioFloorSalesRef} className="hidden" playsInline autoPlay />
        </div>
      )}
    </div>
  );
}
