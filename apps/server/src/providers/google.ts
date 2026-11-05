import { googleFlightsUrl, localMinutes, type Fare, type LegQuery, type Segment } from "@flightbuzz/core";
import { config } from "../config.ts";
import { HttpStatusError, PoliteGate } from "./polite.ts";
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

export const googleGate = new PoliteGate("google", () => ({
  cooldownMinutes: config.googleCooldownMinutes,
  dailyLimit: config.googleDailyLimit,
}));

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

/**
 * Request body; airports are lists, as Google's own page sends them. With
 * `returnFrom` it is a round trip: Google answers with outbound flights, each
 * priced as the cheapest return ticket for that return date.
 */
export function googleRpcBody(q: LegQuery): string {
  // Stops filter: 0 any, 1 nonstop, 2 up to one stop, 3 up to two stops.
  const stops = q.maxStops >= 3 ? 0 : q.maxStops + 1;
  const segment = (from: string[], to: string[], date: string) => [
    [from.map((a) => [a, 0])],
    [to.map((a) => [a, 0])],
    null,
    stops,
    null,
    null,
    date,
    null, null, null, null, null, null, null,
    3,
  ];
  const segments = [segment(q.from, q.to, q.departFrom)];
  if (q.returnFrom) segments.push(segment(q.to, q.from, q.returnFrom));
  const trip = q.returnFrom ? 1 : 2;
  const pax = [q.passengers.adults, q.passengers.children, 0, q.passengers.infants];
  const settings = [null, null, trip, null, [], SEAT[q.cabin], pax, null, null, null, null, null, null, segments, null, null, null, 1];
  while (settings.length < 29) settings.push(null);
  const filters = [[], settings, 1, 0, 0, 2];
  return `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify(filters)]))}`;
}

export const googleProvider: FlightProvider = {
  id: "google",
  name: "Google Flights",
  // Several airports per side, one date per request.
  capabilities: { multiAirport: true, maxAirportsPerSide: GOOGLE_MAX_AIRPORTS, dateRange: false, returnFares: true },
  get concurrency() {
    return config.googleConcurrency;
  },
  get minDelayMs() {
    return config.googleMinDelayMs;
  },
  configured: async () => !!(await load()),
  note: "Free, unofficial. Prices are Google's base fares (full-service airlines usually include a bag; budget ones don't). One request per date covering up to 7 airports each side, sent slowly (45–80 s apart) with an automatic pause if Google pushes back.",
  unavailable: () => googleGate.unavailable(),
  onRequest: () => googleGate.onRequest(),
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
      if (!res.ok) throw new HttpStatusError(res.status, "Google");
      if (text.includes("g-recaptcha") || text.includes('id="captcha"')) throw new HttpStatusError(res.status, "Google", "CaptchaError");
      results = ff.parseRpcResponse(text);
    } catch (e) {
      googleGate.onError(e);
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
      // If Google included the way back, split where the trip reaches the destination.
      const turn = segments.findIndex((sg) => q.to.includes(sg.to));
      const outSegs = turn >= 0 ? segments.slice(0, turn + 1) : segments;
      const backSegs = turn >= 0 ? segments.slice(turn + 1) : [];
      const slice = (segs: Segment[]) => ({
        from: segs[0].from,
        to: segs[segs.length - 1].to,
        departLocal: segs[0].departLocal,
        arriveLocal: segs[segs.length - 1].arriveLocal,
        durationMin: sliceDuration(segs, localMinutes),
        segments: segs,
      });
      const out = slice(outSegs);
      const isReturn = !!q.returnFrom;
      const slices = isReturn && backSegs.length ? [out, slice(backSegs)] : [out];
      fares.push({
        id: `google:${isReturn ? `rt${q.returnFrom}:` : ""}${segments.map((s) => `${s.from}${s.to}${s.departLocal}${s.carrier}`).join("|")}`,
        provider: "google",
        price: r.price,
        currency: q.currency,
        slices,
        ...(isReturn && slices.length === 1 ? { openReturn: { date: q.returnFrom!, from: q.to, to: q.from } } : {}),
        deepLink: googleFlightsUrl({ from: out.from, to: out.to, date: out.departLocal.slice(0, 10), returnDate: q.returnFrom, currency: q.currency }),
        fetchedAt,
      });
    }
    return fares;
  },
};
