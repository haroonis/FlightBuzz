import { describe, expect, it } from "vitest";
import { buildTrips, defaultSpec, planSearch, splitForProvider, type Fare, type SearchSpec } from "../src/index.ts";

let n = 0;
function fare(legs: [string, string, string, string][], price: number, provider = "test"): Fare {
  const segments = legs.map(([from, to, dep, arr]) => ({ from, to, departLocal: dep, arriveLocal: arr, durationMin: 300, carrier: "XX" }));
  return {
    id: `f${n++}`,
    provider,
    price,
    currency: "GBP",
    fetchedAt: "",
    slices: [{ from: legs[0][0], to: legs[legs.length - 1][1], departLocal: legs[0][2], arriveLocal: legs[legs.length - 1][3], durationMin: 300 * legs.length, segments }],
  };
}

function spec(over: Partial<SearchSpec>): SearchSpec {
  return { ...defaultSpec(), origins: ["MAN"], destinations: ["LHE"], depart: { from: "2026-12-01", to: "2026-12-01" }, return: { type: "oneway" }, ...over };
}

/** Put fares on the plan's legs by matching airports. */
function feed(s: SearchSpec, fares: Fare[]) {
  const plan = planSearch(s);
  const byLeg: Record<string, Fare[]> = {};
  for (const [k, q] of Object.entries(plan.legs)) {
    byLeg[k] = fares.filter((f) => f.slices.length === 1 && q.from.includes(f.slices[0].from) && q.to.includes(f.slices[0].to) && !q.returnFrom);
  }
  return { plan, byLeg, trips: buildTrips(s, plan, byLeg) };
}

describe("engine", () => {
  it("plans direct and stopover legs with shifted windows", () => {
    const s = spec({ stopovers: [{ direction: "out", stops: [{ places: ["@uae"], minNights: 1, maxNights: 2 }] }] });
    const plan = planSearch(s);
    const via = plan.routes.find((r) => r.id === "out:via0")!;
    expect(via.points[1]).toEqual(["AUH", "DWC", "DXB", "SHJ"]);
    const second = plan.legs[via.legKeys[1]];
    expect([second.departFrom, second.departTo]).toEqual(["2026-12-02", "2026-12-04"]);
    expect(second.maxStops).toBe(1);
  });

  it("builds a stopover with a ground transfer between UAE airports", () => {
    const s = spec({ stopovers: [{ direction: "out", stops: [{ places: ["@uae"], minNights: 1, maxNights: 2 }] }] });
    const { trips } = feed(s, [
      fare([["MAN", "AUH", "2026-12-01T09:00", "2026-12-01T20:00"]], 200),
      fare([["DXB", "LHE", "2026-12-03T09:00", "2026-12-03T13:00"]], 80),
      fare([["MAN", "DOH", "2026-12-01T09:00", "2026-12-01T19:00"], ["DOH", "LHE", "2026-12-01T21:00", "2026-12-02T03:00"]], 400),
    ]);
    const stop = trips.find((t) => t.tags.includes("stopover"))!;
    expect(stop).toBeDefined();
    expect(stop.tags).toContain("airport-change");
    expect(stop.out.stopoverNights).toBe(2);
    const ground = stop.out.steps.find((x) => x.type === "ground");
    expect(ground && ground.type === "ground" && ground.transfer.mode).toBe("bus");
    // 200 + 80 + AED 40 bus in GBP
    expect(stop.price).toBeGreaterThan(280);
    expect(stop.price).toBeLessThan(300);
    expect(trips[0].id).toBe(stop.id); // cheapest first
    expect(trips.some((t) => t.out.stops === 1 && !t.tags.includes("stopover"))).toBe(true);
  });

  it("enforces minimum self-transfer time and max layover", () => {
    const s = spec({ stopovers: [{ direction: "out", stops: [{ places: ["IST"], minNights: 0, maxNights: 0 }] }] });
    const tooTight = feed(s, [
      fare([["MAN", "IST", "2026-12-01T06:00", "2026-12-01T12:00"]], 50),
      fare([["IST", "LHE", "2026-12-01T14:00", "2026-12-01T23:00"]], 100),
    ]).trips;
    expect(tooTight).toHaveLength(0);
    const ok = feed(s, [
      fare([["MAN", "IST", "2026-12-01T06:00", "2026-12-01T12:00"]], 50),
      fare([["IST", "LHE", "2026-12-01T16:00", "2026-12-02T01:00"]], 100),
      fare([["IST", "LHE", "2026-12-03T16:00", "2026-12-04T01:00"]], 10), // 52h later: over 24h layover
    ]).trips;
    expect(ok).toHaveLength(1);
    expect(ok[0].tags).toContain("self-transfer");
    expect(ok[0].price).toBe(150);
  });

  it("pairs return journeys within the nights range and flags open-jaw", () => {
    const s = spec({ destinations: ["@vienna-bratislava"], return: { type: "nights", min: 3, max: 4 } });
    const { trips } = feed(s, [
      fare([["MAN", "BTS", "2026-12-01T06:00", "2026-12-01T09:00"]], 30),
      fare([["VIE", "MAN", "2026-12-05T10:00", "2026-12-05T12:00"]], 40),
      fare([["VIE", "MAN", "2026-12-09T10:00", "2026-12-09T12:00"]], 5), // 8 nights: excluded
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0].price).toBe(70);
    expect(trips[0].tags).toContain("open-jaw");
  });

  it("splits queries to provider capabilities", () => {
    const q = planSearch(spec({ origins: ["@north-england"], destinations: ["@punjab-pk"], depart: { from: "2026-12-01", to: "2026-12-10" } })).legs;
    const direct = Object.values(q)[0];
    expect(splitForProvider(direct, { multiAirport: false, dateRange: false, returnFares: false })).toHaveLength(3 * 4 * 10);
    expect(splitForProvider(direct, { multiAirport: true, dateRange: false, returnFares: false })).toHaveLength(10);
    expect(splitForProvider(direct, { multiAirport: true, dateRange: true, returnFares: true })).toHaveLength(1);
  });
});
