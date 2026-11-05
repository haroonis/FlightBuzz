import { config } from "./config.ts";
import { cachePrune, listSaved } from "./db.ts";
import { runSavedNow } from "./jobs.ts";

/** Current local date and HH:MM in the configured timezone. */
function nowLocal(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

let running = false;

/** Refresh every active saved search, one after another. */
export async function refreshAll(reason: string, onlyStale = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    const staleBefore = Date.now() - 11 * 3600_000;
    const due = listSaved().filter((s) => s.active && (!onlyStale || !s.lastRunAt || Date.parse(s.lastRunAt) < staleBefore));
    if (due.length) console.log(`[scheduler] ${reason}: refreshing ${due.length} saved search(es)`);
    for (const s of due) {
      const job = await runSavedNow(s.id);
      const r = job.result;
      console.log(
        `[scheduler]   ${s.name}: ${job.status}` +
          (r ? ` · ${r.trips.length} trips · cheapest ${r.summary.cheapest ?? "—"} ${r.summary.currency} · ${r.stats.requests} live / ${r.stats.cachedRequests} cached` : ` · ${job.error}`),
      );
    }
    cachePrune(48 * 60);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  const done = new Set<string>();
  const check = () => {
    const { date, time } = nowLocal();
    if (config.schedule.includes(time) && !done.has(`${date} ${time}`)) {
      done.add(`${date} ${time}`);
      void refreshAll(`scheduled ${time}`);
    }
  };
  setInterval(check, 20_000);
  // Catch up if the server was off at a scheduled time.
  setTimeout(() => void refreshAll("startup catch-up", true), 5_000);
  console.log(`[scheduler] refreshing saved searches at ${config.schedule.join(", ")} (${config.timezone})`);
}
