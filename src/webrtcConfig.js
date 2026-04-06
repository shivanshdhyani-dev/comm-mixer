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
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "c9f55f875ce4ce15621ac360",
      credential: "3+gyTXEoTp2BNn5w",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "c9f55f875ce4ce15621ac360",
      credential: "3+gyTXEoTp2BNn5w",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "c9f55f875ce4ce15621ac360",
      credential: "3+gyTXEoTp2BNn5w",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "c9f55f875ce4ce15621ac360",
      credential: "3+gyTXEoTp2BNn5w",
    },
  ];
}
