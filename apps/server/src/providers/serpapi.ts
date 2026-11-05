import { localMinutes, type Fare, type LegQuery, type Segment } from "@flightbuzz/core";
import { config } from "../config.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Google Flights through SerpApi (https://serpapi.com/google-flights-api).
 * Paid, stable, accepts comma-separated airports on each side.
 */

interface SerpAirport {
  id: string;
  name: string;
  time: string; // "2026-12-01 10:30"
}
interface SerpFlight {
  departure_airport: SerpAirport;
  arrival_airport: SerpAirport;
  duration: number;
  airline: string;
  flight_number?: string;
}
interface SerpOption {
  flights: SerpFlight[];
  total_duration?: number;
  price?: number;
}

const CLASS = { economy: 1, premium: 2, business: 3, first: 4 } as const;
// SerpApi stops: 0 any, 1 nonstop, 2 one stop or fewer, 3 two stops or fewer.
const stopsParam = (n: number) => (n >= 3 ? 0 : n + 1);

export const serpApiProvider: FlightProvider = {
  id: "serpapi",
  name: "Google Flights (SerpApi)",
  capabilities: { multiAirport: true, dateRange: false, returnFares: false },
  concurrency: 3,
  minDelayMs: 200,
  configured: () => !!config.serpApiKey,
  note: "Paid API (SERPAPI_KEY). Multi-airport per request, one date per request.",
  async search(q: LegQuery, ctx): Promise<Fare[]> {
    const p = new URLSearchParams({
      engine: "google_flights",
      departure_id: q.from.join(","),
      arrival_id: q.to.join(","),
      outbound_date: q.departFrom,
      type: "2",
      currency: q.currency,
      hl: "en",
      gl: "uk",
      adults: String(q.passengers.adults),
      children: String(q.passengers.children),
      infants_on_lap: String(q.passengers.infants),
      travel_class: String(CLASS[q.cabin]),
      stops: String(stopsParam(q.maxStops)),
      api_key: config.serpApiKey,
    });
    const res = await fetch(`https://serpapi.com/search.json?${p}`, { signal: ctx.signal });
    if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
    const body = (await res.json()) as { error?: string; best_flights?: SerpOption[]; other_flights?: SerpOption[]; search_metadata?: { google_flights_url?: string } };
    if (body.error) {
      if (/hasn't returned any results/i.test(body.error)) return [];
      throw new Error(`SerpApi: ${body.error}`);
    }
    const fetchedAt = new Date().toISOString();
    const options = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
    return options
      .filter((o) => o.price && o.flights?.length)
      .map((o) => {
        const segments: Segment[] = o.flights.map((f) => ({
          from: f.departure_airport.id,
          to: f.arrival_airport.id,
          departLocal: f.departure_airport.time.replace(" ", "T"),
          arriveLocal: f.arrival_airport.time.replace(" ", "T"),
          durationMin: f.duration,
          carrier: f.flight_number?.split(" ")[0] ?? f.airline,
          carrierName: f.airline,
          flightNo: f.flight_number?.replace(" ", ""),
        }));
        const first = segments[0];
        const last = segments[segments.length - 1];
        return {
          id: `serpapi:${segments.map((s) => `${s.flightNo ?? s.carrier}${s.departLocal}`).join("|")}`,
          provider: "serpapi",
          price: o.price!,
          currency: q.currency,
          slices: [
            {
              from: first.from,
              to: last.to,
              departLocal: first.departLocal,
              arriveLocal: last.arriveLocal,
              durationMin: o.total_duration ?? sliceDuration(segments, localMinutes),
              segments,
            },
          ],
          deepLink: body.search_metadata?.google_flights_url,
          fetchedAt,
        } satisfies Fare;
      });
  },
};
