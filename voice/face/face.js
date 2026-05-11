// Bablu's face — state machine + WebSocket client.
// Runs standalone in any browser (debug toolbar) and on the Pi via Chromium kiosk.

const VALID_STATES = new Set([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "happy",
  "confirming-tx",
  "tx-pending",
  "error",
  "sleeping",
]);

const screen = document.querySelector(".screen");
const overlayStatus = document.querySelector('[data-role="status"]');
const overlayAmount = document.querySelector('[data-role="amount"]');
const overlaySig = document.querySelector('[data-role="signature"]');

// Persistent info ticker — survives state transitions and shows live
// portfolio data so the LCD has more to say than just the current emotion.
let tickerEl = document.querySelector(".ticker");
if (!tickerEl) {
  tickerEl = document.createElement("div");
  tickerEl.className = "ticker";
  document.body.appendChild(tickerEl);
}

function setState(state, overlay = {}) {
  if (!VALID_STATES.has(state)) {
    console.warn(`[bablu-face] unknown state: ${state}`);
    return;
  }
  screen.dataset.state = state;
  overlayStatus.textContent = overlay.status ?? "";
  overlayAmount.textContent = overlay.amount ?? "";
  overlaySig.textContent = overlay.signature ?? "";
}

function setTicker(text) {
  tickerEl.textContent = text ?? "";
}

// --- debug toolbar ---
document.querySelectorAll("[data-set-state]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const s = btn.getAttribute("data-set-state");
    const demo = {
      "confirming-tx": { status: "Confirm?", amount: "Swap 0.10 SOL → USDC", signature: "" },
      "tx-pending": { status: "Sending…", amount: "", signature: "5Kx9…demo" },
      "error": { status: "Network error", amount: "", signature: "" },
    }[s] ?? {};
    setState(s, demo);
  });
});

// --- kiosk mode toggle (?kiosk=1 hides debug bar) ---
const params = new URLSearchParams(location.search);
if (params.get("kiosk") === "1") document.body.classList.add("kiosk");

// --- WebSocket client ---
const wsUrl = (() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = params.get("ws") || `${location.hostname || "localhost"}:7780`;
  return `${proto}://${host}`;
})();

let ws;
let backoff = 500;
function connect() {
  ws = new WebSocket(wsUrl);
  ws.addEventListener("open", () => {
    backoff = 500;
    console.info(`[bablu-face] connected to ${wsUrl}`);
  });
  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") setState(msg.state, msg.overlay ?? {});
      else if (msg.type === "ticker") setTicker(msg.text ?? "");
    } catch (err) {
      console.warn("[bablu-face] bad ws message", err);
    }
  });
  ws.addEventListener("close", () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 8000);
  });
  ws.addEventListener("error", () => ws.close());
}

// Skip WS if running purely standalone (e.g., file://) for offline preview.
if (location.protocol !== "file:") connect();

// initial state
setState("idle");
