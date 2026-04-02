/**
 * Runs in a separate process so dyld/naudiodon crashes do not kill the HTTP server.
 */
try {
  const mod = await import("naudiodon");
  const portAudio = mod.default || mod;
  const devices = portAudio
    .getDevices()
    .filter((d) => d.maxInputChannels > 0)
    .map((d) => ({ id: d.id, name: d.name }));
  process.stdout.write(JSON.stringify({ ok: true, devices }));
} catch (e) {
  console.error(e?.message || "naudiodon failed");
  process.exit(1);
}
