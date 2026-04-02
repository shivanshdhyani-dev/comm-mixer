/**
 * ICE servers for WebRTC.
 *
 * Override with VITE_WEBRTC_ICE_SERVERS env var (JSON array), e.g.:
 *   [{"urls":"turn:your.server:3478","username":"user","credential":"pass"}]
 *
 * Default includes STUN + free TURN relays so cross-network calls work
 * without any extra setup.
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

  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:freeturn.net:3478",
      username: "free",
      credential: "free",
    },
    {
      urls: "turn:freeturn.net:5349",
      username: "free",
      credential: "free",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];
}
