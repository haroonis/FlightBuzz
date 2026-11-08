import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { localMinutes, skyscannerUrl, type Fare, type LegQuery, type Segment, type Slice } from "@flightbuzz/core";
import { browserAvailable, clickIfPresent, settle, waitForHuman, withTab } from "../browser/session.ts";
import { config } from "../config.ts";
import { HttpStatusError, PoliteGate } from "./polite.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Skyscanner through its own results page in the FlightBuzz browser window.
 * Skyscanner shows a "Press & Hold" robot check; FlightBuzz never tries to pass
 * it. It brings the window to the front and waits for you to do it once; the
 * saved browser profile then keeps that pass for later searches.
 *
 * The page loads its results from Skyscanner's search API as JSON; FlightBuzz
 * reads those responses. One airport pair and date (or date pair) per page, so
 * this source is opt-in: add "skyscanner" to PROVIDERS or tick it for a search.
 * Set SKYSCANNER_DEBUG=1 to save the raw responses next to the browser profile.
 */

export const skyscannerGate = new PoliteGate("skyscanner", () => ({
  cooldownMinutes: config.skyscannerCooldownMinutes,
  dailyLimit: config.skyscannerDailyLimit,
}));

// ---- reading Skyscanner's search JSON ----

interface SkyPlace {
  displayCode?: string;
  id?: string;
}
interface SkyCarrier {
  name?: string;
  alternateId?: string;
  displayCode?: string;
}
interface SkySegment {
  origin?: SkyPlace;
  destination?: SkyPlace;
  departure?: string;
  arrival?: string;
  durationInMinutes?: number;
  flightNumber?: string;
  marketingCarrier?: SkyCarrier;
  operatingCarrier?: SkyCarrier;
}
interface SkyLeg {
  origin?: SkyPlace;
  destination?: SkyPlace;
  departure?: string;
  arrival?: string;
  durationInMinutes?: number;
  segments?: SkySegment[];
  carriers?: { marketing?: SkyCarrier[] };
}
interface SkyItinerary {
  id?: string;
  price?: { raw?: number; amount?: number; formatted?: string };
  legs?: SkyLeg[];
}

const code = (p?: SkyPlace) => (p?.displayCode ?? p?.id ?? "").toUpperCase();
const local = (t?: string) => (t ?? "").slice(0, 16);

/** Find the itinerary list in a search response, whichever wrapper it comes in. */
export function skyscannerItineraries(body: unknown): SkyItinerary[] {
  const b = body as Record<string, any>;
  const candidates = [b?.itineraries?.results, b?.itineraries, b?.data?.itineraries?.results, b?.data?.itineraries, b?.results];
  for (const c of candidates) if (Array.isArray(c) && c.length && typeof c[0] === "object") return c as SkyItinerary[];
  return [];
}

export function skyscannerFares(items: SkyItinerary[], q: LegQuery, link: string): Fare[] {
  const fetchedAt = new Date().toISOString();
  const fares: Fare[] = [];
  for (const it of items) {
    const price = it.price?.raw ?? it.price?.amount;
    if (!price || !it.legs?.length) continue;
    const slices: Slice[] = [];
    for (const leg of it.legs) {
      const segs = leg.segments?.length ? leg.segments : [leg as SkySegment];
      const segments: Segment[] = segs.map((s) => {
        const carrier = s.marketingCarrier ?? leg.carriers?.marketing?.[0];
        const cc = carrier?.alternateId ?? carrier?.displayCode ?? carrier?.name ?? "";
        return {
          from: code(s.origin),
          to: code(s.destination),
          departLocal: local(s.departure),
          arriveLocal: local(s.arrival),
          durationMin: s.durationInMinutes ?? 0,
          carrier: cc,
          carrierName: carrier?.name,
          ...(s.flightNumber ? { flightNo: `${cc}${s.flightNumber}` } : {}),
        };
      });
      if (segments.some((s) => !s.from || !s.to || s.departLocal.length < 16)) break;
      slices.push({
        from: segments[0].from,
        to: segments[segments.length - 1].to,
        departLocal: segments[0].departLocal,
        arriveLocal: segments[segments.length - 1].arriveLocal,
        durationMin: leg.durationInMinutes ?? sliceDuration(segments, localMinutes),
        segments,
      });
    }
    if (slices.length !== it.legs.length) continue;
    fares.push({
      id: `skyscanner:${slices.map((s) => s.segments.map((g) => `${g.from}${g.to}${g.departLocal}`).join("|")).join("||")}`,
      provider: "skyscanner",
      price: Math.round(price * 100) / 100,
      currency: q.currency,
      slices,
      deepLink: link,
      fetchedAt,
    });
  }
  return fares;
}

// ---- driving the page ----

const isSkyCheck = async (page: import("playwright").Page) =>
  /captcha/i.test(page.url()) || (await page.getByText(/are you a person or a robot/i).count()) > 0;

function pageUrl(q: LegQuery): string {
  const base = skyscannerUrl({
    from: q.from[0],
    to: q.to[0],
    date: q.departFrom,
    returnDate: q.returnFrom,
    passengers: q.passengers,
    cabin: q.cabin,
  });
  const u = new URL(base);
  if (q.passengers.children) u.searchParams.set("childrenv2", Array(q.passengers.children).fill("8").join("|"));
  if (q.maxStops === 0) u.searchParams.set("preferDirects", "true");
  u.searchParams.set("currency", q.currency);
  u.searchParams.set("locale", "en-GB");
  u.searchParams.set("market", "UK");
  return u.toString();
}

async function saveDebug(name: string, body: string) {
  if (process.env.SKYSCANNER_DEBUG !== "1") return;
  const dir = path.join(path.dirname(config.browserProfileDir), "skyscanner-debug");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${Date.now()}-${name}.json`), body);
}

export const skyscannerProvider: FlightProvider = {
  id: "skyscanner",
  name: "Skyscanner",
  // One airport pair and one date (or date pair) per results page.
  capabilities: { multiAirport: false, dateRange: false, returnFares: true },
  concurrency: 1,
  get minDelayMs() {
    return config.skyscannerMinDelayMs;
  },
  configured: () => browserAvailable(),
  note: "Free, through the Skyscanner page in the FlightBuzz browser window. Asks you to do its Press & Hold check once. One airport pair per page, so opt-in.",
  unavailable: () => skyscannerGate.unavailable(),
  onRequest: () => skyscannerGate.onRequest(),
  async search(q: LegQuery): Promise<Fare[]> {
    const url = pageUrl(q);
    try {
      return await withTab("skyscanner", async (page) => {
        const bodies: { url: string; text: Promise<string> }[] = [];
        const onResponse = (r: import("playwright").Response) => {
          const u = r.url();
          if (/web-unified-search|\/radar\/api\/|conductor\/v1\/fps3\/search|\/g\/radar/i.test(u) && r.request().method() !== "OPTIONS") {
            bodies.push({ url: u, text: r.text().catch(() => "") });
          }
        };
        page.on("response", onResponse);
        try {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          // The robot check can appear a moment after the page loads, so keep an eye out for it.
          let checked = false;
          const passCheck = async () => {
            if (checked || !(await isSkyCheck(page))) return;
            checked = true;
            await waitForHuman(page, "Skyscanner", isSkyCheck);
            bodies.length = 0;
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          };
          await page.waitForTimeout(2000);
          await passCheck();
          if (!checked && resp && resp.status() >= 400) throw new HttpStatusError(resp.status(), "Skyscanner");
          await clickIfPresent(page, [/accept all/i, /^ok$/i, /^accept$/i], 2000);
          await settle(page);
          // Results stream in; wait until the search says it is complete (or 45 s).
          const deadline = Date.now() + 45_000;
          let best: SkyItinerary[] = [];
          while (Date.now() < deadline) {
            await page.waitForTimeout(3000);
            await passCheck();
            for (const b of bodies.splice(0)) {
              const text = await b.text;
              if (!text) continue;
              await saveDebug("search", text);
              try {
                const json = JSON.parse(text);
                const items = skyscannerItineraries(json);
                if (items.length >= best.length) best = items;
                if (json?.context?.status === "complete" && best.length) return skyscannerFares(best, q, url);
              } catch {
                /* not JSON */
              }
            }
          }
          if (!best.length && (await isSkyCheck(page))) throw Object.assign(new Error("Skyscanner robot check not completed"), { name: "CaptchaError" });
          return skyscannerFares(best, q, url);
        } finally {
          page.off("response", onResponse);
        }
      });
    } catch (e) {
      skyscannerGate.onError(e);
      throw e;
    }
  },
};
