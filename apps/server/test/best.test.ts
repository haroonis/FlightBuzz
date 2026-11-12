import { describe, expect, it } from "vitest";
import type { Fare } from "@flightbuzz/core";

process.env.DB_PATH = ":memory:";

const seg = (from: string, to: string, dep: string, arr: string, carrier = "XX") => ({ from, to, departLocal: dep, arriveLocal: arr, durationMin: 120, carrier, carrierName: carrier });
const fare = (id: string, price: number, segs: ReturnType<typeof seg>[], openReturn?: string): Fare => ({
  id, provider: "google", price, currency: "GBP", fetchedAt: "",
  slices: [{ from: segs[0].from, to: segs[segs.length - 1].to, departLocal: segs[0].departLocal, arriveLocal: segs[segs.length - 1].arriveLocal, durationMin: 600, segments: segs }],
  ...(openReturn ? { openReturn: { date: openReturn, from: ["LYP"], to: ["BGY"] } } : {}),
});

describe("findBest", () => {
  it("prices a European routing door to door, with transfer, hotel and landing time", async () => {
    const { cachePut } = await import("../src/db.ts");
    const { findBest, DEFAULT_BEST } = await import("../src/best.ts");
    cachePut("a", [fare("lh", 516, [seg("BGY", "DXB", "2026-12-16T12:35", "2026-12-16T22:25", "flydubai"), seg("DXB", "LYP", "2026-12-17T12:20", "2026-12-17T16:10", "flydubai")], "2026-12-31")]);
    cachePut("b", [fare("out", 29, [seg("MAN", "MXP", "2026-12-15T19:10", "2026-12-15T22:20", "easyJet")])]);
    cachePut("c", [fare("back", 47, [seg("LYP", "DXB", "2026-12-31T17:10", "2026-12-31T19:45", "flydubai"), seg("DXB", "BGY", "2027-01-01T07:45", "2027-01-01T11:35", "flydubai")])]);
    cachePut("d", [fare("home", 47, [seg("BGY", "LPL", "2027-01-01T17:40", "2027-01-01T18:55", "Ryanair")])]);
    cachePut("e", [fare("early", 10, [seg("BGY", "MAN", "2027-01-01T12:00", "2027-01-01T13:15", "Ryanair")])]); // too soon after landing
    const best = findBest(DEFAULT_BEST, 5);
    expect(best).toHaveLength(1);
    const r = best[0];
    expect(r.kind).toBe("via Europe");
    expect(r.costs.map((c) => c.gbp)).toEqual([29, 17, 50, 516, 47, 12]);
    expect(r.total).toBe(29 + 17 + 50 + 516 + 47 + 12);
    expect(r.costs[3].label).toContain("lands BGY 01/01 11:35");
    expect(r.notes).toEqual([]);
  });
});
