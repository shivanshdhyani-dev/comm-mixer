import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const createInitialState = () => ({
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
});

let mixerState = createInitialState();
const sessionsBySocket = new Map();
const socketByRole = new Map();

const ROLE_PINS = {
  supervisor: process.env.SUPERVISOR_PIN || "1234",
  /** Store laptop: customer + sales headsets, same machine as Meet */
  floor: process.env.FLOOR_PIN || "3333",
};

function broadcastState() {
  io.emit("state:update", mixerState);
}

function broadcastPresence() {
  const presence = Array.from(sessionsBySocket.entries()).map(([socketId, s]) => ({
    socketId,
    role: s.role,
    name: s.name,
  }));
  io.emit("presence:update", presence);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function updateState(partialUpdater) {
  mixerState = partialUpdater(mixerState);
  broadcastState();
}

function getSession(socket) {
  return sessionsBySocket.get(socket.id);
}

function isSupervisor(socket) {
  const s = getSession(socket);
  return s?.role === "supervisor";
}

function canToggleParticipant(socket, participantId) {
  const s = getSession(socket);
  if (!s) return false;
  if (s.role === "supervisor") return true;
  if (s.role === "floor" && (participantId === "customer" || participantId === "sales"))
    return true;
  return s.role === participantId;
}

function setParticipantMic(participantId, micOn) {
  updateState((prev) => ({
    ...prev,
    participants: prev.participants.map((participant) =>
      participant.id === participantId ? { ...participant, micOn: Boolean(micOn) } : participant
    ),
  }));
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", (_req, res) => {
  res.json(mixerState);
});

app.post("/api/reset", (_req, res) => {
  mixerState = createInitialState();
  broadcastState();
  res.json(mixerState);
});

io.on("connection", (socket) => {
  socket.emit("state:update", mixerState);
  socket.emit("auth:required", { ok: false, message: "Please authenticate" });

  socket.on("auth:login", ({ role, pin, name }) => {
    const normalizedRole = String(role || "").toLowerCase();
    const validRoles = ["supervisor", "floor"];

    if (!validRoles.includes(normalizedRole)) {
      socket.emit("auth:error", { message: "Invalid role" });
      return;
    }
    if (String(pin || "") !== ROLE_PINS[normalizedRole]) {
      socket.emit("auth:error", { message: "Invalid PIN for selected role" });
      return;
    }

    const displayName =
      String(name || "").trim() ||
      (normalizedRole === "supervisor" ? "Supervisor" : "Store desk");

    const existingSocketForRole = socketByRole.get(normalizedRole);
    if (existingSocketForRole && existingSocketForRole !== socket.id) {
      io.to(existingSocketForRole).emit("session:replaced", {
        message: "Signed out because this role logged in from another device",
      });
      const stale = io.sockets.sockets.get(existingSocketForRole);
      if (stale) stale.disconnect(true);
    }

    sessionsBySocket.set(socket.id, { role: normalizedRole, name: displayName });
    socketByRole.set(normalizedRole, socket.id);

    updateState((prev) => ({
      ...prev,
      participants: prev.participants.map((p) => {
        if (normalizedRole === "floor" && p.id === "sales") {
          return { ...p, name: displayName };
        }
        if (p.id === normalizedRole) return { ...p, name: displayName };
        return p;
      }),
    }));

    socket.emit("auth:ok", { role: normalizedRole, name: displayName });
    broadcastPresence();
  });

  socket.on("media:micState", ({ micOn }) => {
    const session = getSession(socket);
    if (!session) return;
    if (session.role === "floor") return;
    setParticipantMic(session.role, Boolean(micOn));
  });

  socket.on("control:setMode", ({ mode }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, mode }));
  });

  socket.on("control:setVolume", ({ volume }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, volume: clampPercent(volume) }));
  });

  socket.on("control:setChannelL", ({ channelL }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, channelL: clampPercent(channelL) }));
  });

  socket.on("control:setChannelR", ({ channelR }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, channelR: clampPercent(channelR) }));
  });

  socket.on("control:setRinging", ({ ringing }) => {
    const session = getSession(socket);
    if (!session || (session.role !== "supervisor" && session.role !== "floor")) return;
    updateState((prev) => ({ ...prev, ringing: Boolean(ringing) }));
  });

  socket.on("control:setFocus", ({ focusOn }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, focusOn: Boolean(focusOn) }));
  });

  socket.on("control:setRecord", ({ recordOn }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, recordOn: Boolean(recordOn) }));
  });

  socket.on("control:setConnected", ({ connected }) => {
    if (!isSupervisor(socket)) return;
    updateState((prev) => ({ ...prev, connected: Boolean(connected) }));
  });

  socket.on("control:toggleMic", ({ id }) => {
    if (!canToggleParticipant(socket, id)) return;
    updateState((prev) => ({
      ...prev,
      participants: prev.participants.map((participant) =>
        participant.id === id ? { ...participant, micOn: !participant.micOn } : participant
      ),
    }));
  });

  socket.on("webrtc:offer", ({ targetSocketId, sdp }) => {
    const session = getSession(socket);
    if (!session || !targetSocketId || !sdp) return;
    io.to(targetSocketId).emit("webrtc:offer", {
      fromSocketId: socket.id,
      fromRole: session.role,
      sdp,
    });
  });

  socket.on("webrtc:answer", ({ targetSocketId, sdp }) => {
    const session = getSession(socket);
    if (!session || !targetSocketId || !sdp) return;
    io.to(targetSocketId).emit("webrtc:answer", {
      fromSocketId: socket.id,
      fromRole: session.role,
      sdp,
    });
  });

  socket.on("webrtc:ice", ({ targetSocketId, candidate }) => {
    const session = getSession(socket);
    if (!session || !targetSocketId || !candidate) return;
    io.to(targetSocketId).emit("webrtc:ice", {
      fromSocketId: socket.id,
      fromRole: session.role,
      candidate,
    });
  });

  socket.on("disconnect", () => {
    const s = sessionsBySocket.get(socket.id);
    if (s) {
      sessionsBySocket.delete(socket.id);
      if (socketByRole.get(s.role) === socket.id) {
        socketByRole.delete(s.role);
      }
      io.emit("peer:left", { socketId: socket.id, role: s.role });
      broadcastPresence();
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`CommMixer backend listening on http://localhost:${PORT}`);
});
