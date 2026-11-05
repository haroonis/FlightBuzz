import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegQuery } from "@flightbuzz/core";

process.env.SERPAPI_KEY = "test";
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

describe("serpapi", () => {
  it("maps Google Flights options to fares", async () => {
    const { serpApiProvider } = await import("../src/providers/serpapi.ts");
    const fetchFn = stubFetch({
      search_metadata: { google_flights_url: "https://www.google.com/travel/flights?x" },
      best_flights: [{
        price: 512, total_duration: 690,
        flights: [
          { departure_airport: { id: "MAN", name: "Manchester", time: "2026-12-01 08:40" }, arrival_airport: { id: "DXB", name: "Dubai", time: "2026-12-01 19:35" }, duration: 415, airline: "Emirates", flight_number: "EK 18" },
          { departure_airport: { id: "DXB", name: "Dubai", time: "2026-12-01 22:00" }, arrival_airport: { id: "LHE", name: "Lahore", time: "2026-12-02 02:10" }, duration: 190, airline: "Emirates", flight_number: "EK 624" },
        ],
      }],
    });
    const fares = await serpApiProvider.search(q, {});
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.searchParams.get("departure_id")).toBe("MAN,LPL");
    expect(url.searchParams.get("stops")).toBe("2");
    expect(fares).toHaveLength(1);
    expect(fares[0].price).toBe(512);
    expect(fares[0].slices[0]).toMatchObject({ from: "MAN", to: "LHE", departLocal: "2026-12-01T08:40", arriveLocal: "2026-12-02T02:10", durationMin: 690 });
    expect(fares[0].slices[0].segments[1].flightNo).toBe("EK624");
  });
});

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
