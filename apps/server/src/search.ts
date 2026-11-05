import {
  GroupRegistry,
  buildTrips,
  journeysForRoute,
  planSearch,
  validateSpec,
  type ResultSummary,
  type SearchResult,
  type SearchSpec,
  type StopBucket,
  type Trip,
} from "@flightbuzz/core";
import { listGroups } from "./db.ts";
import { fetchPlan, type FetchOptions } from "./fetcher.ts";
import { providersFor } from "./providers/index.ts";

export function registry(): GroupRegistry {
  return new GroupRegistry(listGroups());
}

export function stopBucket(t: Trip): StopBucket {
  const s = Math.max(t.out.stops, t.back?.stops ?? 0);
  return s >= 3 ? "3+" : (String(s) as StopBucket);
}

export function summarize(trips: Trip[], currency: string): ResultSummary {
  const min = (xs: Trip[]) => (xs.length ? Math.min(...xs.map((t) => t.price)) : null);
  const travel = (t: Trip) => t.out.travelMin + (t.back?.travelMin ?? 0);
  const best = trips.length ? trips.reduce((a, b) => (b.score < a.score ? b : a)) : undefined;
  const fastest = trips.length ? trips.reduce((a, b) => (travel(b) < travel(a) || (travel(b) === travel(a) && b.price < a.price) ? b : a)) : undefined;
  const byStops = { "0": null, "1": null, "2": null, "3+": null } as Record<StopBucket, number | null>;
  for (const b of Object.keys(byStops) as StopBucket[]) byStops[b] = min(trips.filter((t) => stopBucket(t) === b));
  return {
    tripCount: trips.length,
    cheapest: min(trips),
    best: best?.price ?? null,
    fastest: fastest?.price ?? null,
    byStops,
    stopover: min(trips.filter((t) => t.tags.includes("stopover"))),
    airportChange: min(trips.filter((t) => t.tags.includes("airport-change"))),
    currency,
  };
}

export async function runSearch(spec: SearchSpec, opts: FetchOptions = {}): Promise<SearchResult> {
  const started = Date.now();
  const reg = registry();
  const problems = validateSpec(spec, reg);
  if (problems.length) throw new Error(problems.map((p) => p.message).join("; "));
  const plan = planSearch(spec, reg);
  const providers = await providersFor(spec.providers);
  if (!providers.length) throw new Error("No flight data providers are enabled. See docs/DATA_SOURCES.md.");
  const { faresByLeg, stats } = await fetchPlan(plan, providers, opts);
  const trips = buildTrips(spec, plan, faresByLeg);
  const routes = plan.routes.map((r) => ({
    id: r.id,
    direction: r.direction,
    label: r.label,
    journeys: journeysForRoute(r, faresByLeg, spec).length,
  }));
  return {
    spec,
    trips,
    summary: summarize(trips, spec.currency),
    routes,
    stats: { ...stats, durationMs: Date.now() - started },
    finishedAt: new Date().toISOString(),
  };
}
