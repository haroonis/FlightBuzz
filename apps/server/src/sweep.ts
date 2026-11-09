import { GroupRegistry, expandPlaces, withNearby, type SearchResult, type SearchSpec } from "@flightbuzz/core";
import type { FetchOptions } from "./fetcher.ts";
import { registry, runSearch } from "./search.ts";

/**
 * Wide search in two steps, so a whole region (e.g. every airport in Europe)
 * stays affordable:
 *   1. scan: every starting airport, one date pair, return tickets only
 *   2. full search (all dates and options) from the `top` cheapest airports
 * Connections can be anywhere; the scan uses the search's own stop limit.
 */
export async function runSweep(spec: SearchSpec, top: number, opts: FetchOptions = {}): Promise<SearchResult> {
  const r = spec.return;
  const scanSpec: SearchSpec = {
    ...spec,
    depart: { from: spec.depart.from, to: spec.depart.from },
    return: r.type === "dates" ? { type: "dates", range: { from: r.range.from, to: r.range.from } } : r.type === "nights" ? { type: "nights", min: r.min, max: r.min } : r,
    returnTicketsOnly: r.type !== "oneway" ? true : spec.returnTicketsOnly,
    stopovers: [],
  };
  const reg: GroupRegistry = registry();
  const scanned = withNearby(expandPlaces(spec.origins, reg), spec.nearbyKm ?? 0);
  // Progress: the scan is the first half, the full search the second.
  const half = (offset: number) => (done: number, total: number) => opts.onProgress?.(offset + done, total * 2);
  const scan = await runSearch(scanSpec, { ...opts, onProgress: half(0), tripLimit: 100_000 });
  const best = new Map<string, number>();
  for (const t of scan.trips) if (!best.has(t.out.from) || t.price < best.get(t.out.from)!) best.set(t.out.from, t.price);
  const ranking = [...best.entries()].map(([airport, price]) => ({ airport, price })).sort((a, b) => a.price - b.price);
  const chosen = ranking.slice(0, top).map((x) => x.airport);
  if (!chosen.length) return { ...scan, sweep: { scannedAirports: scanned.length, ranking, top } };
  const full = await runSearch({ ...spec, origins: chosen, nearbyKm: 0 }, { ...opts, onProgress: (done, total) => opts.onProgress?.(total + done, total * 2) });
  return { ...full, sweep: { scannedAirports: scanned.length, ranking, top } };
}
