/**
 * Cheapest door-to-door routings from everything already searched (the fare
 * cache): return tickets from home, from other UK airports (plus the train),
 * and from any European airport (plus positioning flights, airport transfers,
 * hotel nights and the train home). Nothing here fetches new prices.
 */
import { AIRPORTS, addDays, airport, convert, daysBetween, groundTransfer, haversineKm, type Fare } from "@flightbuzz/core";
import { db } from "./db.ts";

export interface BestOptions {
  /** Home airports: no train needed. */
  home: string[];
  /** Destination airports, and extra ones reachable by road from a destination (with the road cost). */
  to: string[];
  /** Extra arrival airports and the destination they connect to by road, e.g. { ISB: "LHE", SKT: "LHE" }. */
  roadTo: Record<string, string>;
  /** Earliest departure from the UK (local time, YYYY-MM-DDTHH:mm). */
  leaveFrom: string;
  /** Latest arrival back in the UK. */
  backBy: string;
  /** Ignore prices older than this. */
  maxAgeHours: number;
  /** Rough one-way train fare from home to other UK airports, in GBP. */
  trainFromHome: Record<string, number>;
  /** Rough cheapest hotel per night by country code, in GBP (default `*`). */
  hotel: Record<string, number>;
  /** Minimum time between flights on separate tickets, minutes. */
  connectMin: number;
}

export const DEFAULT_BEST: BestOptions = {
  home: ["MAN", "LPL", "LBA"],
  to: ["LHE", "MUX", "LYP"],
  roadTo: { ISB: "LHE", SKT: "LHE" },
  leaveFrom: "2026-12-15T15:00",
  backBy: "2027-01-03T23:59",
  maxAgeHours: 72,
  trainFromHome: { MAN: 0, LPL: 12, LBA: 15, BHX: 20, EMA: 25, NCL: 30, LHR: 45, LGW: 45, STN: 45, LTN: 40, EDI: 40, GLA: 40, BRS: 40 },
  hotel: { IT: 50, ES: 50, PT: 50, GR: 45, TR: 45, RS: 40, HU: 45, RO: 40, AL: 35, DE: 60, FR: 65, NL: 70, BE: 65, AT: 60, CH: 90, "*": 55 },
  connectMin: 180,
};

export interface CostLine {
  label: string;
  gbp: number;
}

export interface Routing {
  total: number;
  kind: "from home" | "from another UK airport" | "via Europe";
  hub: string;
  costs: CostLine[];
  notes: string[];
}

const UK = new Set(AIRPORTS.filter((a) => a.country === "GB").map((a) => a.iata));
const hm = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
const mins = (t: string) => Date.parse(`${t}:00Z`) / 60000;
const gbp = (f: Fare) => Math.round(convert(f.price, f.currency, "GBP"));
const carriers = (f: Fare) => [...new Set(f.slices[0].segments.map((g) => g.carrierName ?? g.carrier))].join("/");
const route = (f: Fare) => `${f.slices[0].segments.map((g) => g.from).join("-")}-${f.slices[0].to}`;

function ground(from: string, to: string): { gbp: number; minutes: number; mode: string } | null {
  if (from === to) return { gbp: 0, minutes: 0, mode: "" };
  const t = groundTransfer(from, to);
  return t ? { gbp: Math.round(convert(t.cost, t.currency, "GBP")), minutes: t.minutes, mode: t.mode } : null;
}

function loadFares(maxAgeHours: number): Fare[] {
  const rows = db.prepare("SELECT fetched_at, fares FROM fare_cache WHERE fetched_at > ?").all(Date.now() - maxAgeHours * 3600_000) as {
    fetched_at: number;
    fares: string;
  }[];
  const latest = new Map<string, { f: Fare; at: number }>();
  for (const r of rows) {
    for (const f of JSON.parse(r.fares) as Fare[]) {
      const k = f.slices.map((s) => s.segments.map((g) => g.from + g.to + g.departLocal).join()).join("|") + "|" + (f.openReturn?.date ?? "");
      const prev = latest.get(k);
      if (!prev || r.fetched_at > prev.at) latest.set(k, { f, at: r.fetched_at });
    }
  }
  return [...latest.values()].map((x) => x.f);
}

export function findBest(o: BestOptions = DEFAULT_BEST, limit = 15): Routing[] {
  const fares = loadFares(o.maxAgeHours);
  const dests = new Set([...o.to, ...Object.keys(o.roadTo)]);
  const home = new Set(o.home);
  const oneWays = fares.filter((f) => f.slices.length === 1 && !f.openReturn);
  const returns = fares.filter((f) => f.openReturn && f.slices.length === 1 && dests.has(f.slices[0].to));
  const direct = oneWays.filter((f) => f.slices[0].segments.length === 1);
  const road = (dest: string): CostLine[] => {
    const via = o.roadTo[dest];
    if (!via) return [];
    const g = ground(dest, via);
    return g ? [{ label: `road ${dest} ⇄ ${via} both ways (${g.mode}, ~${Math.round(g.minutes / 60)}h each)`, gbp: 2 * g.gbp }] : [];
  };
  const hotel = (ap: string, nights: number): CostLine[] =>
    nights > 0 ? [{ label: `${nights} hotel night${nights > 1 ? "s" : ""} near ${airport(ap)?.city ?? ap} (cheapest, estimate)`, gbp: nights * (o.hotel[airport(ap)?.country ?? ""] ?? o.hotel["*"]) }] : [];
  // When a return ticket's way back lands in Europe, from one-way searches of the same route.
  const landing = (hub: string, dest: string, date: string): string | undefined =>
    oneWays
      .filter((f) => f.slices[0].to === hub && f.slices[0].departLocal.startsWith(date) && (f.slices[0].from === dest || dests.has(f.slices[0].from)))
      .sort((a, b) => (a.slices[0].from === dest ? -1 : 1) - (b.slices[0].from === dest ? -1 : 1) || a.slices[0].arriveLocal.localeCompare(b.slices[0].arriveLocal))[0]?.slices[0].arriveLocal;
  // Airports within reach of a hub by a known ground transfer.
  const nearCache = new Map<string, string[]>();
  const near = (hub: string) => {
    if (!nearCache.has(hub)) {
      const h = airport(hub);
      const list = AIRPORTS.filter((a) => a.size !== "S" && h && haversineKm(a, h) < 250 && ground(a.iata, hub)).map((a) => a.iata);
      nearCache.set(hub, [hub, ...list.filter((x) => x !== hub)]);
    }
    return nearCache.get(hub)!;
  };

  const out: Routing[] = [];
  for (const f of returns) {
    const s = f.slices[0];
    const hub = s.from;
    const back = f.openReturn!.date;
    if (s.departLocal < o.leaveFrom.slice(0, 10)) continue;
    const lh: CostLine = { label: `${hm(s.departLocal)} ${route(f)} ${carriers(f)}, return ticket back ${back}`, gbp: gbp(f) };
    if (home.has(hub)) {
      if (s.departLocal < o.leaveFrom || back > o.backBy.slice(0, 10)) continue;
      const costs = [lh, ...road(s.to)];
      out.push({ total: costs.reduce((n, c) => n + c.gbp, 0), kind: "from home", hub, costs, notes: [] });
      continue;
    }
    if (UK.has(hub)) {
      if (s.departLocal < o.leaveFrom || back > o.backBy.slice(0, 10)) continue;
      const t = o.trainFromHome[hub] ?? 50;
      const costs = [{ label: `train home ⇄ ${hub} both ways (estimate)`, gbp: 2 * t }, lh, ...road(s.to)];
      out.push({ total: costs.reduce((n, c) => n + c.gbp, 0), kind: "from another UK airport", hub, costs, notes: [] });
      continue;
    }
    // Via a European hub: cheapest way there and back from any UK airport.
    const land = landing(hub, s.to, back);
    // Unknown landing time: assume the next day at noon (long-haul returns usually land in Europe next morning).
    const landAt = land ?? `${addDays(back, 1)}T12:00`;
    const notes = land ? [] : [`landing time back in ${hub} not searched: assumed ${hm(landAt)}; check before booking`];
    let bestThere: { costs: CostLine[]; total: number } | undefined;
    for (const p of direct) {
      const P = p.slices[0];
      if (!UK.has(P.from) || !near(hub).includes(P.to) || P.departLocal < o.leaveFrom) continue;
      const g = ground(P.to, hub)!;
      if (mins(s.departLocal) - (mins(P.arriveLocal) + g.minutes) < o.connectMin) continue;
      const nights = daysBetween(P.arriveLocal.slice(0, 10), s.departLocal.slice(0, 10));
      const costs: CostLine[] = [
        ...(o.trainFromHome[P.from] ? [{ label: `train home → ${P.from} (estimate)`, gbp: o.trainFromHome[P.from] }] : []),
        { label: `${hm(P.departLocal)} ${P.from}→${P.to} ${carriers(p)} (arrive ${hm(P.arriveLocal)})`, gbp: gbp(p) },
        ...(g.gbp ? [{ label: `${g.mode} ${P.to}→${hub} (~${Math.round((g.minutes / 60) * 10) / 10}h)`, gbp: g.gbp }] : []),
        ...hotel(hub, nights),
      ];
      const total = costs.reduce((n, c) => n + c.gbp, 0);
      if (!bestThere || total < bestThere.total) bestThere = { costs, total };
    }
    if (!bestThere) continue;
    let bestHome: { costs: CostLine[]; total: number } | undefined;
    for (const p of direct) {
      const P = p.slices[0];
      if (!UK.has(P.to) || !near(hub).includes(P.from) || P.arriveLocal > o.backBy) continue;
      const g = ground(hub, P.from)!;
      if (mins(P.departLocal) - (mins(landAt) + g.minutes) < o.connectMin) continue;
      const nights = daysBetween(landAt.slice(0, 10), P.departLocal.slice(0, 10));
      const costs: CostLine[] = [
        ...hotel(hub, nights),
        ...(g.gbp ? [{ label: `${g.mode} ${hub}→${P.from} (~${Math.round((g.minutes / 60) * 10) / 10}h)`, gbp: g.gbp }] : []),
        { label: `${hm(P.departLocal)} ${P.from}→${P.to} ${carriers(p)} (arrive ${hm(P.arriveLocal)})`, gbp: gbp(p) },
        ...(o.trainFromHome[P.to] ? [{ label: `train ${P.to} → home (estimate)`, gbp: o.trainFromHome[P.to] }] : []),
      ];
      const total = costs.reduce((n, c) => n + c.gbp, 0);
      if (!bestHome || total < bestHome.total) bestHome = { costs, total };
    }
    if (!bestHome) continue;
    const costs = [...bestThere.costs, { ...lh, label: `${lh.label}${land ? `, lands ${hub} ${hm(land)}` : ""}` }, ...road(s.to), ...bestHome.costs];
    out.push({ total: costs.reduce((n, c) => n + c.gbp, 0), kind: "via Europe", hub, costs, notes });
  }
  out.sort((a, b) => a.total - b.total);
  // One routing per hub + long-haul date pair, so the list isn't ten copies of one trip.
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = r.hub + "|" + r.costs.find((c) => c.label.includes("return ticket"))!.label.slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}
