import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Bell, SlidersHorizontal, AlertTriangle } from "lucide-react";

function TogglePill({ label, on, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
        on
          ? "border-accent-teal/40 bg-accent-teal/15 text-accent-teal"
          : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-300"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
          on ? "border-accent-teal bg-accent-teal/30" : "border-zinc-600"
        }`}
      >
        {on && <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />}
      </span>
      {label}
    </button>
  );
}

function RecordPill({ on, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
        on
          ? "border-red-400/50 bg-red-500/20 text-red-200 shadow-[0_0_16px_rgba(239,68,68,0.22)]"
          : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-300"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          on ? "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)]" : "bg-zinc-600"
        }`}
      />
      Record
    </button>
  );
}

export default function BottomBar({
  ringing,
  onRingToggle,
  focusOn,
  onFocusToggle,
  recordOn,
  onRecordToggle,
  connected,
  onConnectedToggle,
  canRing,
  canManage,
}) {
  return (
    <footer className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-surface-card/90 px-4 py-3 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          disabled={!canManage}
          onClick={onConnectedToggle}
          className="flex items-center gap-2 rounded-full bg-accent-green/20 px-4 py-2 text-sm font-medium text-accent-green ring-1 ring-accent-green/30 disabled:cursor-not-allowed disabled:opacity-50"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {connected ? <Phone className="h-4 w-4" /> : <PhoneOff className="h-4 w-4" />}
          {connected ? "Connected" : "Disconnected"}
        </motion.button>
        <AnimatePresence>
          {recordOn && (
            <motion.span
              className="flex items-center gap-1.5 rounded-md border border-red-400/50 bg-red-500/20 px-2.5 py-1.5 text-xs font-semibold text-red-200"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              <span className="h-2 w-2 rounded-full bg-red-400" />
              REC
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <motion.button
          type="button"
          disabled={!canRing}
          onClick={onRingToggle}
          className={`relative flex items-center gap-2 overflow-hidden rounded-full px-4 py-2 text-sm font-medium ${
            ringing
              ? "bg-amber-500/20 text-amber-200 ring-2 ring-amber-400/50"
              : "bg-white/[0.06] text-zinc-300 ring-1 ring-white/10"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          animate={
            ringing
              ? {
                  boxShadow: [
                    "0 0 0 0 rgba(251,191,36,0.35)",
                    "0 0 24px 4px rgba(251,191,36,0.25)",
                    "0 0 0 0 rgba(251,191,36,0.35)",
                  ],
                }
              : {}
          }
          transition={{ duration: 1.2, repeat: ringing ? Infinity : 0 }}
        >
          <AnimatePresence>
            {ringing && (
              <>
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-amber-400/40"
                  initial={{ scale: 1, opacity: 0.8 }}
                  animate={{ scale: 1.35, opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                />
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-full border border-amber-300/30"
                  initial={{ scale: 1, opacity: 0.6 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeOut",
                    delay: 0.25,
                  }}
                />
              </>
            )}
          </AnimatePresence>
          <motion.span
            animate={ringing ? { rotate: [0, 18, -18, 12, -12, 0] } : {}}
            transition={{
              duration: 0.6,
              repeat: ringing ? Infinity : 0,
              repeatDelay: 0.35,
            }}
            className="relative z-[1]"
          >
            <Bell className="h-4 w-4" />
          </motion.span>
          <span className="relative z-[1]">
            {ringing ? "Ringing…" : "Ring Bell"}
          </span>
          {ringing && (
            <span className="relative z-[1] ml-1 flex h-5 items-end gap-0.5">
              {[0, 1, 2, 3].map((i) => (
                <motion.span
                  key={i}
                  className="w-0.5 rounded-sm bg-amber-300"
                  animate={{ height: [4, 14, 6, 16, 4] }}
                  transition={{
                    duration: 0.45,
                    repeat: Infinity,
                    delay: i * 0.08,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </span>
          )}
        </motion.button>

        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Auto-Mix
        </button>

        <div className={!canManage ? "pointer-events-none opacity-50" : ""}>
          <TogglePill label="Focus" on={focusOn} onToggle={onFocusToggle} />
        </div>
        <div className={!canManage ? "pointer-events-none opacity-50" : ""}>
          <RecordPill on={recordOn} onToggle={onRecordToggle} />
        </div>
      </div>

      <motion.button
        type="button"
        className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.15)]"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <AlertTriangle className="h-4 w-4" />
        Emergency Override
      </motion.button>
    </footer>
  );
}
