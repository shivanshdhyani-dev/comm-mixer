const modes = [
  { id: "listen", label: "Listen Only" },
  { id: "talk-customer", label: "Talk to Customer" },
  { id: "talk-sales", label: "Talk to Sales Executive" },
  { id: "talk-both", label: "Talk to Both" },
];

export default function SupervisorControls({ mode, onModeChange, canManage }) {
  return (
    <div className="flex flex-col gap-2">
      {modes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            disabled={!canManage}
            onClick={() => onModeChange(m.id)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
              active
                ? "border-accent-purple/60 bg-accent-purple/20 text-white"
                : "border-white/5 bg-white/[0.03] text-zinc-400 hover:border-white/10 hover:text-zinc-200"
            } disabled:opacity-50`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
