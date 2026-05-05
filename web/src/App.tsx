import { useEffect, useState } from "react";
import { api, getToken, subscribeEvents, type Basket, type RebalanceResult } from "./api.ts";
import Login from "./components/Login.tsx";
import Dashboard from "./components/Dashboard.tsx";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [baskets, setBaskets] = useState<Basket[] | null>(null);
  const [lastEvent, setLastEvent] = useState<{ type: string; payload: any } | null>(null);

  const refresh = async () => {
    try {
      const res = await api.listBaskets();
      setBaskets(res.baskets);
    } catch (e) {
      // auth handled via location.reload in api.ts
    }
  };

  useEffect(() => {
    if (!authed) return;
    refresh();
    const unsub = subscribeEvents((type, payload) => {
      setLastEvent({ type, payload });
      if (type === "rebalance:done" || type === "rebalance:start") refresh();
    });
    return unsub;
  }, [authed]);

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }

  return (
    <Dashboard
      baskets={baskets}
      onRefresh={refresh}
      lastEvent={lastEvent}
      onLogout={() => {
        sessionStorage.clear();
        setAuthed(false);
      }}
    />
  );
}
