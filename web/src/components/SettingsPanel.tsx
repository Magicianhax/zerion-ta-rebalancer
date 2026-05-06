import { useEffect, useState } from "react";
import { X, Send, Copy, Check, UserPlus, Trash2, ExternalLink } from "lucide-react";
import { api } from "../api.ts";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Authorized users
  const [authorized, setAuthorized] = useState<string[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [savingAuth, setSavingAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthorizedTelegramUsers().then((r) => setAuthorized(r.userIds)).catch(() => {});
  }, []);

  const generate = async () => {
    const r = await api.pairTelegram();
    setPairingCode(r.pairingCode);
  };

  const copy = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(`/start ${pairingCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const addUser = async () => {
    setAuthError(null);
    const trimmed = newUserId.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      setAuthError("Telegram user IDs are numeric (e.g. 5800688332).");
      return;
    }
    if (authorized.includes(trimmed)) {
      setAuthError("Already authorized.");
      return;
    }
    setSavingAuth(true);
    try {
      const r = await api.setAuthorizedTelegramUsers([...authorized, trimmed]);
      setAuthorized(r.userIds);
      setNewUserId("");
    } catch (e: any) {
      setAuthError(e.message ?? "Failed to save");
    } finally {
      setSavingAuth(false);
    }
  };

  const removeUser = async (id: string) => {
    setSavingAuth(true);
    try {
      const r = await api.setAuthorizedTelegramUsers(authorized.filter((u) => u !== id));
      setAuthorized(r.userIds);
    } finally {
      setSavingAuth(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20" onClick={onClose}>
      <div className="bg-ink-800 border border-ink-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-ink-700 flex items-center justify-between sticky top-0 bg-ink-800 z-10">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-ink-700 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Authorized Telegram users */}
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
              <Send className="w-4 h-4 text-accent" /> Authorized Telegram users
            </h3>
            <p className="text-xs text-ink-400 mb-3 leading-relaxed">
              The bot only responds to whitelisted Telegram user IDs. Find yours by messaging{" "}
              <a
                href="https://t.me/userinfobot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline inline-flex items-center gap-1"
              >
                @userinfobot
                <ExternalLink className="w-3 h-3" />
              </a>
              .
            </p>

            <div className="space-y-2 mb-3">
              {authorized.length === 0 ? (
                <div className="text-xs text-amber-400 bg-amber-900/10 border border-amber-900/30 rounded-lg px-3 py-2">
                  Empty whitelist — bot is ignoring everyone. Add at least one user ID below.
                </div>
              ) : (
                authorized.map((id) => (
                  <div key={id} className="flex items-center justify-between text-sm bg-ink-900/40 border border-ink-700 rounded-lg px-3 py-2">
                    <code className="font-mono text-ink-200">{id}</code>
                    <button
                      onClick={() => removeUser(id)}
                      disabled={savingAuth}
                      className="p-1 hover:bg-red-900/40 hover:text-red-300 rounded disabled:opacity-50"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUser()}
                placeholder="e.g. 5800688332"
                className="flex-1 bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
              />
              <button
                onClick={addUser}
                disabled={savingAuth || !newUserId.trim()}
                className="bg-accent hover:bg-accent-dim disabled:opacity-50 text-white text-sm font-medium rounded-lg px-3 py-2 flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {authError && <div className="text-xs text-red-400 mt-2">{authError}</div>}
          </div>

          <div className="border-t border-ink-700" />

          {/* Pairing code (legacy / fallback) */}
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
              <Send className="w-4 h-4 text-ink-400" /> One-time pairing code
            </h3>
            <p className="text-xs text-ink-400 mb-3">
              Optional. For ad-hoc setup when you can't reach the user-ID whitelist.
              Generate, send <code className="text-ink-200">/start &lt;code&gt;</code> to the bot,
              and that chat is registered without needing a whitelist entry.
            </p>
            {!pairingCode ? (
              <button
                onClick={generate}
                className="w-full bg-ink-700 hover:bg-ink-600 text-sm font-medium rounded-lg py-2 transition"
              >
                Generate pairing code
              </button>
            ) : (
              <div className="bg-ink-700 border border-ink-600 rounded-lg p-3 flex items-center justify-between">
                <code className="text-sm font-mono text-accent">/start {pairingCode}</code>
                <button onClick={copy} className="p-1.5 hover:bg-ink-600 rounded">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
            {pairingCode && (
              <p className="text-xs text-ink-400 mt-2">Code expires in 30 minutes.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
