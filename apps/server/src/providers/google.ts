import { localMinutes, type Fare, type LegQuery, type Segment } from "@flightbuzz/core";
import { config } from "../config.ts";
import { browserAvailable, clickIfPresent, settle, waitForHuman, withTab } from "../browser/session.ts";
import { HttpStatusError, PoliteGate } from "./polite.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Google Flights. Two ways in, both free and with several airports per side:
 *   - browser (default): opens the Google Flights results page in the FlightBuzz
 *     browser window (a real, kept-open window with a saved profile), clicks the
 *     "Cheapest" tab and "View more flights", and reads the results, like a
 *     person browsing
 *   - direct (BROWSER=off): calls the endpoint the Google Flights page uses
 * The open-source `fast-flights-ts` package reads Google's answer.
 * Unofficial: it can break when Google changes things, and heavy use gets
 * rate-limited. To stay well clear of that:
 *   - one request at a time, with a 29–50 s pause after each (GOOGLE_MIN_DELAY_MS)
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

// ---- Google Flights page URL (the "tfs" parameter is a small protobuf) ----

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
const field = (num: number, wire: number) => varint((num << 3) | wire);
const bytesField = (num: number, data: number[]) => [...field(num, 2), ...varint(data.length), ...data];
const stringField = (num: number, str: string) => bytesField(num, [...new TextEncoder().encode(str)]);
const varintField = (num: number, n: number) => [...field(num, 0), ...varint(n)];

/** The `tfs` value of a Google Flights results URL, with every airport listed on each side. */
export function googleTfs(q: LegQuery): string {
  const flight = (from: string[], to: string[], date: string) => [
    ...stringField(2, date),
    ...(q.maxStops <= 2 ? varintField(5, q.maxStops) : []),
    ...from.flatMap((a) => bytesField(13, stringField(2, a))),
    ...to.flatMap((a) => bytesField(14, stringField(2, a))),
  ];
  const legs = [flight(q.from, q.to, q.departFrom)];
  if (q.returnFrom) legs.push(flight(q.to, q.from, q.returnFrom));
  const pax = [
    ...Array(q.passengers.adults).fill(1),
    ...Array(q.passengers.children).fill(2),
    ...Array(q.passengers.infants).fill(4),
  ];
  const info = [
    ...legs.flatMap((l) => bytesField(3, l)),
    ...bytesField(8, pax.flatMap(varint)),
    ...varintField(9, SEAT[q.cabin]),
    ...varintField(19, q.returnFrom ? 1 : 2),
  ];
  return Buffer.from(info).toString("base64");
}

export function googlePageUrl(q: LegQuery): string {
  const p = new URLSearchParams({ tfs: googleTfs(q), hl: "en-GB", curr: q.currency, gl: "uk" });
  return `https://www.google.com/travel/flights/search?${p}`;
}

type GoogleResults = ReturnType<FF["parseRpcResponse"]>;

async function searchByRequest(q: LegQuery, ff: FF, signal?: AbortSignal): Promise<GoogleResults> {
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
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpStatusError(res.status, "Google");
  if (text.includes("g-recaptcha") || text.includes('id="captcha"')) throw new HttpStatusError(res.status, "Google", "CaptchaError");
  try {
    return ff.parseRpcResponse(text);
  } catch (e) {
    if ((e as Error).name === "ParseError" && /missing flight data/i.test((e as Error).message)) return Object.assign([], { metadata: { airlines: [], alliances: [] } });
    throw e;
  }
}

const isGoogleCheck = async (page: import("playwright").Page) =>
  /\/sorry\//.test(page.url()) || (await page.locator("#captcha-form, iframe[src*='recaptcha']").count()) > 0;

/** Open the results page in the FlightBuzz browser window and read the flights from it. */
async function searchInBrowser(q: LegQuery, ff: FF): Promise<GoogleResults> {
  const url = googlePageUrl(q);
  return withTab("google", async (page) => {
    // The page may fetch more results after loading; collect those too.
    const rpc: Promise<string>[] = [];
    const onResponse = (r: import("playwright").Response) => {
      if (r.url().includes("GetShoppingResults")) rpc.push(r.text().catch(() => ""));
    };
    page.on("response", onResponse);
    try {
      let resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (/consent\.google\./.test(page.url())) {
        // Cookie screen: accept once; the saved profile remembers it.
        await clickIfPresent(page, [/accept all/i, /i agree/i, /agree/i], 5000);
        await page.waitForURL(/travel\/flights/, { timeout: 20_000 }).catch(() => undefined);
        resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      if (await isGoogleCheck(page)) {
        await waitForHuman(page, "Google Flights", isGoogleCheck);
        resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      if (resp && resp.status() >= 400) throw new HttpStatusError(resp.status(), "Google");
      await settle(page);
      // Switch to the "Cheapest" tab: Google then loads the price-sorted results.
      const cheapest = page.getByRole("tab", { name: /cheapest/i }).first();
      if ((await cheapest.isVisible({ timeout: 3000 }).catch(() => false)) && (await cheapest.getAttribute("aria-selected")) !== "true") {
        const before = rpc.length;
        await cheapest.click();
        for (let waited = 0; rpc.length === before && waited < 8000; waited += 250) await page.waitForTimeout(250);
        await page.waitForTimeout(1500 + Math.random() * 1500);
      }
      // Expand the list like a person would; Google may fetch more results.
      if (await clickIfPresent(page, [/view more flights/i, /more flights/i], 1500)) await page.waitForTimeout(2500 + Math.random() * 1500);
      const results: GoogleResults = Object.assign([], { metadata: { airlines: [], alliances: [] } });
      const html = resp ? await resp.text().catch(() => "") : "";
      try {
        if (html) results.push(...ff.parse(html));
      } catch {
        /* no embedded results */
      }
      for (const t of await Promise.all(rpc)) {
        try {
          if (t) results.push(...ff.parseRpcResponse(t));
        } catch {
          /* not a results payload */
        }
      }
      return results;
    } finally {
      page.off("response", onResponse);
    }
  });
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
  note: "Free, unofficial. Prices are Google's base fares (full-service airlines usually include a bag; budget ones don't). One request per date covering up to 7 airports each side, sent slowly (29–50 s apart) with an automatic pause if Google pushes back.",
  unavailable: () => googleGate.unavailable(),
  onRequest: () => googleGate.onRequest(),
  async search(q: LegQuery, ctx): Promise<Fare[]> {
    const ff = await load();
    if (!ff) throw new Error("fast-flights-ts is not installed");
    let results: GoogleResults;
    try {
      results = (await browserAvailable()) ? await searchInBrowser(q, ff) : await searchByRequest(q, ff, ctx.signal);
    } catch (e) {
      googleGate.onError(e);
      throw e;
    }
    const fetchedAt = new Date().toISOString();
    const fares = new Map<string, Fare>();
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
      const id = `google:${isReturn ? `rt${q.returnFrom}:` : ""}${segments.map((s) => `${s.from}${s.to}${s.departLocal}`).join("|")}`;
      if (fares.has(id) && fares.get(id)!.price <= r.price) continue;
      fares.set(id, {
        id,
        provider: "google",
        price: r.price,
        currency: q.currency,
        slices,
        ...(isReturn && slices.length === 1 ? { openReturn: { date: q.returnFrom!, from: q.to, to: q.from } } : {}),
        deepLink: googlePageUrl(q),
        fetchedAt,
      });
    }
    return [...fares.values()];
  },
};
