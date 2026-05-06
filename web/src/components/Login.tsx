import { useState } from "react";
import { api, setToken } from "../api.ts";
import { Lock } from "lucide-react";

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(password);
      setToken(res.token);
      onAuthed();
    } catch (e: any) {
      setError(e.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle ambient gradient — does the heavy lifting on the page feeling intentional */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-900 to-ink-800" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-accent/10 blur-[100px] pointer-events-none" />

      <form onSubmit={submit} className="w-full max-w-sm space-y-6 relative">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center mb-5 shadow-lg shadow-accent/20">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Zerion TA Rebalancer</h1>
          <p className="text-ink-400 text-sm mt-1">Self-hosted · Policy-bounded · Hourly</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-ink-300 block">Admin password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-ink-700 border border-ink-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition"
            placeholder="Enter the password from .env"
            autoFocus
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-accent hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 transition"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-xs text-center text-ink-400">
          Your password is the <code className="text-ink-200">ADMIN_PASSWORD</code> from your <code className="text-ink-200">.env</code> file.
        </p>
      </form>
    </div>
  );
}
