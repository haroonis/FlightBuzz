/**
 * searches.csv: the human-editable list of search plans (see
 * packages/core/src/searchFile.ts for the columns). Lines marked track=yes
 * become saved searches that refresh twice a day; any line can be run on
 * demand by id or group.
 */
import { existsSync, readFileSync, watchFile } from "node:fs";
import {
  expandPlaces,
  parseSearchFile,
  planSearch,
  selectPlans,
  specToPath,
  splitForProvider,
  withNearby,
  type PlanLine,
  type SearchFileProblem,
  type SearchResult,
} from "@flightbuzz/core";
import { config } from "./config.ts";
import { createSaved, listSaved, recordRun, updateSaved } from "./db.ts";
import { googleProvider } from "./providers/google.ts";
import { registry, runSearch } from "./search.ts";
import { runSweep } from "./sweep.ts";

export const PLAN_PREFIX = "[plan] ";

export function loadPlans(): { plans: PlanLine[]; problems: SearchFileProblem[] } {
  if (!existsSync(config.searchesFile)) return { plans: [], problems: [] };
  return parseSearchFile(readFileSync(config.searchesFile, "utf8"));
}

/** Rough number of Google pages a plan needs (sweeps: scan + full search of the top N). */
export function estimatePages(p: PlanLine): number {
  const caps = googleProvider.capabilities;
  const pages = (spec: PlanLine["spec"]) => Object.values(planSearch(spec, registry()).legs).reduce((n, q) => n + splitForProvider(q, caps).length, 0);
  if (p.kind !== "sweep") return pages(p.spec);
  const r = p.spec.return;
  const scan = pages({
    ...p.spec,
    depart: { from: p.spec.depart.from, to: p.spec.depart.from },
    return: r.type === "dates" ? { type: "dates", range: { from: r.range.from, to: r.range.from } } : r,
    returnTicketsOnly: r.type !== "oneway",
    stopovers: [],
  });
  const origins = withNearby(expandPlaces(p.spec.origins, registry()), p.spec.nearbyKm ?? 0);
  const full = pages({ ...p.spec, origins: origins.slice(0, Math.min(p.top, origins.length)), nearbyKm: 0 });
  return scan + full;
}

/** Make track=yes lines into saved searches, and pause saved searches whose line was removed or untracked. */
export function syncTrackedPlans(): void {
  const { plans, problems } = loadPlans();
  for (const p of problems) console.warn(`[plans] ${config.searchesFile} line ${p.line}${p.id ? ` (${p.id})` : ""}: ${p.message}`);
  const saved = listSaved().filter((s) => s.name.startsWith(PLAN_PREFIX));
  const tracked = plans.filter((p) => p.enabled && p.track && p.kind === "search");
  for (const p of plans) if (p.track && p.kind === "sweep") console.warn(`[plans] ${p.id}: sweeps can't be tracked; run them with npm run searches -- run ${p.id}`);
  for (const p of tracked) {
    const name = PLAN_PREFIX + p.id;
    const existing = saved.find((s) => s.name === name);
    if (!existing) createSaved(name, p.spec, true);
    else if (specToPath(existing.spec) !== specToPath(p.spec) || !existing.active) updateSaved(existing.id, { spec: p.spec, active: true });
  }
  for (const s of saved) if (s.active && !tracked.some((p) => PLAN_PREFIX + p.id === s.name)) updateSaved(s.id, { active: false });
}

/** Re-sync whenever the file is saved. */
export function watchPlans(): void {
  syncTrackedPlans();
  watchFile(config.searchesFile, { interval: 5000 }, () => {
    console.log(`[plans] ${config.searchesFile} changed; updating tracked searches`);
    try {
      syncTrackedPlans();
    } catch (e) {
      console.warn(`[plans] ${(e as Error).message}`);
    }
  });
}

/** Run plans one after another by id, group or "all". */
export async function runPlans(
  selectors: string[],
  onEvent: (msg: string) => void = console.log,
): Promise<{ plan: PlanLine; result?: SearchResult; error?: string }[]> {
  const { plans, problems } = loadPlans();
  for (const p of problems) onEvent(`! line ${p.line}${p.id ? ` (${p.id})` : ""}: ${p.message}`);
  const chosen = selectPlans(plans, selectors);
  if (!chosen.length) onEvent(`No plans match ${selectors.join(" ")}`);
  const out: { plan: PlanLine; result?: SearchResult; error?: string }[] = [];
  for (const plan of chosen) {
    onEvent(`▶ ${plan.id} (${plan.kind}, ~${estimatePages(plan)} pages): ${plan.text}`);
    try {
      const result = plan.kind === "sweep" ? await runSweep(plan.spec, plan.top) : await runSearch(plan.spec);
      if (plan.track) {
        const s = listSaved().find((x) => x.name === PLAN_PREFIX + plan.id);
        if (s) recordRun(s.id, result);
      }
      onEvent(`✓ ${plan.id}: ${result.trips.length} options, cheapest ${result.summary.cheapest ?? "—"} ${result.summary.currency}; ${result.stats.requests} pages fetched, ${result.stats.cachedRequests} from cache${result.stats.errors.length ? `; ${result.stats.errors[0]}` : ""}`);
      out.push({ plan, result });
    } catch (e) {
      onEvent(`✗ ${plan.id}: ${(e as Error).message}`);
      out.push({ plan, error: (e as Error).message });
    }
  }
  return out;
}
