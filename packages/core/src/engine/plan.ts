import { addDays, daysBetween, eachDay } from "../dates.ts";
import { GroupRegistry, defaultRegistry, expandPlaces, withNearby } from "../places.ts";
import type { DateRange, LegQuery, ProviderCapabilities, SearchSpec, StopoverStop } from "../types.ts";

/**
 * A way to travel one direction: a chain of airport sets joined by separately
 * ticketed legs. Direct = [origins, destinations] with one leg.
 */
export interface RouteTemplate {
  id: string;
  direction: "out" | "back";
  /** Airport sets: [start, hub1, ..., end]. */
  points: string[][];
  /** Stay rules for each hub (points.length - 2 entries). */
  stops: StopoverStop[];
  /** One leg key per hop. */
  legKeys: string[];
  label: string;
}

export interface SearchPlan {
  originAirports: string[];
  destAirports: string[];
  legs: Record<string, LegQuery>;
  routes: RouteTemplate[];
  /** Native return-ticket query (only used by providers that price returns). */
  returnLegKey?: string;
}

export function legKey(q: LegQuery): string {
  const nights = q.nightsMin !== undefined ? `|n${q.nightsMin}-${q.nightsMax}` : "";
  const ret = q.returnFrom ? `|ret:${q.returnFrom}..${q.returnTo}${nights}` : "";
  const pax = `${q.passengers.adults}.${q.passengers.children}.${q.passengers.infants}`;
  const bags = q.holdBags ? `|bags${q.holdBags}` : "";
  const airlines = q.airlines?.length ? `|al:${q.airlines.join(",")}` : "";
  return `${q.from.join(",")}>${q.to.join(",")}|${q.departFrom}..${q.departTo}${ret}|s${q.maxStops}|${q.cabin}|${pax}${bags}${airlines}|${q.currency}`;
}

/** Departure window for the return direction. */
export function backWindow(spec: SearchSpec): DateRange | undefined {
  const r = spec.return;
  if (r.type === "oneway") return undefined;
  if (r.type === "dates") return r.range;
  // +1: long flights can land the day after departure.
  return { from: addDays(spec.depart.from, r.min), to: addDays(spec.depart.to, r.max + 1) };
}

export function planSearch(spec: SearchSpec, reg: GroupRegistry = defaultRegistry): SearchPlan {
  const origins = withNearby(expandPlaces(spec.origins, reg), spec.nearbyKm ?? 0);
  const dests = withNearby(expandPlaces(spec.destinations, reg), spec.nearbyKm ?? 0);
  const legs: Record<string, LegQuery> = {};
  const routes: RouteTemplate[] = [];
  const base = { passengers: spec.passengers, cabin: spec.cabin, currency: spec.currency, ...(spec.holdBags ? { holdBags: spec.holdBags } : {}), ...(spec.airlines?.length ? { airlines: [...spec.airlines].sort() } : {}) };

  const addLeg = (from: string[], to: string[], window: DateRange, maxStops: number) => {
    const q: LegQuery = { from, to, departFrom: window.from, departTo: window.to, maxStops, ...base };
    const key = legKey(q);
    legs[key] ??= q;
    return key;
  };

  const addDirection = (direction: "out" | "back", start: string[], end: string[], window: DateRange) => {
    routes.push({
      id: `${direction}:direct`,
      direction,
      points: [start, end],
      stops: [],
      legKeys: [addLeg(start, end, window, spec.maxStops)],
      label: "Single ticket",
    });

    spec.stopovers
      .filter((p) => p.direction === "both" || p.direction === direction)
      .forEach((plan, idx) => {
        const stops = direction === "back" ? [...plan.stops].reverse() : plan.stops;
        if (stops.length > spec.maxStops) return;
        const endpoints = new Set([...start, ...end]);
        const hubs = stops.map((s) => expandPlaces(s.places, reg).filter((a) => !endpoints.has(a)));
        if (hubs.some((h) => !h.length)) return;
        const points = [start, ...hubs, end];
        // Connections left for the individual tickets once the hubs are counted.
        const legStops = Math.max(0, spec.maxStops - stops.length);
        const legKeys: string[] = [];
        let w = window;
        for (let i = 0; i < points.length - 1; i++) {
          legKeys.push(addLeg(points[i], points[i + 1], w, legStops));
          const s = stops[i];
          if (!s) break;
          // Next leg leaves minNights..maxNights after arrival; arrival may be a day later,
          // and a 0-night self-transfer can roll over midnight.
          const overnightSlack = s.maxNights === 0 ? Math.ceil(spec.maxLayoverHours / 24) : 0;
          w = { from: addDays(w.from, s.minNights), to: addDays(w.to, s.maxNights + 1 + overnightSlack) };
        }
        const label = stops
          .map((s) => {
            const n = s.minNights === s.maxNights ? `${s.minNights}` : `${s.minNights}-${s.maxNights}`;
            return `${s.places.join("/")} ${s.maxNights === 0 ? "self-transfer" : `${n} night${s.maxNights === 1 ? "" : "s"}`}`;
          })
          .join(" → ");
        routes.push({ id: `${direction}:via${idx}`, direction, points, stops, legKeys, label: `Via ${label}` });
      });
  };

  const bw = backWindow(spec);
  const returnOnly = !!(spec.returnTicketsOnly && bw);
  if (!returnOnly) addDirection("out", origins, dests, spec.depart);
  let returnLegKey: string | undefined;
  if (bw) {
    if (!returnOnly) addDirection("back", dests, origins, bw);
    const q: LegQuery = {
      from: origins,
      to: dests,
      departFrom: spec.depart.from,
      departTo: spec.depart.to,
      returnFrom: bw.from,
      returnTo: bw.to,
      // Nights between outbound departure and return dates (+1: arrival can be next day).
      ...(spec.return.type === "nights" ? { nightsMin: spec.return.min, nightsMax: spec.return.max + 1 } : {}),
      maxStops: spec.maxStops,
      ...base,
    };
    returnLegKey = legKey(q);
    legs[returnLegKey] = q;
  }
  return { originAirports: origins, destAirports: dests, legs, routes, returnLegKey };
}

/**
 * Break a leg query into requests a provider can answer: per day if it has no
 * date-range support, per airport pair if it has no multi-airport support.
 */
export function splitForProvider(q: LegQuery, caps: ProviderCapabilities): LegQuery[] {
  if (q.returnFrom && !caps.returnFares) return [];
  const days = caps.dateRange ? [[q.departFrom, q.departTo]] : eachDay(q.departFrom, q.departTo).map((d) => [d, d]);
  const chunk = (xs: string[], n: number) => !Number.isFinite(n) ? [xs] : Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const size = caps.multiAirport ? (caps.maxAirportsPerSide ?? Infinity) : 1;
  const pairs = chunk(q.from, size).flatMap((f) => chunk(q.to, size).map((t) => [f, t]));
  const out: LegQuery[] = [];
  for (const [df, dt] of days) {
    for (const [from, to] of pairs) {
      if (!caps.returnFares || !q.returnFrom) {
        out.push({ ...q, from, to, departFrom: df, departTo: dt });
      } else if (caps.dateRange) {
        out.push({ ...q, from, to, departFrom: df, departTo: dt });
      } else {
        for (const rd of eachDay(q.returnFrom, q.returnTo!)) {
          const n = daysBetween(df, rd);
          if (n < (q.nightsMin ?? 1) || n > (q.nightsMax ?? Infinity)) continue;
          const { nightsMin: _a, nightsMax: _b, ...one } = q;
          out.push({ ...one, from, to, departFrom: df, departTo: dt, returnFrom: rd, returnTo: rd });
        }
      }
    }
  }
  return out;
}

/** Number of provider requests a plan needs. */
export function estimateRequests(plan: SearchPlan, caps: ProviderCapabilities): number {
  return Object.values(plan.legs).reduce((n, q) => n + splitForProvider(q, caps).length, 0);
}
