import type { Fare, LegQuery, ProviderCapabilities } from "@flightbuzz/core";

export interface ProviderContext {
  signal?: AbortSignal;
}

export interface FlightProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
  /** Concurrent requests allowed. */
  concurrency: number;
  /** Pause after each request, in ms (plus random jitter). */
  minDelayMs: number;
  /** Has what it needs to run (keys, optional packages). */
  configured(): Promise<boolean> | boolean;
  note: string;
  /** If set and returns a reason, remaining requests are skipped (e.g. cooling down after a block). */
  unavailable?(): string | undefined;
  /** Called just before each live request (for daily counters). */
  onRequest?(): void;
  /** Answer one query already split to this provider's capabilities. */
  search(q: LegQuery, ctx: ProviderContext): Promise<Fare[]>;
}

/** Build a slice duration from segment times when the provider gives none. */
export function sliceDuration(segs: { durationMin: number; departLocal: string; arriveLocal: string }[], localMinutes: (t: string) => number): number {
  let total = 0;
  for (let i = 0; i < segs.length; i++) {
    total += segs[i].durationMin;
    if (i > 0) total += Math.max(0, localMinutes(segs[i].departLocal) - localMinutes(segs[i - 1].arriveLocal));
  }
  return total;
}
