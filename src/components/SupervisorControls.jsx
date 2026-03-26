import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const modes = [
  { id: "listen", label: "Listen Only" },
  { id: "talk-customer", label: "Talk to Customer" },
  { id: "talk-sales", label: "Talk to Sales Executive" },
  { id: "talk-both", label: "Talk to Both" },
];

function ChannelMeter({ label, value, onChange, gradient }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-zinc-500">
        <span>{label}</span>
        <span className="text-zinc-400">{Math.round(value)}%</span>
      </div>
      <div
        className="relative h-2 cursor-pointer rounded-full bg-zinc-800/80 ring-1 ring-white/5"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          onChange(x * 100);
        }}
        role="slider"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft")
            onChange(Math.max(0, value - 5));
          if (e.key === "ArrowRight")
            onChange(Math.min(100, value + 5));
        }}
      >
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${gradient}`}
          style={{ width: `${value}%` }}
          layout
          transition={{ type: "spring", stiffness: 380, damping: 35 }}
        />
        <motion.div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white/20 bg-surface-elevated shadow-md ring-2 ring-accent-teal/40"
          style={{ left: `calc(${value}% - 8px)` }}
          layout
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      </div>
    </div>
  );
}

export default function SupervisorControls({
  mode,
  onModeChange,
  volume,
  onVolumeChange,
  channelL,
  channelR,
  onChannelLChange,
  onChannelRChange,
  liveLevels,
  connected,
  canManage,
}) {
  const [displayL, setDisplayL] = useState(channelL);
  const [displayR, setDisplayR] = useState(channelR);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    let frame;
    const tick = () => {
      if (typeof liveLevels === "function") {
        const { l, r } = liveLevels();
        setDisplayL(l);
        setDisplayR(r);
      }
      setClock(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [liveLevels]);

  return (
    <aside className="glass flex flex-col overflow-hidden rounded-2xl">
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Supervisor Controls</h2>
        <p className="text-xs text-zinc-500">Unified monitoring and talk-back</p>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {!canManage && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Read-only: supervisor permissions required.
          </div>
        )}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Combined audio channel
          </p>
          <div className="rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="mb-3 flex gap-4">
              <div className="flex-1 space-y-1">
                <ChannelMeter
                  label="Left"
                  value={channelL}
                  onChange={(v) => canManage && onChannelLChange(v)}
                  gradient="bg-gradient-to-r from-accent-teal/20 to-accent-teal"
                />
              </div>
              <div className="flex-1 space-y-1">
                <ChannelMeter
                  label="Right"
                  value={channelR}
                  onChange={(v) => canManage && onChannelRChange(v)}
                  gradient="bg-gradient-to-r from-accent-blue/20 to-accent-blue"
                />
              </div>
            </div>
            <div className="flex h-7 items-end gap-0.5">
              {Array.from({ length: 28 }).map((_, i) => {
                const wave =
                  0.35 +
                  0.65 *
                    Math.abs(
                      Math.sin(clock / 140 + i * 0.45 + (displayL / 100) * 2)
                    );
                const h = Math.max(12, (displayL / 100) * 100 * wave);
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-gradient-to-t from-accent-teal/35 to-accent-teal"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
              {Array.from({ length: 28 }).map((_, i) => {
                const wave =
                  0.35 +
                  0.65 *
                    Math.abs(
                      Math.sin(clock / 130 + i * 0.42 + (displayR / 100) * 2)
                    );
                const h = Math.max(12, (displayR / 100) * 100 * wave);
                return (
                  <div
                    key={`r-${i}`}
                    className="flex-1 rounded-sm bg-gradient-to-t from-accent-blue/35 to-accent-blue"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-400">Master volume</p>
            <span className="text-sm font-semibold text-accent-purple">
              {volume}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            disabled={!canManage}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-accent-purple disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: `linear-gradient(to right, rgba(128,90,213,0.8) 0%, rgba(128,90,213,0.8) ${volume}%, rgb(39 39 42) ${volume}%, rgb(39 39 42) 100%)`,
            }}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">Supervisor mode</p>
          <div className="flex flex-col gap-2">
            {modes.map((m) => {
              const active = mode === m.id;
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => onModeChange(m.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    active
                      ? "border-accent-purple/60 bg-accent-purple/20 text-white shadow-glow-purple"
                      : "border-white/5 bg-white/[0.03] text-zinc-400 hover:border-white/10 hover:text-zinc-200"
                  }`}
                  whileTap={{ scale: 0.98 }}
                >
                  {m.label}
                </motion.button>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-500">
          {connected ? "Connected: monitoring live conversation" : "Disconnected"}
        </div>
      </div>
    </aside>
  );
}
