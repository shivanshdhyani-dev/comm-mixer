import { io } from "socket.io-client";

/** Prefer VITE_BACKEND_URL. Dev → localhost; production build without env → deploy backend (not user localhost). */
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:4000" : "https://comm-mixer.onrender.com");

export function createMixerSocket() {
  return io(BACKEND_URL, {
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    timeout: 10000,
  });
}
