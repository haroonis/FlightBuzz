import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegQuery } from "@flightbuzz/core";

process.env.DB_PATH = ":memory:";

const q: LegQuery = {
  from: ["MAN", "LPL"], to: ["LHE"], departFrom: "2026-12-01", departTo: "2026-12-01", maxStops: 1,
  passengers: { adults: 1, children: 0, infants: 0 }, cabin: "economy", currency: "GBP",
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("kiwi", () => {
  it("maps website-API return itineraries, marking self-transfers", async () => {
    const { kiwiProvider } = await import("../src/providers/kiwi.ts");
    const seg = (from: string, to: string, dep: string, arr: string, carrier: string, recheck = false) => ({
      layover: recheck ? { duration: 3600, isBaggageRecheck: true } : null,
      segment: { duration: 7200, code: "123", source: { localTime: dep, station: { code: from } }, destination: { localTime: arr, station: { code: to } }, carrier: { name: carrier, code: carrier } },
    });
    const fetchFn = stubFetch({ data: { returnItineraries: { __typename: "Itineraries", itineraries: [{
      __typename: "ItineraryReturn", id: "ItineraryReturn:abc", price: { amount: "1002" },
      bookingOptions: { edges: [{ node: { bookingUrl: "/en/booking/?token=x" } }] },
      outbound: { duration: 90000, sectorSegments: [seg("LPL", "WAW", "2026-12-16T08:20:00", "2026-12-16T11:40:00", "W6"), seg("WAW", "SHJ", "2026-12-16T21:35:00", "2026-12-17T06:30:00", "G9", true)] },
      inbound: { duration: 80000, sectorSegments: [seg("SHJ", "BGY", "2026-12-31T15:00:00", "2026-12-31T19:00:00", "G9")] },
    }] } } });
    const fares = await kiwiProvider.search({ ...q, from: ["LPL"], to: ["SHJ"], departTo: "2026-12-17", returnFrom: "2026-12-31", returnTo: "2027-01-03" }, {});
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(fetchFn.mock.calls[0][0]).toContain("SearchReturnItinerariesQuery");
    expect(body.variables.search.itinerary.source.ids).toEqual(["Station:airport:LPL"]);
    expect(body.variables.search.itinerary.inboundDepartureDate.end).toBe("2027-01-03T23:59:59");
    expect(body.variables.search.passengers.adultsHoldBags).toEqual([0]);
    expect(fares).toHaveLength(1);
    expect(fares[0].price).toBe(1002);
    expect(fares[0].slices).toHaveLength(2);
    expect(fares[0].slices[0].segments[1].selfTransfer).toBe(true);
    expect(fares[0].slices[0].durationMin).toBe(1500);
    expect(fares[0].deepLink).toBe("https://www.kiwi.com/en/booking/?token=x");
  });
});

describe("kiwi bags", () => {
  it("asks Kiwi to price the chosen checked bags", async () => {
    const { kiwiVariables } = await import("../src/providers/kiwi.ts");
    const v = kiwiVariables({ ...q, passengers: { adults: 2, children: 1, infants: 0 }, holdBags: 1 });
    expect(v.search.passengers.adultsHoldBags).toEqual([1, 1]);
    expect(v.search.passengers.childrenHoldBags).toEqual([1]);
  });
});

describe("demo", () => {
  it("is deterministic and respects max stops", async () => {
    const { demoFares } = await import("../src/providers/demo.ts");
    const at = new Date("2026-11-05T08:00:00Z");
    const a = demoFares("MAN", "LHE", "2026-12-01", { ...q, maxStops: 0 }, at);
    expect(demoFares("MAN", "LHE", "2026-12-01", { ...q, maxStops: 0 }, at)).toEqual(a);
    expect(a.every((f) => f.slices[0].segments.length === 1)).toBe(true);
  });
});

describe("google request", () => {
  it("sends every airport on each side in one request", async () => {
    const { googleRpcBody } = await import("../src/providers/google.ts");
    const body = decodeURIComponent(googleRpcBody({ ...q, from: ["MAN", "LPL", "LBA"], to: ["LHE", "MUX", "LYP"], maxStops: 2 }).slice("f.req=".length));
    const filters = JSON.parse(JSON.parse(body)[1]);
    const segment = filters[1][13][0];
    expect(segment[0]).toEqual([[["MAN", 0], ["LPL", 0], ["LBA", 0]]]);
    expect(segment[1]).toEqual([[["LHE", 0], ["MUX", 0], ["LYP", 0]]]);
    expect(segment[3]).toBe(3); // up to two stops
    expect(segment[6]).toBe("2026-12-01");
  });
});

describe("google round trip", () => {
  it("asks for both directions in one request", async () => {
    const { googleRpcBody } = await import("../src/providers/google.ts");
    const body = decodeURIComponent(googleRpcBody({ ...q, to: ["LHE", "MUX"], returnFrom: "2027-01-01", returnTo: "2027-01-01" }).slice("f.req=".length));
    const settings = JSON.parse(JSON.parse(body)[1])[1];
    expect(settings[2]).toBe(1); // round trip
    expect(settings[13]).toHaveLength(2);
    expect(settings[13][1][0]).toEqual([[["LHE", 0], ["MUX", 0]]]);
    expect(settings[13][1][6]).toBe("2027-01-01");
  });
});
