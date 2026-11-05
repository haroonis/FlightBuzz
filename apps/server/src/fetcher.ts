import { legKey, splitForProvider, type Fare, type SearchPlan } from "@flightbuzz/core";
import { config } from "./config.ts";
import { cacheGet, cachePut } from "./db.ts";
import type { FlightProvider } from "./providers/types.ts";

export interface FetchStats {
  requests: number;
  cachedRequests: number;
  skippedRequests: number;
  fares: number;
  errors: string[];
}

export interface FetchOptions {
  budget?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

interface Task {
  provider: FlightProvider;
  cacheKey: string;
  query: ReturnType<typeof splitForProvider>[number];
  legKeys: Set<string>;
}

/**
 * Run tasks with a concurrency cap. Each worker rests `minDelayMs` plus up to
 * 75% random jitter after every request, so requests never come in bursts.
 * Items for which `skip` returns true are passed over without a request or a pause.
 */
async function pool<T>(
  items: T[],
  concurrency: number,
  minDelayMs: number,
  fn: (item: T) => Promise<void>,
  skip: (item: T) => boolean,
  signal?: AbortSignal,
) {
  let next = 0;
  const worker = async () => {
    let first = true;
    while (next < items.length && !signal?.aborted) {
      const item = items[next++];
      if (skip(item)) continue;
      if (!first && minDelayMs) await new Promise((r) => setTimeout(r, minDelayMs * (1 + Math.random() * 0.75)));
      first = false;
      if (skip(item)) continue; // provider may have paused while we rested
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/**
 * Fetch every leg in a plan from every provider. Answers are cached so that
 * overlapping saved searches share requests; live requests stop at the budget.
 */
export async function fetchPlan(plan: SearchPlan, providers: FlightProvider[], opts: FetchOptions = {}) {
  const budget = opts.budget ?? config.requestBudget;
  const faresByLeg: Record<string, Fare[]> = Object.fromEntries(Object.keys(plan.legs).map((k) => [k, []]));
  const stats: FetchStats = { requests: 0, cachedRequests: 0, skippedRequests: 0, fares: 0, errors: [] };

  // Direct legs first, then stopover legs, so a tight budget still covers the basics.
  const order = new Map<string, number>();
  plan.routes.forEach((r, i) => r.legKeys.forEach((k) => order.set(k, Math.min(order.get(k) ?? Infinity, r.id.endsWith("direct") ? 0 : i + 1))));
  if (plan.returnLegKey) order.set(plan.returnLegKey, 0.5);
  const legKeys = Object.keys(plan.legs).sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));

  const tasks = new Map<string, Task>();
  for (const key of legKeys) {
    for (const provider of providers) {
      for (const query of splitForProvider(plan.legs[key], provider.capabilities)) {
        const cacheKey = `${provider.id}|${legKey(query)}`;
        const t = tasks.get(cacheKey) ?? { provider, cacheKey, query, legKeys: new Set<string>() };
        t.legKeys.add(key);
        tasks.set(cacheKey, t);
      }
    }
  }

  const total = tasks.size;
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);
  const deliver = (t: Task, fares: Fare[]) => {
    for (const k of t.legKeys) faresByLeg[k].push(...fares);
    stats.fares += fares.length;
  };

  const live = new Map<FlightProvider, Task[]>();
  let liveCount = 0;
  for (const t of tasks.values()) {
    const cached = cacheGet(t.cacheKey, config.cacheTtlMinutes);
    if (cached) {
      stats.cachedRequests++;
      deliver(t, cached);
      tick();
    } else if (liveCount < budget) {
      liveCount++;
      (live.get(t.provider) ?? live.set(t.provider, []).get(t.provider)!).push(t);
    } else {
      stats.skippedRequests++;
      tick();
    }
  }
  opts.onProgress?.(done, total);

  await Promise.all(
    [...live.entries()].map(([provider, list]) =>
      pool(
        list,
        provider.concurrency,
        provider.minDelayMs,
        async (t) => {
          try {
            stats.requests++;
            provider.onRequest?.();
            const fares = await provider.search(t.query, { signal: opts.signal });
            cachePut(t.cacheKey, fares);
            deliver(t, fares);
          } catch (e) {
            if (stats.errors.length < 25) stats.errors.push(`${provider.name} ${t.query.from.join(",")}→${t.query.to.join(",")} ${t.query.departFrom}: ${(e as Error).message}`);
          } finally {
            tick();
          }
        },
        () => {
          const reason = provider.unavailable?.();
          if (!reason) return false;
          stats.skippedRequests++;
          const note = `${provider.name}: ${reason}`;
          if (!stats.errors.includes(note)) stats.errors.push(note);
          tick();
          return true;
        },
        opts.signal,
      ),
    ),
  );
  return { faresByLeg, stats };
}
