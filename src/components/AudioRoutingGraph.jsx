export default function AudioRoutingGraph({ routes, mode }) {
  const nodes = [
    { id: "C", label: "C", sub: "Customer", x: 60, y: 166, color: "#4fd1c5" },
    { id: "S", label: "S", sub: "Sales Executive", x: 116, y: 54, color: "#3182ce" },
    {
      id: "U",
      label: "U",
      sub: "Unified Channel",
      x: 234,
      y: 162,
      color: "#a0aec0",
    },
    { id: "SV", label: "SV", sub: "Supervisor", x: 358, y: 166, color: "#805ad5" },
  ];

  const edges = [
    {
      id: "customer-sales",
      d: "M 82 134 Q 96 90 110 72",
      stroke: "#2dd4bf",
      active: Boolean(routes.customerSalesActive),
      flowDur: "1.2s",
      label: "Customer ↔ Sales",
    },
    {
      id: "customer-unified",
      d: "M 98 180 Q 164 188 198 176",
      stroke: "#2dd4bf",
      active: Boolean(routes.customerToSupervisor),
      flowDur: "1.6s",
      label: "Customer → Unified",
    },
    {
      id: "sales-unified",
      d: "M 142 72 Q 188 112 206 142",
      stroke: "#60a5fa",
      active: Boolean(routes.salesToSupervisor),
      flowDur: "1.5s",
      label: "Sales → Unified",
    },
    {
      id: "unified-supervisor",
      d: "M 268 162 Q 320 164 328 166",
      stroke: "#a78bfa",
      active: Boolean(routes.customerToSupervisor || routes.salesToSupervisor),
      flowDur: "1.9s",
      label: "Unified → Supervisor",
    },
    {
      id: "supervisor-customer",
      d: "M 326 178 Q 222 246 94 188",
      stroke: "#c084fc",
      active: Boolean(routes.supervisorToCustomer),
      flowDur: "2s",
      label: "Talk-back to Customer",
    },
    {
      id: "supervisor-sales",
      d: "M 330 148 Q 232 66 138 64",
      stroke: "#c084fc",
      active: Boolean(routes.supervisorToSales),
      flowDur: "2s",
      label: "Talk-back to Sales",
    },
  ];
  return (
    <section className="glass relative flex min-h-[360px] flex-col overflow-hidden rounded-2xl lg:min-h-0 lg:flex-1">
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-base font-semibold text-white">Conversation Flow</h2>
        <p className="text-xs text-zinc-500">
          Solid glow = active audio, dashed = muted/disabled
        </p>
      </div>

      <div className="relative flex min-h-[min(72vh,820px)] flex-1 items-center justify-center p-4 sm:p-6 lg:min-h-[min(68vh,900px)]">
        <svg
          className="h-full w-full min-h-[320px] max-h-[min(78vh,880px)] sm:min-h-[400px]"
          viewBox="0 0 400 280"
          fill="none"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Audio routing diagram"
        >
          <defs>
            <filter id="glow-teal" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-purple" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.8" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {edges
              .filter((e) => e.active)
              .map((e) => (
                <path key={`ref-${e.id}`} id={`path-${e.id}`} d={e.d} />
              ))}
          </defs>

          {edges.map((e) => (
            <g key={e.id}>
              <path
                id={e.active ? undefined : `static-${e.id}`}
                d={e.d}
                stroke={e.stroke}
                strokeWidth={e.active ? 3.2 : 1.6}
                strokeOpacity={e.active ? 0.95 : 0.35}
                strokeLinecap="round"
                strokeDasharray={e.active ? "none" : "5 9"}
                filter={
                  e.active && e.stroke === "#2dd4bf"
                      ? "url(#glow-teal)"
                      : e.active && e.stroke === "#60a5fa"
                        ? "url(#glow-blue)"
                        : e.active
                          ? "url(#glow-purple)"
                        : undefined
                }
              >
                {e.active && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="0"
                    dur={e.flowDur}
                    repeatCount="indefinite"
                  />
                )}
              </path>
              {e.active && (
                <>
                  <circle r="4" fill={e.stroke} opacity={0.95}>
                    <animateMotion
                      dur={e.flowDur}
                      repeatCount="indefinite"
                      rotate="auto"
                    >
                      <mpath href={`#path-${e.id}`} />
                    </animateMotion>
                  </circle>
                  <circle r="2.2" fill="#fff" opacity={0.55}>
                    <animateMotion
                      dur={e.flowDur}
                      repeatCount="indefinite"
                      begin="0.35s"
                      rotate="auto"
                    >
                      <mpath href={`#path-${e.id}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
            </g>
          ))}

          {nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              {n.id === "U" && (
                <circle r="36" fill="none" stroke="#3182ce" strokeWidth="2">
                  <animate
                    attributeName="r"
                    values="34;46;34"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.55;0;0.55"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                r={n.id === "U" ? 34 : 31}
                fill="#16161f"
                stroke={n.color}
                strokeWidth={n.id === "U" ? 2.2 : 2}
                opacity={0.95}
                filter={
                  n.color === "#3182ce"
                    ? "url(#glow-blue)"
                    : n.color === "#4fd1c5"
                      ? "url(#glow-teal)"
                      : n.color === "#805ad5" || n.id === "U"
                        ? "url(#glow-purple)"
                        : undefined
                }
              />
              <text
                x="0"
                y="5"
                textAnchor="middle"
                className="fill-white font-bold"
                style={{ fontFamily: "Inter, sans-serif", fontSize: n.id === "U" ? 15 : 14 }}
              >
                {n.label}
              </text>
              <text
                x="0"
                y={n.id === "U" ? 50 : 47}
                textAnchor="middle"
                className="fill-zinc-500"
                style={{ fontFamily: "Inter, sans-serif", fontSize: n.id === "U" ? 10 : 9.5 }}
              >
                {n.sub}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="border-t border-white/5 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded-full bg-accent-teal shadow-glow-teal" />
            Active audio flow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded-full bg-zinc-600" />
            Muted/disabled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded-full bg-accent-purple shadow-glow-purple" />
            Supervisor talk-back
          </span>
          <span className="ml-auto rounded bg-white/[0.03] px-2 py-0.5 text-zinc-400">
            Mode: {mode}
          </span>
        </div>
      </div>
    </section>
  );
}
