/**
 * Daily check of the chosen Pakistan-trip plans (Manchester, leaving 14–16 Dec,
 * back from Pakistan 30 Dec), priced from the fare cache, plus any other
 * routing that is under £700, or under £800 with an outbound journey no longer
 * than plan 4's. Nothing here fetches prices; run the searches first.
 *
 *   DB_PATH=... npx tsx scripts/trip-plans.ts
 */
import { AIRPORTS, airport, type Fare } from "@flightbuzz/core";
import { db, kvGet, kvSet } from "../src/db.ts";
import { DEFAULT_BEST, findBest } from "../src/best.ts";

const HOTEL = 20;
const MAX_AGE_H = 96;
/** Hours ahead of UTC in December (no daylight saving), by country. */
const TZ: Record<string, number> = { GB: 0, IE: 0, PT: 0, ES: 1, FR: 1, IT: 1, DE: 1, NL: 1, BE: 1, CH: 1, AT: 1, PL: 1, CZ: 1, HU: 1, GR: 2, BG: 2, RO: 2, CY: 2, TR: 3, QA: 3, KW: 3, BH: 3, SA: 3, AE: 4, OM: 4, PK: 5, UZ: 5 };
const utcMin = (local: string, iata: string) => Date.parse(`${local}:00Z`) / 60000 - (TZ[airport(iata)?.country ?? ""] ?? 0) * 60;
const hours = (fromAp: string, leave: string, toAp: string, arrive: string) => (utcMin(arrive, toAp) - utcMin(leave, fromAp)) / 60;
const fmtH = (h: number) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

type Row = { f: Fare; at: number };
const rows: Row[] = [];
for (const r of db.prepare("SELECT fetched_at, fares FROM fare_cache WHERE fetched_at > ?").all(Date.now() - MAX_AGE_H * 3600e3) as { fetched_at: number; fares: string }[]) {
  for (const f of JSON.parse(r.fares) as Fare[]) rows.push({ f, at: r.fetched_at });
}
const latest = (pred: (f: Fare) => boolean) => rows.filter((x) => pred(x.f)).sort((a, b) => b.at - a.at)[0];
const age = (at: number) => `${Math.round((Date.now() - at) / 3600e3)}h old`;

interface Leg { label: string; gbp?: number; note?: string }
function flight(from: string, to: string, date: string, time: string): Leg {
  const hit = latest((f) => !f.openReturn && f.slices.length === 1 && f.slices[0].segments.length === 1 && f.slices[0].from === from && f.slices[0].to === to && f.slices[0].departLocal === `${date}T${time}`);
  const s = hit?.f.slices[0];
  if (hit && s) return { label: `${date.slice(8)}/${date.slice(5, 7)} ${time} ${from}→${to} (arr ${s.arriveLocal.slice(11, 16)}, ${fmtH(hours(from, s.departLocal, to, s.arriveLocal))}) ${s.segments[0].carrierName ?? s.segments[0].carrier}`, gbp: Math.round(hit.f.price), note: age(hit.at) };
  // Schedule changed or not searched recently: show the cheapest that day instead.
  const alt = rows.filter((x) => !x.f.openReturn && x.f.slices[0].segments.length === 1 && x.f.slices[0].from === from && x.f.slices[0].to === to && x.f.slices[0].departLocal.startsWith(date)).sort((a, b) => a.f.price - b.f.price)[0];
  return { label: `${date.slice(8)}/${date.slice(5, 7)} ${time} ${from}→${to}`, note: alt ? `NOT FOUND in recent prices; cheapest that day ${alt.f.slices[0].departLocal.slice(11, 16)} £${Math.round(alt.f.price)}` : "NOT FOUND in recent prices" };
}
function flydubai(from: string, to: string, date: string, time: string, back: string): Leg & { arrive?: string } {
  const hit = latest((f) => !!f.openReturn && f.openReturn.date === back && f.slices[0].segments[0].from === from && f.slices[0].to === to && f.slices[0].departLocal === `${date}T${time}`);
  if (!hit) return { label: `${date.slice(8)}/${date.slice(5, 7)} ${time} flydubai ${from}→${to} back ${back}`, note: "NOT FOUND in recent prices" };
  const s = hit.f.slices[0];
  const legs = s.segments.map((g) => `${g.from} ${g.departLocal.slice(11, 16)}→${g.to} ${g.arriveLocal.slice(5, 16).replace("T", " ")}`).join(", ");
  return { label: `${date.slice(8)}/${date.slice(5, 7)} flydubai ${legs}, return ticket back ${back}`, gbp: Math.round(hit.f.price), note: age(hit.at), arrive: s.arriveLocal };
}
const fixed = (label: string, gbp: number): Leg => ({ label, gbp });

interface Plan { n: number; name: string; legs: Leg[]; leave: [string, string]; arrive?: [string, string] }
const fzP1 = flydubai("BGY", "MUX", "2026-12-15", "12:35", "2026-12-30");
const fzNap = flydubai("NAP", "MUX", "2026-12-16", "12:15", "2026-12-30");
const fzP4 = flydubai("BGY", "MUX", "2026-12-15", "23:00", "2026-12-30");
const plans: Plan[] = [
  { n: 1, name: "Bergamo, leave Mon 14 Dec 21:35", leave: ["MAN", "2026-12-14T21:35"], arrive: fzP1.arrive ? ["MUX", fzP1.arrive] : undefined, legs: [flight("MAN", "BGY", "2026-12-14", "21:35"), fixed("hotel near Bergamo airport", HOTEL), fzP1, fixed("hotel near Bergamo airport (lands 30 Dec 22:00)", HOTEL), flight("BGY", "MAN", "2026-12-31", "08:00")] },
  { n: 2, name: "Naples via Malpensa, leave Tue 15 Dec 19:10", leave: ["MAN", "2026-12-15T19:10"], arrive: fzNap.arrive ? ["MUX", fzNap.arrive] : undefined, legs: [flight("MAN", "MXP", "2026-12-15", "19:10"), fixed("hotel near Malpensa", HOTEL), flight("MXP", "NAP", "2026-12-16", "07:50"), fzNap, flight("NAP", "MAN", "2026-12-31", "20:05")] },
  { n: 3, name: "Naples via Rome Ciampino, leave Tue 15 Dec 14:15", leave: ["MAN", "2026-12-15T14:15"], arrive: fzNap.arrive ? ["MUX", fzNap.arrive] : undefined, legs: [flight("MAN", "CIA", "2026-12-15", "14:15"), fixed("bus + train Ciampino → Naples (estimate)", 35), fixed("hotel in Naples", HOTEL), fzNap, flight("NAP", "MAN", "2026-12-31", "20:05")] },
  { n: 4, name: "Bergamo 23:00 via Linate, leave Tue 15 Dec 12:55", leave: ["MAN", "2026-12-15T12:55"], arrive: fzP4.arrive ? ["MUX", fzP4.arrive] : undefined, legs: [flight("MAN", "LIN", "2026-12-15", "12:55"), fixed("bus Linate → Bergamo", 9), fzP4, fixed("hotel near Bergamo airport (lands 30 Dec 22:00)", HOTEL), flight("BGY", "MAN", "2026-12-31", "08:00")] },
];

const prev = kvGet<Record<string, number>>("trip:plans") ?? {};
const now: Record<string, number> = {};
let plan4Hours = 22.5;
for (const p of plans) {
  const missing = p.legs.filter((l) => l.gbp === undefined);
  const total = p.legs.reduce((n, l) => n + (l.gbp ?? 0), 0);
  const h = p.arrive ? hours(p.leave[0], p.leave[1], p.arrive[0], p.arrive[1]) : undefined;
  if (p.n === 4 && h) plan4Hours = h;
  const was = prev[p.n];
  const change = missing.length ? "" : was === undefined ? "" : total === was ? " (no change)" : ` (${total > was ? "+" : "−"}£${Math.abs(total - was)} since last check)`;
  console.log(`\nPlan ${p.n}: ${p.name} — ${missing.length ? `£${total} + ${missing.length} unpriced leg(s)` : `£${total}`}${change}${h ? `; Manchester → Multan ${fmtH(h)}` : ""}`);
  for (const l of p.legs) console.log(`   ${l.gbp === undefined ? "   ?" : `£${String(l.gbp).padStart(4)}`}  ${l.label}${l.note ? `  [${l.note}]` : ""}`);
  if (!missing.length) now[p.n] = total;
}
kvSet("trip:plans", { ...prev, ...now });

// Other routings from Manchester (any hub), £20 hotel nights.
const train: Record<string, number> = { MAN: 0 };
for (const a of AIRPORTS) if (a.country === "GB" && a.iata !== "MAN") train[a.iata] = 99999;
const others = findBest({ ...DEFAULT_BEST, home: ["MAN"], hotel: { "*": HOTEL }, trainFromHome: train, leaveFrom: "2026-12-14T00:00" }, 300)
  .filter((r) => r.total < 5000 && r.outbound)
  .map((r) => ({ r, h: hours(r.outbound!.from, r.outbound!.leaveLocal, r.outbound!.to, r.outbound!.arriveLocal) }))
  .filter(({ r }) => r.outbound!.leaveLocal >= "2026-12-14" && r.outbound!.leaveLocal < "2026-12-17")
  // Not just plans 1–3 again with a different way to the airport (variants of plan 4, the
  // Bergamo 23:00 flight, are wanted).
  .filter(({ r }) => !r.costs.some((c) => /^(15\/12 12:35 BGY|16\/12 12:15 NAP)-/.test(c.label)))
  .filter(({ r, h }) => r.total < 700 || (r.total < 800 && h <= plan4Hours + 0.01));
console.log(`\nOther routings from Manchester leaving 14–16 Dec: under £700, or under £800 with Manchester → Pakistan ≤ ${fmtH(plan4Hours)} (plan 4): ${others.length}`);
for (const { r, h } of others.slice(0, 8)) {
  console.log(`\n £${r.total} ${r.kind} ${r.hub}; ${r.outbound!.from} ${r.outbound!.leaveLocal.replace("T", " ")} → ${r.outbound!.to} ${r.outbound!.arriveLocal.replace("T", " ")} (${fmtH(h)})`);
  for (const c of r.costs) console.log(`   £${String(c.gbp).padStart(4)}  ${c.label}`);
  for (const n of r.notes) console.log(`   ! ${n}`);
}
