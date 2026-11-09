import { describe, expect, it } from "vitest";
import { expandPlaces, formatDsl, parseDsl, pathToSpec, placeInfo, searchPlaces, specToPath, validateSpec } from "../src/index.ts";

describe("places", () => {
  it("expands groups, regions and airports", () => {
    expect(expandPlaces(["@punjab-pk"])).toEqual(["LHE", "LYP", "MUX", "SKT"]);
    expect(expandPlaces(["@vienna-bratislava", "BUD"])).toEqual(["BTS", "BUD", "VIE"]);
    expect(expandPlaces(["PK-PB"])).toEqual(expect.arrayContaining(["LHE", "SKT", "LYP", "MUX", "ISB"]));
    expect(expandPlaces(["@london"])).toHaveLength(6);
  });
  it("labels and autocompletes", () => {
    expect(placeInfo("MAN")?.label).toBe("Manchester (MAN)");
    expect(placeInfo("PK-PB")?.label).toBe("Punjab, Pakistan");
    expect(searchPlaces("manch")[0].token).toBe("MAN");
    expect(searchPlaces("bratislava").map((p) => p.token)).toContain("BTS");
    expect(searchPlaces("punjab").map((p) => p.token)).toEqual(expect.arrayContaining(["@punjab-pk", "PK-PB"]));
  });
});

describe("url", () => {
  it("round-trips a full search", () => {
    const path = "/search/@north-england,BHX/@punjab-pk/2026-12-01_2026-12-10/2027-01-05_2027-01-12?stops=3&ground=4&adults=2&via=@uae:1-2&via=back.IST:0~DOH:1";
    const { spec, error } = pathToSpec(path);
    expect(error).toBeUndefined();
    expect(spec!.origins).toEqual(["@north-england", "BHX"]);
    expect(spec!.return).toEqual({ type: "dates", range: { from: "2027-01-05", to: "2027-01-12" } });
    expect(spec!.stopovers[1]).toEqual({ direction: "back", stops: [{ places: ["IST"], minNights: 0, maxNights: 0 }, { places: ["DOH"], minNights: 1, maxNights: 1 }] });
    expect(specToPath(spec!)).toBe(path);
    expect(validateSpec(spec!)).toEqual([]);
  });
  it("handles nights and one-way", () => {
    expect(pathToSpec("/search/MAN/LHE/2026-12-01/7-14-nights").spec!.return).toEqual({ type: "nights", min: 7, max: 14 });
    expect(pathToSpec("https://x.app/search/man/lhe/2026-12-01/no-return").spec!.origins).toEqual(["MAN"]);
  });
});

describe("dsl", () => {
  it("parses and formats", () => {
    const { spec, error } = parseDsl("MAN, LPL > @punjab-pk 2026-12-01..2026-12-10 back 7-14 nights stops 3 via out @uae 1-2n then IST 0n adults 2 business cur EUR");
    expect(error).toBeUndefined();
    expect(spec!.origins).toEqual(["MAN", "LPL"]);
    expect(spec!.return).toEqual({ type: "nights", min: 7, max: 14 });
    expect(spec!.stopovers).toEqual([{ direction: "out", stops: [{ places: ["@uae"], minNights: 1, maxNights: 2 }, { places: ["IST"], minNights: 0, maxNights: 0 }] }]);
    expect(spec!.cabin).toBe("business");
    const again = parseDsl(formatDsl(spec!)).spec!;
    expect(again).toEqual(spec);
  });
  it("reports errors", () => {
    expect(parseDsl("MAN > LHE").error).toMatch(/departure date/);
    expect(parseDsl("MAN > LHE 2026-12-01 wibble").error).toMatch(/wibble/);
  });
});

describe("checked bags", () => {
  it("defaults to none and round-trips through URL and text", () => {
    expect(pathToSpec("/search/MAN/LHE/2026-12-16/no-return").spec!.holdBags).toBeUndefined();
    const { spec } = pathToSpec("/search/MAN/LHE/2026-12-16/no-return?bags=1");
    expect(spec!.holdBags).toBe(1);
    expect(specToPath(spec!)).toBe("/search/MAN/LHE/2026-12-16/no-return?bags=1");
    expect(formatDsl(spec!)).toContain("bags 1");
    expect(parseDsl(formatDsl(spec!)).spec!.holdBags).toBe(1);
    expect(validateSpec({ ...spec!, holdBags: 3 }).map((p) => p.field)).toContain("holdBags");
    const rt = pathToSpec("/search/MAN/LHE/2026-12-16/2027-01-01?returnonly=1").spec!;
    expect(rt.returnTicketsOnly).toBe(true);
    expect(specToPath(rt)).toContain("returnonly=1");
    expect(parseDsl(formatDsl(rt)).spec!.returnTicketsOnly).toBe(true);
    const al = pathToSpec("/search/MAN/LHE/2026-12-16/no-return?airlines=fz,G9,W6").spec!;
    expect(al.airlines).toEqual(["FZ", "G9", "W6"]);
    expect(specToPath(al)).toContain("airlines=FZ,G9,W6");
    expect(parseDsl(formatDsl(al)).spec!.airlines).toEqual(["FZ", "G9", "W6"]);
    expect(validateSpec({ ...al, airlines: ["FLYDUBAI"] }).map((p) => p.field)).toContain("airlines");
  });
});
