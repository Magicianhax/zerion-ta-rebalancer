import { useEffect, useState } from "react";
import { X, Send, Copy, Check, ExternalLink, Lock } from "lucide-react";
import { api } from "../api.ts";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [authorized, setAuthorized] = useState<string[] | null>(null);

  useEffect(() => {
    api.getAuthorizedTelegramUsers().then((r) => setAuthorized(r.userIds)).catch(() => setAuthorized([]));
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20" onClick={onClose}>
      <div className="bg-ink-800 border border-ink-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-ink-700 flex items-center justify-between sticky top-0 bg-ink-800 z-10">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-ink-700 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Authorized Telegram users — env-driven, read-only */}
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
              <Send className="w-4 h-4 text-accent" /> Authorized Telegram users
            </h3>
            <p className="text-xs text-ink-400 mb-3 leading-relaxed flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Configured via <code className="text-ink-200">TELEGRAM_AUTHORIZED_USER_IDS</code> in
                your <code className="text-ink-200">.env</code>. Edit the file and restart the server
                to change. Find your user ID by messaging{" "}
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
              </span>
            </p>

            {authorized === null ? (
              <div className="text-xs text-ink-400">Loading…</div>
            ) : authorized.length === 0 ? (
              <div className="text-xs text-amber-400 bg-amber-900/10 border border-amber-900/30 rounded-lg px-3 py-2">
                Empty whitelist — bot is ignoring everyone. Add IDs to{" "}
                <code className="text-ink-200">TELEGRAM_AUTHORIZED_USER_IDS</code> in <code className="text-ink-200">.env</code>.
              </div>
            ) : (
              <div className="space-y-1.5">
                {authorized.map((id) => (
                  <div key={id} className="text-xs bg-ink-900/40 border border-ink-700 rounded-lg px-3 py-2 font-mono text-ink-200">
                    {id}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-ink-700" />

          {/* Pairing code — runtime ad-hoc tool, kept */}
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
              <Send className="w-4 h-4 text-ink-400" /> One-time pairing code
            </h3>
            <p className="text-xs text-ink-400 mb-3">
              Optional. Generates a short-lived code so a non-whitelisted chat can register
              for notifications without an .env edit. Send <code className="text-ink-200">/start &lt;code&gt;</code> to the bot from that chat.
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
