import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegQuery } from "@flightbuzz/core";

process.env.KIWI_TEQUILA_KEY = "test";
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
  it("maps return itineraries into two slices", async () => {
    const { kiwiProvider } = await import("../src/providers/kiwi.ts");
    const r = (flyFrom: string, flyTo: string, ld: string, la: string, ud: string, ua: string, ret: 0 | 1) =>
      ({ flyFrom, flyTo, local_departure: ld, local_arrival: la, utc_departure: ud, utc_arrival: ua, airline: "W6", flight_no: 123, return: ret });
    const fetchFn = stubFetch({ data: [{
      id: "abc", price: 99, deep_link: "https://kiwi.com/deep",
      route: [
        r("BTS", "AUH", "2026-12-01T10:00:00.000Z", "2026-12-01T18:30:00.000Z", "2026-12-01T09:00:00.000Z", "2026-12-01T14:30:00.000Z", 0),
        r("DXB", "VIE", "2026-12-08T09:00:00.000Z", "2026-12-08T13:00:00.000Z", "2026-12-08T05:00:00.000Z", "2026-12-08T12:00:00.000Z", 1),
      ],
    }] });
    const fares = await kiwiProvider.search({ ...q, from: ["VIE", "BTS"], to: ["AUH", "DXB"], departTo: "2026-12-03", returnFrom: "2026-12-08", returnTo: "2026-12-10" }, {});
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.searchParams.get("date_to")).toBe("03/12/2026");
    expect(url.searchParams.get("flight_type")).toBe("round");
    expect(fares[0].slices).toHaveLength(2);
    expect(fares[0].slices[0]).toMatchObject({ from: "BTS", to: "AUH", departLocal: "2026-12-01T10:00", durationMin: 330 });
    expect(fares[0].slices[1].from).toBe("DXB");
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
