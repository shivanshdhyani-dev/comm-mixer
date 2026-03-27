import { useState } from "react";

const roles = [
  { id: "floor", label: "Store desk (Meet laptop — 2 headsets)" },
  { id: "supervisor", label: "Supervisor (separate laptop)" },
];

export default function AuthPanel({ onLogin, error, loading, backendConnected }) {
  const [role, setRole] = useState("floor");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="glass w-full max-w-md rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-white">Join CommMixer</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sign in with your role to access controls and audio.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-zinc-400">PIN</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Role PIN"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
          </div>
        </div>

        {!backendConnected && (
          <p className="mt-3 text-sm text-amber-300">
            Waiting for backend connection on `localhost:4000`...
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          type="button"
          disabled={loading}
          onClick={() => onLogin({ role, name, pin })}
          className="mt-5 w-full rounded-xl bg-accent-teal/25 px-4 py-2.5 text-sm font-semibold text-accent-teal disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="mt-3 text-xs text-zinc-500">
          Demo PINs: store desk `3333`, supervisor `1234`
        </p>
      </div>
    </div>
  );
}
