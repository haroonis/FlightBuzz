import type { Fare, LegQuery, Segment, Slice } from "@flightbuzz/core";
import { config } from "../config.ts";
import type { FlightProvider } from "./types.ts";

/**
 * Kiwi.com Tequila API (https://tequila.kiwi.com). Since 2024 keys are only
 * issued to approved partners, so this is for users who already have one.
 * Handles airport lists, date ranges and native return fares in one request.
 */

interface KiwiRoute {
  flyFrom: string;
  flyTo: string;
  local_departure: string; // local time with a misleading "Z"
  local_arrival: string;
  utc_departure: string;
  utc_arrival: string;
  airline: string;
  operating_carrier?: string;
  flight_no: number;
  return: 0 | 1;
}
interface KiwiItinerary {
  id: string;
  price: number;
  route: KiwiRoute[];
  deep_link?: string;
}

const CABIN = { economy: "M", premium: "W", business: "C", first: "F" } as const;
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const local = (s: string) => s.slice(0, 16);
const utcMin = (s: string) => Math.round(Date.parse(s) / 60000);

function toSlice(routes: KiwiRoute[]): Slice {
  const segments: Segment[] = routes.map((r) => ({
    from: r.flyFrom,
    to: r.flyTo,
    departLocal: local(r.local_departure),
    arriveLocal: local(r.local_arrival),
    durationMin: utcMin(r.utc_arrival) - utcMin(r.utc_departure),
    carrier: r.airline,
    flightNo: `${r.airline}${r.flight_no}`,
  }));
  const first = routes[0];
  const last = routes[routes.length - 1];
  return {
    from: first.flyFrom,
    to: last.flyTo,
    departLocal: local(first.local_departure),
    arriveLocal: local(last.local_arrival),
    durationMin: utcMin(last.utc_arrival) - utcMin(first.utc_departure),
    segments,
  };
}

export const kiwiProvider: FlightProvider = {
  id: "kiwi",
  name: "Kiwi.com (Tequila)",
  capabilities: { multiAirport: true, dateRange: true, returnFares: true },
  concurrency: 2,
  minDelayMs: 300,
  configured: () => !!config.kiwiTequilaKey,
  note: "Needs a Tequila partner key (KIWI_TEQUILA_KEY). Includes Kiwi's self-transfer itineraries.",
  async search(q: LegQuery, ctx): Promise<Fare[]> {
    const p = new URLSearchParams({
      fly_from: q.from.join(","),
      fly_to: q.to.join(","),
      date_from: ddmmyyyy(q.departFrom),
      date_to: ddmmyyyy(q.departTo),
      adults: String(q.passengers.adults),
      children: String(q.passengers.children),
      infants: String(q.passengers.infants),
      selected_cabins: CABIN[q.cabin],
      curr: q.currency,
      max_stopovers: String(q.maxStops),
      flight_type: q.returnFrom ? "round" : "oneway",
      vehicle_type: "aircraft",
      sort: "price",
      limit: "500",
    });
    if (q.returnFrom) {
      p.set("return_from", ddmmyyyy(q.returnFrom));
      p.set("return_to", ddmmyyyy(q.returnTo!));
    }
    const res = await fetch(`https://api.tequila.kiwi.com/v2/search?${p}`, {
      headers: { apikey: config.kiwiTequilaKey, accept: "application/json" },
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`Kiwi HTTP ${res.status}`);
    const body = (await res.json()) as { data?: KiwiItinerary[] };
    const fetchedAt = new Date().toISOString();
    return (body.data ?? []).map((it) => {
      const out = it.route.filter((r) => r.return === 0);
      const back = it.route.filter((r) => r.return === 1);
      return {
        id: `kiwi:${it.id}`,
        provider: "kiwi",
        price: it.price,
        currency: q.currency,
        slices: back.length ? [toSlice(out), toSlice(back)] : [toSlice(out)],
        deepLink: it.deep_link,
        fetchedAt,
      };
    });
  },
};
