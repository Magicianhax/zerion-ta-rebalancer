"""Thin HTTP + SSE client for the Zerion TA Rebalancer.

The voice layer (on the Pi) is a frontend; this module is the only place
that knows how to talk to the rebalancer backend. Tools call into here,
the SSE listener pushes live face updates as cron ticks fire.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, AsyncIterator, Awaitable, Callable

import httpx

log = logging.getLogger("voice.rebalancer")


def _base_url() -> str:
    url = os.environ.get("REBALANCER_URL", "").rstrip("/")
    if not url:
        raise SystemExit("REBALANCER_URL not set. Example: http://192.168.100.71:8080")
    return url


def _token() -> str:
    tok = os.environ.get("REBALANCER_TOKEN", "")
    if not tok:
        raise SystemExit("REBALANCER_TOKEN not set (same value as ADMIN_PASSWORD on the rebalancer)")
    return tok


# Default per-request timeout. Manual rebalance can take ~30-60s if the
# planner fires real swaps; reads should be quick.
DEFAULT_TIMEOUT = httpx.Timeout(10.0, read=120.0)


class RebalancerClient:
    """Async HTTP client. Reuses a single connection pool."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "RebalancerClient":
        self._client = httpx.AsyncClient(
            base_url=_base_url(),
            headers={"Authorization": f"Bearer {_token()}"},
            timeout=DEFAULT_TIMEOUT,
        )
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._client:
            await self._client.aclose()

    @property
    def http(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("RebalancerClient used outside async-with")
        return self._client

    # ── reads ──────────────────────────────────────────────────────

    async def list_baskets(self) -> list[dict[str, Any]]:
        r = await self.http.get("/api/baskets")
        r.raise_for_status()
        return r.json().get("baskets", [])

    async def get_portfolio(self, basket_id: str) -> dict[str, Any]:
        r = await self.http.get(f"/api/baskets/{basket_id}/portfolio")
        r.raise_for_status()
        return r.json().get("portfolio", {})

    async def list_rebalances(self, basket_id: str, limit: int = 5) -> list[dict[str, Any]]:
        r = await self.http.get(f"/api/baskets/{basket_id}/rebalances", params={"limit": limit})
        r.raise_for_status()
        return r.json().get("rebalances", [])

    async def list_tokens(self, chain: str) -> list[dict[str, Any]]:
        r = await self.http.get("/api/tokens", params={"chain": chain})
        r.raise_for_status()
        return r.json().get("tokens", [])

    async def list_wallets(self) -> list[dict[str, Any]]:
        r = await self.http.get("/api/wallets")
        r.raise_for_status()
        return r.json().get("wallets", [])

    async def list_policies(self) -> list[dict[str, Any]]:
        r = await self.http.get("/api/agent/policies")
        r.raise_for_status()
        return r.json().get("policies", [])

    async def list_agent_tokens(self) -> list[dict[str, Any]]:
        r = await self.http.get("/api/agent/tokens")
        r.raise_for_status()
        return r.json().get("tokens", [])

    # ── writes ─────────────────────────────────────────────────────

    async def rebalance(self, basket_id: str) -> dict[str, Any]:
        r = await self.http.post(f"/api/baskets/{basket_id}/rebalance")
        r.raise_for_status()
        return r.json().get("result", {})

    async def pause_basket(self, basket_id: str) -> None:
        r = await self.http.post(f"/api/baskets/{basket_id}/pause")
        r.raise_for_status()

    async def resume_basket(self, basket_id: str) -> None:
        r = await self.http.post(f"/api/baskets/{basket_id}/resume")
        r.raise_for_status()

    async def create_basket(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self.http.post("/api/baskets", json=payload)
        r.raise_for_status()
        return r.json().get("basket", {})


# ── SSE stream ─────────────────────────────────────────────────────

EventHandler = Callable[[str, dict[str, Any]], Awaitable[None]]


async def stream_events(handler: EventHandler) -> None:
    """Connect to /api/events/stream and call handler(event_name, payload).

    Auto-reconnects with backoff if the connection drops — Pi networking is
    flaky enough that we always want to come back online.
    """
    backoff = 1.0
    url = f"{_base_url()}/api/events/stream"
    params = {"token": _token()}
    while True:
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", url, params=params) as resp:
                    resp.raise_for_status()
                    backoff = 1.0
                    log.info("SSE connected")
                    async for event in _iter_events(resp):
                        try:
                            await handler(event["event"], event["data"])
                        except Exception:
                            log.exception("event handler errored on %s", event["event"])
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            log.warning("SSE disconnected (%s) — reconnecting in %.1fs", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def _iter_events(resp: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """Parse the text/event-stream framing."""
    event_name = "message"
    data_lines: list[str] = []
    async for line in resp.aiter_lines():
        if line == "":
            if data_lines:
                raw = "\n".join(data_lines)
                try:
                    yield {"event": event_name, "data": json.loads(raw)}
                except json.JSONDecodeError:
                    yield {"event": event_name, "data": {"raw": raw}}
            event_name = "message"
            data_lines = []
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
        # ignore id:, retry:, comments
