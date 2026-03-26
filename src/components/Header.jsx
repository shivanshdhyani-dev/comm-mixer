import { Radio } from "lucide-react";
import { motion } from "framer-motion";

export default function Header({ connected }) {
  return (
    <header className="glass flex shrink-0 items-center justify-between rounded-2xl px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-teal/30 to-accent-blue/20 ring-1 ring-white/10">
          <Radio className="h-5 w-5 text-accent-teal" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Lenskart CommMixer
          </h1>
          <p className="text-xs text-zinc-500">
            Retail Audio Communication System
          </p>
        </div>
      </div>

      <motion.div
        className={`flex items-center gap-2 rounded-full border px-4 py-1.5 ${
          connected
            ? "border-accent-teal/30 bg-accent-teal/10"
            : "border-zinc-600/50 bg-zinc-800/60"
        }`}
        animate={
          connected
            ? {
                boxShadow: [
                  "0 0 0 0 rgba(79,209,197,0)",
                  "0 0 16px 2px rgba(79,209,197,0.25)",
                  "0 0 0 0 rgba(79,209,197,0)",
                ],
              }
            : { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }
        }
        transition={{ duration: 2.5, repeat: connected ? Infinity : 0, ease: "easeInOut" }}
      >
        <span className="relative flex h-2 w-2">
          {connected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              connected ? "bg-accent-green" : "bg-zinc-500"
            }`}
          />
        </span>
        <span
          className={`text-sm font-medium ${
            connected ? "text-accent-teal" : "text-zinc-400"
          }`}
        >
          {connected ? "Live Session" : "Disconnected"}
        </span>
      </motion.div>
    </header>
  );
}
