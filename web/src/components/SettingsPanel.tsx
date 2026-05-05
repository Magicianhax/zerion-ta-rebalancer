import { useState } from "react";
import { X, Send, Copy, Check } from "lucide-react";
import { api } from "../api.ts";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20">
      <div className="bg-ink-800 border border-ink-700 rounded-2xl w-full max-w-md">
        <div className="p-6 border-b border-ink-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-ink-700 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
              <Send className="w-4 h-4 text-accent" /> Telegram pairing
            </h3>
            <p className="text-sm text-ink-400 mb-3">
              Generate a code, send <code className="text-ink-200">/start &lt;code&gt;</code> to your bot to pair this dashboard with that chat.
              Bot will push rebalance notifications there.
            </p>
            {!pairingCode ? (
              <button
                onClick={generate}
                className="w-full bg-accent hover:bg-accent-dim text-white text-sm font-medium rounded-lg py-2 transition"
              >
                Generate pairing code
              </button>
            ) : (
              <div className="bg-ink-700 border border-ink-600 rounded-lg p-3 flex items-center justify-between">
                <code className="text-base font-mono text-accent">/start {pairingCode}</code>
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
