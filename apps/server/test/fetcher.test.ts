import { describe, expect, it } from "vitest";
import { defaultSpec, planSearch } from "@flightbuzz/core";

process.env.DB_PATH = ":memory:";

describe("fetchPlan", () => {
  it("stops asking a provider once it reports a block", async () => {
    const { fetchPlan } = await import("../src/fetcher.ts");
    let calls = 0;
    let blocked = false;
    const provider = {
      id: "fake", name: "Fake", note: "", concurrency: 1, minDelayMs: 0,
      capabilities: { multiAirport: false, dateRange: false, returnFares: false },
      configured: () => true,
      unavailable: () => (blocked ? "paused" : undefined),
      async search() {
        calls++;
        if (calls === 3) { blocked = true; throw Object.assign(new Error("Too many"), { status: 429 }); }
        return [];
      },
    };
    const spec = { ...defaultSpec(), origins: ["MAN"], destinations: ["LHE"], depart: { from: "2026-12-01", to: "2026-12-10" }, return: { type: "oneway" as const } };
    const { stats } = await fetchPlan(planSearch(spec), [provider]);
    expect(calls).toBe(3);
    expect(stats.requests).toBe(3);
    expect(stats.skippedRequests).toBe(7);
    expect(stats.errors.some((e) => e.includes("paused"))).toBe(true);
  });
});

describe("shared pacing", () => {
  it("keeps the pause between requests even when two searches run at once", async () => {
    const { fetchPlan } = await import("../src/fetcher.ts");
    const starts: number[] = [];
    const ends: number[] = [];
    const provider = {
      id: "paced", name: "Paced", note: "", concurrency: 1, minDelayMs: 150,
      capabilities: { multiAirport: true, dateRange: false, returnFares: false },
      configured: () => true,
      async search() { starts.push(Date.now()); await new Promise((r) => setTimeout(r, 20)); ends.push(Date.now()); return []; },
    };
    const spec = (to: string) => ({ ...defaultSpec(), origins: ["MAN"], destinations: [to], depart: { from: "2026-12-01", to: "2026-12-02" }, return: { type: "oneway" as const } });
    await Promise.all([fetchPlan(planSearch(spec("LHE")), [provider]), fetchPlan(planSearch(spec("ISB")), [provider])]);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - ends[i - 1]).toBeGreaterThanOrEqual(145);
  });
});

describe("sweep", () => {
  it("scans every origin, then searches the cheapest few in full", async () => {
    process.env.PROVIDERS = "demo";
    const { runSweep } = await import("../src/sweep.ts");
    const spec = { ...defaultSpec(), origins: ["MAN", "LPL", "LBA", "BHX", "LHR"], destinations: ["IST"], depart: { from: "2026-12-16", to: "2026-12-18" }, return: { type: "oneway" as const }, providers: ["demo"] };
    const r = await runSweep(spec, 2);
    expect(r.sweep!.scannedAirports).toBe(5);
    expect(r.sweep!.ranking.length).toBeGreaterThan(1);
    const top2 = r.sweep!.ranking.slice(0, 2).map((x) => x.airport);
    expect(new Set(r.trips.map((t) => t.out.from))).toEqual(new Set(top2));
    expect(r.spec.origins.sort()).toEqual([...top2].sort());
  });
});
