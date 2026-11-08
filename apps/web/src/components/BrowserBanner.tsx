import { useEffect, useState } from "react";
import { api } from "../api.ts";

/** Shows when a site's robot check is waiting for you in the FlightBuzz browser window. */
export function BrowserBanner() {
  const [waiting, setWaiting] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const m = await api.meta();
        if (!stop) setWaiting(m.browser?.waitingForHuman ?? null);
      } catch {
        /* server banner covers this */
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  if (!waiting) return null;
  return (
    <div className="banner warn" role="status">
      <strong>Your turn in the browser window:</strong> {waiting}. The search carries on as soon as it's done.
    </div>
  );
}
