"""WebSocket bus that pushes face-state updates to the LCD client(s)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection, serve

log = logging.getLogger("bablu.face")


class FaceBus:
    def __init__(self) -> None:
        self._clients: set[ServerConnection] = set()
        self._lock = asyncio.Lock()
        self._last: dict[str, Any] = {"type": "state", "state": "idle", "overlay": {}}

    async def _handler(self, ws: ServerConnection) -> None:
        async with self._lock:
            self._clients.add(ws)
        try:
            await ws.send(json.dumps(self._last))
            async for _ in ws:  # ignore inbound
                pass
        except websockets.ConnectionClosed:
            pass
        finally:
            async with self._lock:
                self._clients.discard(ws)

    async def serve(self, host: str = "0.0.0.0", port: int = 7780) -> None:
        async with serve(self._handler, host, port):
            await asyncio.Future()  # run forever

    async def set_state(self, state: str, overlay: dict[str, Any] | None = None) -> None:
        msg = {"type": "state", "state": state, "overlay": overlay or {}}
        self._last = msg
        await self._broadcast(json.dumps(msg))
        log.info("face -> %s %s", state, overlay or "")

    async def set_ticker(self, text: str) -> None:
        """Persistent info line at the bottom of the LCD — survives state changes."""
        await self._broadcast(json.dumps({"type": "ticker", "text": text}))

    async def _broadcast(self, encoded: str) -> None:
        async with self._lock:
            dead: list[ServerConnection] = []
            for ws in self._clients:
                try:
                    await ws.send(encoded)
                except websockets.ConnectionClosed:
                    dead.append(ws)
            for ws in dead:
                self._clients.discard(ws)
