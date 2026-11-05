import { googleFlightsUrl, localMinutes, type Fare, type LegQuery, type Segment } from "@flightbuzz/core";
import { config } from "../config.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Google Flights through the same internal endpoint the Google Flights page
 * uses (no browser, no key). We build the request ourselves so that each side
 * can list several airports, exactly like typing several airports into Google
 * Flights, and use the open-source `fast-flights-ts` package to read the answer.
 * Unofficial: it can break when Google changes things, and heavy use gets
 * rate-limited. To stay well clear of that:
 *   - one request at a time, with a 45–80 s pause after each (GOOGLE_MIN_DELAY_MS)
 *   - no automatic retries
 *   - on any sign of blocking (429, 403, 503, CAPTCHA) all Google requests stop
 *     for GOOGLE_COOLDOWN_MINUTES (default 3 h); cached prices are still used
 *   - at most GOOGLE_DAILY_LIMIT requests per day (default 300)
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

const RPC_URL =
  "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const SEAT = { economy: 1, premium: 2, business: 3, first: 4 } as const;
/** Google Flights lets you pick up to 7 airports per side. */
export const GOOGLE_MAX_AIRPORTS = 7;

/** Request body for a one-way search; airports are lists, as Google's own page sends them. */
export function googleRpcBody(q: LegQuery): string {
  // Stops filter: 0 any, 1 nonstop, 2 up to one stop, 3 up to two stops.
  const stops = q.maxStops >= 3 ? 0 : q.maxStops + 1;
  const segment = [
    [q.from.map((a) => [a, 0])],
    [q.to.map((a) => [a, 0])],
    null,
    stops,
    null,
    null,
    q.departFrom,
    null, null, null, null, null, null, null,
    3,
  ];
  const pax = [q.passengers.adults, q.passengers.children, 0, q.passengers.infants];
  const settings = [null, null, 2, null, [], SEAT[q.cabin], pax, null, null, null, null, null, null, [segment], null, null, null, 1];
  while (settings.length < 29) settings.push(null);
  const filters = [[], settings, 1, 0, 0, 2];
  return `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify(filters)]))}`;
}

class GoogleHttpError extends Error {
  constructor(public status: number, name = "HttpError") {
    super(`Google answered HTTP ${status}`);
    this.name = name;
  }
}

export const googleProvider: FlightProvider = {
  id: "google",
  name: "Google Flights",
  // Several airports per side, one date per request.
  capabilities: { multiAirport: true, maxAirportsPerSide: GOOGLE_MAX_AIRPORTS, dateRange: false, returnFares: false },
  get concurrency() {
    return config.googleConcurrency;
  },
  get minDelayMs() {
    return config.googleMinDelayMs;
  },
  configured: async () => !!(await load()),
  note: "Free, unofficial. One request per date covering up to 7 airports each side, sent slowly (45–80 s apart) with an automatic pause if Google pushes back.",
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
    let results: ReturnType<FF["parseRpcResponse"]>;
    try {
      const params = new URLSearchParams({ hl: "en-GB", curr: q.currency });
      const res = await fetch(`${RPC_URL}?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": UA,
          Referer: "https://www.google.com/travel/flights/search",
          Origin: "https://www.google.com",
        },
        body: googleRpcBody(q),
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(ctx.signal ? [ctx.signal] : [])]),
      });
      const text = await res.text();
      if (!res.ok) throw new GoogleHttpError(res.status);
      if (text.includes("g-recaptcha") || text.includes('id="captcha"')) throw new GoogleHttpError(res.status, "CaptchaError");
      results = ff.parseRpcResponse(text);
    } catch (e) {
      if (isBlock(e)) {
        blockedUntil = Date.now() + config.googleCooldownMinutes * 60_000;
        blockReason = (e as Error).name === "CaptchaError" ? "a CAPTCHA" : `HTTP ${(e as { status?: number }).status ?? "block"}`;
        console.warn(`[google] ${blockReason} — pausing Google requests for ${config.googleCooldownMinutes} min`);
      }
      // An empty result set is not an error.
      if ((e as Error).name === "ParseError" && /missing flight data/i.test((e as Error).message)) return [];
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
        deepLink: googleFlightsUrl({ from: first.from, to: last.to, date: first.departLocal.slice(0, 10), currency: q.currency }),
        fetchedAt,
      });
    }
    return fares;
  },
};
