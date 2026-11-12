import { describe, expect, it } from "vitest";
import { parseSearchFile, selectPlans } from "../src/index.ts";

const FILE = `# comment line
id,enabled,group,kind,from,to,depart,return,stops,via,airlines,return_only,top,track,notes
primary,yes,primary,search,MAN LPL LBA,LHE MUX LYP,2026-12-16..2026-12-17,2026-12-31..2027-01-03,2,@uae 0-2n,,no,,yes,"Main, with a comma"
fz,yes,budget,search,BGY NAP,MUX,2026-12-16,2026-12-31,1,,FZ,yes,,no,
nights,no,misc,search,@london,PK-PB,2026-12-01..2026-12-07,14-21 nights,1,out IST 1n; back DOH 0n,,,,,
sweep,yes,europe,sweep,@europe,MUX,2026-12-16,oneway,2,,,,7,,
bad,yes,misc,search,MAN,LHE,not-a-date,oneway,,,,,,,
`;

describe("searches.csv", () => {
  const { plans, problems } = parseSearchFile(FILE);

  it("reads plans in FlightBuzz terms", () => {
    expect(plans.map((p) => p.id)).toEqual(["primary", "fz", "nights", "sweep"]);
    const primary = plans[0];
    expect(primary.spec.origins).toEqual(["MAN", "LPL", "LBA"]);
    expect(primary.spec.return).toEqual({ type: "dates", range: { from: "2026-12-31", to: "2027-01-03" } });
    expect(primary.spec.stopovers).toEqual([{ direction: "both", stops: [{ places: ["@uae"], minNights: 0, maxNights: 2 }] }]);
    expect(primary.track).toBe(true);
    expect(primary.notes).toBe("Main, with a comma");
    expect(plans[1].spec.airlines).toEqual(["FZ"]);
    expect(plans[1].spec.returnTicketsOnly).toBe(true);
    expect(plans[2].spec.return).toEqual({ type: "nights", min: 14, max: 21 });
    expect(plans[2].spec.stopovers.map((s) => s.direction)).toEqual(["out", "back"]);
    expect(plans[3]).toMatchObject({ kind: "sweep", top: 7 });
    expect(plans[3].spec.return).toEqual({ type: "oneway" });
  });

  it("reports bad lines with their line number", () => {
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 7, id: "bad" });
  });

  it("selects by id, group or all; disabled lines only by id", () => {
    expect(selectPlans(plans, ["all"]).map((p) => p.id)).toEqual(["primary", "fz", "sweep"]);
    expect(selectPlans(plans, ["budget", "primary"]).map((p) => p.id)).toEqual(["fz", "primary"]);
    expect(selectPlans(plans, ["sweep", "all"]).map((p) => p.id)).toEqual(["sweep", "primary", "fz"]);
    expect(selectPlans(plans, ["misc"])).toHaveLength(0);
    expect(selectPlans(plans, ["nights"]).map((p) => p.id)).toEqual(["nights"]);
  });
});
