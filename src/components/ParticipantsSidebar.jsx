import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Headphones, Volume2 } from "lucide-react";

function AudioBars({ active, seed }) {
  const [heights, setHeights] = useState(() =>
    Array.from({ length: 12 }, () => 20 + (seed % 7) * 5)
  );

  useEffect(() => {
    if (!active) {
      setHeights(Array.from({ length: 12 }, () => 8));
      return;
    }
    let frame;
    const tick = () => {
      setHeights((prev) =>
        prev.map((_, i) => {
          const base = 15 + Math.sin(Date.now() / 120 + i * 0.7) * 35;
          return Math.max(6, Math.min(100, base + Math.random() * 25));
        })
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className="flex h-10 items-end justify-center gap-0.5">
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className={`w-1 rounded-sm ${
            active
              ? i % 3 === 0
                ? "bg-accent-teal"
                : i % 3 === 1
                  ? "bg-accent-blue"
                  : "bg-accent-purple/80"
              : "bg-zinc-700"
          }`}
          style={{ height: `${h}%` }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        />
      ))}
    </div>
  );
}

function roleTheme(id) {
  if (id === "customer") {
    return {
      hue: "from-accent-teal/40 to-accent-teal/10",
      ring: "ring-accent-teal/50",
      glow: "shadow-glow-teal",
    };
  }
  if (id === "sales") {
    return {
      hue: "from-accent-blue/40 to-accent-blue/10",
      ring: "ring-accent-blue/50",
      glow: "shadow-glow-blue",
    };
  }
  return {
    hue: "from-accent-purple/40 to-accent-purple/10",
    ring: "ring-accent-purple/50",
    glow: "shadow-glow-purple",
  };
}

export default function ParticipantsSidebar({
  participants,
  speaking,
  onToggleMic,
  focusOn,
  currentRole,
  canToggleAll,
}) {
  return (
    <aside className="glass flex flex-col overflow-hidden rounded-2xl">
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Participants</h2>
        <p className="text-xs text-zinc-500">Mic state and speaking indicators</p>
      </div>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {participants.map((p) => (
          <li key={p.id}>
            <motion.div
              layout
              className={`rounded-xl border bg-surface-card/80 p-3 transition-shadow ${
                speaking[p.id]
                  ? `border-white/20 ${roleTheme(p.id).glow} ring-1 ${roleTheme(p.id).ring}`
                  : "border-white/5"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
                    roleTheme(p.id).hue
                  } text-sm font-bold text-white ring-2 ${roleTheme(p.id).ring}`}
                >
                  {speaking[p.id] && (
                    <span className="absolute inset-0 rounded-full border border-white/40 animate-ping" />
                  )}
                  {p.initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="truncate text-sm font-medium text-white">
                        {p.id === "customer" ? "Customer" : p.name}
                      </p>
                      <p className="text-xs text-zinc-500">{p.role}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${p.micOn ? "bg-accent-green" : "bg-zinc-600"}`}
                      />
                      {p.micOn ? (
                        <Mic className="h-3.5 w-3.5 text-zinc-400" />
                      ) : (
                        <MicOff className="h-3.5 w-3.5 text-zinc-600" />
                      )}
                      {p.id === "supervisor" && (
                        <Headphones className="h-3.5 w-3.5 text-accent-purple" />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Volume2 className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    <AudioBars active={p.micOn} seed={p.name.length} />
                    <button
                      type="button"
                      onClick={() => onToggleMic(p.id)}
                      disabled={!canToggleAll && currentRole !== p.id}
                      className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 text-[10px] text-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {p.micOn ? "Mute" : "Unmute"}
                    </button>
                  </div>
                  {focusOn && speaking[p.id] && (
                    <p className="mt-1 text-[10px] text-accent-teal">
                      Focus mode: active speaker
                    </p>
                  )}
                  {p.id === "supervisor" && (
                    <p className="mt-1 text-[10px] text-accent-purple">
                      Unified monitor channel active
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
