/**
 * ICE servers for WebRTC. For live / cross-network tests, set VITE_WEBRTC_ICE_SERVERS
 * to a JSON array, e.g. [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:...","username":"...","credential":"..."}]
 */
export function getIceServers() {
  const raw = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through */
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}
