import { localMinutes, type Fare, type LegQuery, type Segment } from "@flightbuzz/core";
import { config } from "../config.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Google Flights via the open-source `fast-flights-ts` package, which calls the
 * same internal endpoint the Google Flights page uses (no browser, no key).
 * Unofficial: it can break when Google changes things, and heavy use gets
 * rate-limited. To stay well clear of that:
 *   - one request at a time, with an 8–14 s pause after each (GOOGLE_MIN_DELAY_MS)
 *   - no automatic retries
 *   - on any sign of blocking (429, 403, 503, CAPTCHA) all Google requests stop
 *     for GOOGLE_COOLDOWN_MINUTES (default 3 h); cached prices are still used
 *   - at most GOOGLE_DAILY_LIMIT requests per day (default 1500)
 */

let blockedUntil = 0;
let blockReason = "";
let day = "";
let usedToday = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBlock(e: unknown): boolean {
  const err = e as { name?: string; status?: number; message?: string };
  if (err?.name === "CaptchaError") return true;
  if (err?.status && [403, 429, 503].includes(err.status)) return true;
  return /captcha|unusual traffic|429|too many/i.test(err?.message ?? "");
}

export function googleStatus() {
  return { blockedUntil: blockedUntil > Date.now() ? new Date(blockedUntil).toISOString() : null, blockReason, usedToday: day === today() ? usedToday : 0 };
}

type FF = typeof import("fast-flights-ts");
let mod: FF | null | undefined;

async function load(): Promise<FF | null> {
  if (mod !== undefined) return mod;
  try {
    mod = await import("fast-flights-ts");
  } catch {
    mod = null;
  }
  return mod;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dt = (d: { date: readonly number[]; time: readonly number[] }) =>
  `${d.date[0]}-${pad(d.date[1])}-${pad(d.date[2])}T${pad(d.time[0] ?? 0)}:${pad(d.time[1] ?? 0)}`;

const SEAT = { economy: "economy", premium: "premium-economy", business: "business", first: "first" } as const;

export const googleProvider: FlightProvider = {
  id: "google",
  name: "Google Flights",
  // fast-flights-ts takes one airport per side and one date per request.
  capabilities: { multiAirport: false, dateRange: false, returnFares: false },
  get concurrency() {
    return config.googleConcurrency;
  },
  get minDelayMs() {
    return config.googleMinDelayMs;
  },
  configured: async () => !!(await load()),
  note: "Free, unofficial (fast-flights-ts). One request per airport pair per day, sent slowly (~8–14 s apart) with an automatic pause if Google pushes back.",
  unavailable() {
    if (Date.now() < blockedUntil) {
      return `paused until ${new Date(blockedUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} after ${blockReason}; using cached prices`;
    }
    if (day === today() && usedToday >= config.googleDailyLimit) return `daily limit of ${config.googleDailyLimit} requests reached`;
    return undefined;
  },
  onRequest() {
    if (day !== today()) {
      day = today();
      usedToday = 0;
    }
    usedToday++;
  },
  async search(q: LegQuery, ctx): Promise<Fare[]> {
    const ff = await load();
    if (!ff) throw new Error("fast-flights-ts is not installed");
    const query = ff.createQuery({
      flights: [{ date: q.departFrom, from_airport: q.from[0], to_airport: q.to[0] }],
      trip: "one-way",
      seat: SEAT[q.cabin],
      passengers: new ff.Passengers({ adults: q.passengers.adults, children: q.passengers.children, infants_on_lap: q.passengers.infants }),
      currency: q.currency,
      language: "en-GB",
      max_stops: q.maxStops,
    });
    let results: Awaited<ReturnType<FF["getFlights"]>>;
    try {
      results = await ff.getFlights(query, { timeout: 30_000, maxRetries: 0, signal: ctx.signal });
    } catch (e) {
      if (isBlock(e)) {
        blockedUntil = Date.now() + config.googleCooldownMinutes * 60_000;
        blockReason = (e as Error).name === "CaptchaError" ? "a CAPTCHA" : `HTTP ${(e as { status?: number }).status ?? "block"}`;
        console.warn(`[google] ${blockReason} — pausing Google requests for ${config.googleCooldownMinutes} min`);
      }
      throw e;
    }
    const fetchedAt = new Date().toISOString();
    const fares: Fare[] = [];
    for (const r of results) {
      if (!r.price || !r.flights.length) continue;
      const segments: Segment[] = r.flights.map((f, i) => ({
        from: f.from_airport.code,
        to: f.to_airport.code,
        departLocal: dt(f.departure),
        arriveLocal: dt(f.arrival),
        durationMin: f.duration,
        carrier: r.airlines[i] ?? r.airlines[0] ?? "",
        carrierName: r.airlines[i] ?? r.airlines[0],
      }));
      const first = segments[0];
      const last = segments[segments.length - 1];
      fares.push({
        id: `google:${segments.map((s) => `${s.from}${s.to}${s.departLocal}${s.carrier}`).join("|")}`,
        provider: "google",
        price: r.price,
        currency: q.currency,
        slices: [{ from: first.from, to: last.to, departLocal: first.departLocal, arriveLocal: last.arriveLocal, durationMin: sliceDuration(segments, localMinutes), segments }],
        deepLink: query.url(),
        fetchedAt,
      });
    }
    return fares;
  },
};
