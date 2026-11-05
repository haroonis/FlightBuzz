import { datePart, daysBetween, localMinutes } from "../dates.ts";
import { convert } from "../fx.ts";
import { groundTransfer } from "../transfers.ts";
import type { Fare, GroundTransfer, Journey, SearchSpec, Slice, Step, Trip, TripTag } from "../types.ts";
import { backWindow, type RouteTemplate, type SearchPlan } from "./plan.ts";

export interface CombineOptions {
  /** Extra/overriding ground transfers (e.g. user-defined). */
  transfers?: GroundTransfer[];
  /** Max partial journeys kept between hops. */
  beamWidth?: number;
  /** Max journeys per direction kept for return pairing. */
  journeyLimit?: number;
  /** Max trips returned. */
  tripLimit?: number;
  /** Value of an hour of travel time, in GBP, for the "best" score. */
  valueOfHourGBP?: number;
}

interface Partial {
  steps: Step[];
  fares: Fare[];
  price: number;
  slices: Slice[];
}

function crossesNight(arrive: string, depart: string): boolean {
  if (datePart(arrive) !== datePart(depart)) return true;
  // Same calendar day but sitting through 01:00–05:00.
  return arrive.slice(11, 16) < "05:00";
}

/** Journey statistics from its steps. */
export function makeJourney(steps: Step[]): Journey {
  const flights = steps.filter((s): s is Extract<Step, { type: "flight" }> => s.type === "flight");
  const first = flights[0].slice;
  const last = flights[flights.length - 1].slice;
  let travelMin = 0;
  let stops = 0;
  let stopoverNights = 0;
  let selfTransfers = 0;
  let airportChanges = 0;
  let overnightLayovers = 0;
  for (const s of steps) {
    if (s.type === "flight") {
      const segs = s.slice.segments;
      stops += segs.length - 1;
      travelMin += s.slice.durationMin;
      for (let i = 1; i < segs.length; i++) {
        if (crossesNight(segs[i - 1].arriveLocal, segs[i].departLocal) && localMinutes(segs[i].departLocal) - localMinutes(segs[i - 1].arriveLocal) > 4 * 60)
          overnightLayovers++;
      }
    } else if (s.type === "layover") {
      stops++;
      if (s.kind === "stopover") stopoverNights += s.nights;
      else {
        selfTransfers++;
        travelMin += s.minutes;
        if (s.overnight) overnightLayovers++;
      }
    } else if (s.type === "ground") {
      airportChanges++;
      // Ground time is part of the layover already counted.
    }
  }
  return {
    from: first.from,
    to: last.to,
    departLocal: first.departLocal,
    arriveLocal: last.arriveLocal,
    steps,
    stops,
    travelMin,
    elapsedMin: flights.reduce((m, f) => m + f.slice.durationMin, 0) + layoverSum(steps),
    stopoverNights,
    selfTransfers,
    airportChanges,
    overnightLayovers,
  };
}

function layoverSum(steps: Step[]): number {
  return steps.reduce((m, s) => m + (s.type === "layover" ? s.minutes : 0), 0);
}

function sliceOk(slice: Slice, spec: SearchSpec): boolean {
  const segs = slice.segments;
  for (let i = 1; i < segs.length; i++) {
    const gap = localMinutes(segs[i].departLocal) - localMinutes(segs[i - 1].arriveLocal);
    if (gap > spec.maxLayoverHours * 60) return false;
  }
  return true;
}

/** Build the journeys for one route template from the fares fetched for its legs. */
export function journeysForRoute(
  route: RouteTemplate,
  faresByLeg: Record<string, Fare[]>,
  spec: SearchSpec,
  opts: CombineOptions = {},
): { journey: Journey; fares: Fare[]; price: number }[] {
  const beam = opts.beamWidth ?? 400;
  const pax = spec.passengers.adults + spec.passengers.children;
  const fareSets = route.legKeys.map((k) => (faresByLeg[k] ?? []).filter((f) => f.slices.length === 1 && sliceOk(f.slices[0], spec)));
  if (fareSets.some((s) => !s.length)) return [];

  let partials: Partial[] = fareSets[0].map((f) => ({
    steps: [{ type: "flight", slice: f.slices[0], fareId: f.id, provider: f.provider }],
    fares: [f],
    price: convert(f.price, f.currency, spec.currency),
    slices: [f.slices[0]],
  }));

  for (let hop = 1; hop < fareSets.length; hop++) {
    const rule = route.stops[hop - 1];
    const next: Partial[] = [];
    for (const p of partials) {
      const prev = p.slices[p.slices.length - 1];
      const arr = localMinutes(prev.arriveLocal);
      for (const f of fareSets[hop]) {
        const s = f.slices[0];
        let transfer: GroundTransfer | undefined;
        if (s.from !== prev.to) {
          if (!spec.groundTransfers) continue;
          transfer = groundTransfer(prev.to, s.from, opts.transfers);
          if (!transfer || transfer.minutes > spec.maxGroundHours * 60) continue;
        }
        const gap = localMinutes(s.departLocal) - arr;
        const needed = spec.minSelfTransferMinutes + (transfer?.minutes ?? 0);
        if (gap < needed) continue;
        const nights = daysBetween(datePart(prev.arriveLocal), datePart(s.departLocal));
        const short = gap <= spec.maxLayoverHours * 60;
        // A planned stay must give at least half a day on the ground.
        const stayOk = nights >= Math.max(1, rule.minNights) && nights <= rule.maxNights && gap >= 12 * 60;
        let ok: boolean;
        if (rule.maxNights === 0) ok = short;
        else if (rule.minNights === 0) ok = short || stayOk;
        else ok = stayOk;
        if (!ok) continue;
        const isStopover = !(rule.minNights === 0 && short);
        const steps: Step[] = [...p.steps];
        if (transfer) {
          const price = convert(transfer.cost, transfer.currency, spec.currency) * pax;
          steps.push({ type: "ground", transfer, price });
        }
        steps.push({
          type: "layover",
          at: transfer ? `${prev.to}→${s.from}` : prev.to,
          minutes: gap,
          kind: isStopover ? "stopover" : "self-transfer",
          overnight: !isStopover && crossesNight(prev.arriveLocal, s.departLocal),
          nights: isStopover ? Math.max(nights, 1) : 0,
        });
        steps.push({ type: "flight", slice: s, fareId: f.id, provider: f.provider });
        const groundPrice = transfer ? convert(transfer.cost, transfer.currency, spec.currency) * pax : 0;
        next.push({
          steps,
          fares: [...p.fares, f],
          price: p.price + convert(f.price, f.currency, spec.currency) + groundPrice,
          slices: [...p.slices, s],
        });
      }
    }
    partials = prune(next, beam);
    if (!partials.length) return [];
  }

  return partials
    .map((p) => ({ journey: makeJourney(p.steps), fares: p.fares, price: p.price }))
    .filter((j) => j.journey.stops <= spec.maxStops);
}

/** Keep the cheapest partials while making sure every departure date stays represented. */
function prune<T extends { price: number; slices: Slice[] }>(items: T[], width: number): T[] {
  if (items.length <= width) return items;
  items.sort((a, b) => a.price - b.price);
  const keep = new Set(items.slice(0, Math.floor(width * 0.7)));
  const perDay = new Map<string, number>();
  for (const it of items) {
    if (keep.size >= width) break;
    const d = datePart(it.slices[0].departLocal);
    const n = perDay.get(d) ?? 0;
    if (n < 5 && !keep.has(it)) {
      keep.add(it);
      perDay.set(d, n + 1);
    }
  }
  return [...keep];
}

export function scoreTrip(price: number, journeys: Journey[], currency: string, valueOfHourGBP = 8): number {
  const voh = convert(valueOfHourGBP, "GBP", currency);
  const unit = convert(1, "GBP", currency);
  let s = price;
  for (const j of journeys) {
    s += (j.travelMin / 60) * voh;
    s += j.stops * 12 * unit;
    s += j.selfTransfers * 25 * unit;
    s += j.airportChanges * 30 * unit;
    s += j.overnightLayovers * 40 * unit;
  }
  return Math.round(s);
}

function tagsFor(out: Journey, back: Journey | undefined, fares: Fare[]): TripTag[] {
  const tags = new Set<TripTag>();
  const js = back ? [out, back] : [out];
  if (js.every((j) => j.stops === 0)) tags.add("direct");
  if (js.some((j) => j.selfTransfers > 0)) tags.add("self-transfer");
  if (js.some((j) => j.stopoverNights > 0)) tags.add("stopover");
  if (js.some((j) => j.airportChanges > 0)) tags.add("airport-change");
  if (js.some((j) => j.overnightLayovers > 0)) tags.add("overnight-layover");
  if (back && (back.from !== out.to || back.to !== out.from)) tags.add("open-jaw");
  if (new Set(fares.map((f) => f.provider)).size > 1) tags.add("multi-provider");
  return [...tags];
}

function tripId(fares: Fare[]): string {
  const s = fares.map((f) => f.id).join("+");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Turn fetched fares into ranked trips. */
export function buildTrips(
  spec: SearchSpec,
  plan: SearchPlan,
  faresByLeg: Record<string, Fare[]>,
  opts: CombineOptions = {},
): Trip[] {
  const journeyLimit = opts.journeyLimit ?? 300;
  const tripLimit = opts.tripLimit ?? 600;
  const voh = opts.valueOfHourGBP;
  const outs = plan.routes.filter((r) => r.direction === "out").flatMap((r) => journeysForRoute(r, faresByLeg, spec, opts));
  const trips = new Map<string, Trip>();
  const add = (t: Omit<Trip, "id" | "score" | "tags">) => {
    const id = tripId(t.fares);
    const prev = trips.get(id);
    if (prev && prev.price <= t.price) return;
    const js = t.back ? [t.out, t.back] : [t.out];
    trips.set(id, { ...t, id, score: scoreTrip(t.price, js, spec.currency, voh), tags: tagsFor(t.out, t.back, t.fares) });
  };

  if (spec.return.type === "oneway") {
    for (const o of outs) add({ price: round(o.price), currency: spec.currency, out: o.journey, fares: o.fares });
  } else {
    const backs = plan.routes.filter((r) => r.direction === "back").flatMap((r) => journeysForRoute(r, faresByLeg, spec, opts));
    const topOut = diverse(outs, journeyLimit, spec.currency, voh);
    const topBack = diverse(backs, journeyLimit, spec.currency, voh);
    const bw = backWindow(spec)!;
    for (const o of topOut) {
      const arr = localMinutes(o.journey.arriveLocal);
      for (const b of topBack) {
        if (localMinutes(b.journey.departLocal) - arr < 6 * 60) continue;
        const backDate = datePart(b.journey.departLocal);
        if (spec.return.type === "dates") {
          if (backDate < bw.from || backDate > bw.to) continue;
        } else {
          const nights = daysBetween(datePart(o.journey.arriveLocal), backDate);
          if (nights < spec.return.min || nights > spec.return.max) continue;
        }
        add({ price: round(o.price + b.price), currency: spec.currency, out: o.journey, back: b.journey, fares: [...o.fares, ...b.fares] });
      }
    }
    // Native return tickets.
    for (const f of plan.returnLegKey ? faresByLeg[plan.returnLegKey] ?? [] : []) {
      if (f.slices.length !== 2 || !f.slices.every((s) => sliceOk(s, spec))) continue;
      const step = (s: Slice): Step => ({ type: "flight", slice: s, fareId: f.id, provider: f.provider });
      const out = makeJourney([step(f.slices[0])]);
      const back = makeJourney([step(f.slices[1])]);
      if (out.stops > spec.maxStops || back.stops > spec.maxStops) continue;
      add({ price: round(convert(f.price, f.currency, spec.currency)), currency: spec.currency, out, back, fares: [f] });
    }
  }
  return selectDiverse([...trips.values()], tripLimit);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Keep the cheapest and the best-scoring journeys, across each stop count. */
function diverse<T extends { journey: Journey; price: number }>(items: T[], limit: number, currency: string, voh?: number): T[] {
  if (items.length <= limit) return items;
  const score = (x: T) => scoreTrip(x.price, [x.journey], currency, voh);
  const keep = new Set<T>();
  const byPrice = [...items].sort((a, b) => a.price - b.price);
  const byScore = [...items].sort((a, b) => score(a) - score(b));
  const buckets = new Map<number, T[]>();
  for (const it of byPrice) {
    const k = Math.min(it.journey.stops, 3) + (it.journey.stopoverNights ? 10 : 0);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(it);
  }
  const share = Math.max(5, Math.floor(limit / (buckets.size * 3)));
  for (const b of buckets.values()) b.slice(0, share).forEach((x) => keep.add(x));
  for (let i = 0; keep.size < limit && i < items.length; i++) {
    keep.add(byPrice[i]);
    if (keep.size < limit) keep.add(byScore[i]);
  }
  return [...keep];
}

/** Final trip list: cheapest and best in every bucket, then fill by score. */
function selectDiverse(trips: Trip[], limit: number): Trip[] {
  const bucket = (t: Trip) => {
    const stops = Math.max(t.out.stops, t.back?.stops ?? 0);
    return `${Math.min(stops, 3)}|${t.tags.includes("stopover")}|${t.tags.includes("airport-change")}`;
  };
  const groups = new Map<string, Trip[]>();
  for (const t of trips) (groups.get(bucket(t)) ?? groups.set(bucket(t), []).get(bucket(t))!).push(t);
  const keep = new Set<Trip>();
  const share = Math.max(10, Math.floor(limit / (groups.size * 2 || 1)));
  for (const g of groups.values()) {
    [...g].sort((a, b) => a.price - b.price).slice(0, share).forEach((t) => keep.add(t));
    [...g].sort((a, b) => a.score - b.score).slice(0, share).forEach((t) => keep.add(t));
  }
  const rest = trips.filter((t) => !keep.has(t)).sort((a, b) => a.score - b.score);
  for (const t of rest) {
    if (keep.size >= limit) break;
    keep.add(t);
  }
  return [...keep].sort((a, b) => a.price - b.price);
}
