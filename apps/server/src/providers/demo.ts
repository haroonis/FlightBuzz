import {
  airport,
  eachDay,
  fromLocalMinutes,
  haversineKm,
  localMinutes,
  type Fare,
  type LegQuery,
  type Segment,
} from "@flightbuzz/core";
import type { FlightProvider } from "./types.ts";

/**
 * Synthetic fares for trying the app without any API keys. Deterministic per
 * route and date, with a small drift every 12 hours so tracked prices move.
 * Never shown as real prices: every fare is tagged with provider "demo".
 */

const HUBS: [string, string, string][] = [
  ["DXB", "EK", "Emirates"],
  ["DOH", "QR", "Qatar Airways"],
  ["IST", "TK", "Turkish Airlines"],
  ["AUH", "EY", "Etihad"],
  ["SHJ", "G9", "Air Arabia"],
  ["JED", "SV", "Saudia"],
  ["RUH", "SV", "Saudia"],
  ["MCT", "WY", "Oman Air"],
  ["BAH", "GF", "Gulf Air"],
  ["KWI", "KU", "Kuwait Airways"],
  ["FRA", "LH", "Lufthansa"],
  ["MUC", "LH", "Lufthansa"],
  ["AMS", "KL", "KLM"],
  ["CDG", "AF", "Air France"],
  ["LHR", "BA", "British Airways"],
  ["VIE", "OS", "Austrian"],
  ["ZRH", "LX", "Swiss"],
  ["ISB", "PK", "PIA"],
  ["LHE", "PK", "PIA"],
  ["KHI", "PK", "PIA"],
  ["DEL", "AI", "Air India"],
];

const HOME_CARRIERS: Record<string, [string, string][]> = {
  GB: [["BA", "British Airways"], ["LS", "Jet2"], ["FR", "Ryanair"], ["U2", "easyJet"]],
  PK: [["PK", "PIA"], ["PF", "AirSial"], ["ER", "SereneAir"], ["PA", "Airblue"]],
  AE: [["EK", "Emirates"], ["EY", "Etihad"], ["FZ", "flydubai"], ["G9", "Air Arabia"]],
  AT: [["OS", "Austrian"], ["W6", "Wizz Air"]],
  SK: [["FR", "Ryanair"], ["W6", "Wizz Air"]],
  HU: [["W6", "Wizz Air"]],
  TR: [["TK", "Turkish Airlines"], ["PC", "Pegasus"]],
  QA: [["QR", "Qatar Airways"]],
  SA: [["SV", "Saudia"], ["XY", "flynas"]],
  DE: [["LH", "Lufthansa"], ["EW", "Eurowings"]],
  FR: [["AF", "Air France"]],
  NL: [["KL", "KLM"]],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: string) {
  let x = hash(seed) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

const tzOffsetMin = (code: string) => Math.round((airport(code)?.lon ?? 0) / 15) * 60;
const flightMin = (km: number) => Math.round(35 + (km / 820) * 60);
const km = (a: string, b: string) => haversineKm(airport(a)!, airport(b)!);

function carrierFor(from: string, to: string, r: () => number): [string, string] {
  const opts = HOME_CARRIERS[airport(from)?.country ?? ""] ?? HOME_CARRIERS[airport(to)?.country ?? ""] ?? [["XQ", "Demo Air"]];
  return opts[Math.floor(r() * opts.length)];
}

function segment(from: string, to: string, departAbs: number, carrier: [string, string], r: () => number): Segment & { arriveAbs: number } {
  const dur = flightMin(km(from, to));
  const arriveAbs = departAbs + dur;
  return {
    from,
    to,
    departLocal: fromLocalMinutes(departAbs + tzOffsetMin(from)),
    arriveLocal: fromLocalMinutes(arriveAbs + tzOffsetMin(to)),
    durationMin: dur,
    carrier: carrier[0],
    carrierName: carrier[1],
    flightNo: `${carrier[0]}${100 + Math.floor(r() * 899)}`,
    arriveAbs,
  };
}

export function demoFares(from: string, to: string, date: string, q: LegQuery, now = new Date()): Fare[] {
  const a = airport(from);
  const b = airport(to);
  if (!a || !b || from === to) return [];
  const dist = km(from, to);
  if (dist < 120) return [];
  const pairR = rng(`${from}${to}`);
  const dayR = rng(`${from}${to}${date}`);
  const drift = 1 + (rng(`${from}${to}${date}${now.toISOString().slice(0, 10)}${now.getHours() < 12 ? "am" : "pm"}`)() - 0.5) * 0.16;
  const pax = q.passengers.adults + q.passengers.children + q.passengers.infants * 0.1;
  const cabin = { economy: 1, premium: 1.8, business: 3.6, first: 6 }[q.cabin];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayFactor = [1.12, 0.92, 0.88, 0.95, 1.1, 1.18, 1.0][weekday];
  const lcc = dist < 2800 && (a.size !== "L" || b.size !== "L") ? 0.6 : 1;
  const base = (28 + dist * 0.052) * cabin * pax * dayFactor * drift * lcc;
  // Local midnight of `date` at the origin, in absolute (UTC-like) minutes.
  const dayStartAbs = localMinutes(`${date}T00:00`) - tzOffsetMin(from);
  const fares: Fare[] = [];
  const fetchedAt = now.toISOString();
  const push = (segs: (Segment & { arriveAbs: number })[], mult: number) => {
    const first = segs[0];
    const last = segs[segs.length - 1];
    const departAbs = localMinutes(first.departLocal) - tzOffsetMin(first.from);
    const price = Math.round(base * mult * (0.8 + dayR() * 0.5));
    const clean = segs.map(({ arriveAbs: _a, ...s }) => s);
    fares.push({
      id: `demo:${clean.map((s) => s.flightNo + s.departLocal).join("|")}`,
      provider: "demo",
      price,
      currency: "GBP",
      slices: [{ from: first.from, to: last.to, departLocal: first.departLocal, arriveLocal: last.arriveLocal, durationMin: last.arriveAbs - departAbs, segments: clean }],
      fetchedAt,
    });
  };

  // Direct flights on routes where they plausibly exist.
  const hasDirect = pairR() < (a.size === "L" && b.size === "L" ? 0.75 : 0.35) && dist < 9000;
  if (hasDirect) {
    const n = 1 + Math.floor(dayR() * 2);
    for (let i = 0; i < n; i++) {
      const dep = dayStartAbs + 360 + Math.floor(dayR() * 900);
      push([segment(from, to, dep, carrierFor(from, to, dayR), dayR)], dist > 3500 ? 1.3 : 1.05);
    }
  }

  if (q.maxStops >= 1) {
    const hubs = HUBS.filter(([h]) => h !== from && h !== to && airport(h))
      .map(([h, c, n]) => ({ h, c: [c, n] as [string, string], detour: (km(from, h) + km(h, to)) / dist }))
      .filter((x) => x.detour < 1.35 && km(from, x.h) > 150 && km(x.h, to) > 150)
      .sort((x, y) => x.detour - y.detour)
      .slice(0, 5);
    for (const { h, c, detour } of hubs) {
      if (dayR() < 0.25) continue;
      const dep = dayStartAbs + 300 + Math.floor(dayR() * 1000);
      const s1 = segment(from, h, dep, c, dayR);
      // Connections: mostly 1.5–6h, sometimes overnight.
      const conn = dayR() < 0.2 ? 600 + Math.floor(dayR() * 600) : 90 + Math.floor(dayR() * 270);
      const s2 = segment(h, to, s1.arriveAbs + conn, c, dayR);
      push([s1, s2], 0.92 * (1 + (detour - 1) * 0.5) - (conn > 600 ? 0.08 : 0));
    }
    if (q.maxStops >= 2 && hubs.length >= 2) {
      const [x, y] = [hubs[0], hubs[hubs.length - 1]];
      if (x.h !== y.h && dayR() < 0.6) {
        const s1 = segment(from, x.h, dayStartAbs + 420 + Math.floor(dayR() * 600), x.c, dayR);
        const s2 = segment(x.h, y.h, s1.arriveAbs + 120 + Math.floor(dayR() * 200), y.c, dayR);
        const s3 = segment(y.h, to, s2.arriveAbs + 100 + Math.floor(dayR() * 300), y.c, dayR);
        push([s1, s2, s3], 0.84);
      }
    }
  }
  return fares;
}

export const demoProvider: FlightProvider = {
  id: "demo",
  name: "Demo data",
  capabilities: { multiAirport: true, dateRange: true, returnFares: false },
  concurrency: 4,
  minDelayMs: 0,
  configured: () => true,
  note: "Synthetic prices for trying the app. Not real fares.",
  async search(q) {
    const out: Fare[] = [];
    for (const date of eachDay(q.departFrom, q.departTo)) {
      for (const f of q.from) for (const t of q.to) out.push(...demoFares(f, t, date, q));
    }
    return out;
  },
};

