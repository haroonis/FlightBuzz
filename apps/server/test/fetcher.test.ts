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
