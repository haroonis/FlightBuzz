/**
 * Command line helpers.
 *   npm run refresh -w @flightbuzz/server        refresh every active saved search now
 *   npm run sweep -w @flightbuzz/server -- "@europe > MUX,LHE,LYP 2026-12-16 back 2026-12-31..2027-01-03 stops 2" 21
 *       scan every starting airport on the first date pair, then search the 21 cheapest in full
 */
import { fmtDuration, parseDsl, type Trip } from "@flightbuzz/core";
import { refreshAll } from "./scheduler.ts";
import { runSweep } from "./sweep.ts";

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "refresh") {
  await refreshAll("manual refresh");
  process.exit(0);
} else if (cmd === "sweep" && args[0]) {
  const { spec, error } = parseDsl(args[0]);
  if (!spec) {
    console.error(error);
    process.exit(1);
  }
  const top = Number(args[1] ?? 21);
  let last = -1;
  const result = await runSweep(spec, top, {
    onProgress: (done, total) => {
      const pct = Math.floor((done / Math.max(total, 1)) * 100);
      if (pct !== last && pct % 10 === 0) console.log(`  ${pct}%`), (last = pct);
    },
  });
  const s = result.sweep!;
  console.log(`\nScanned ${s.scannedAirports} airports; cheapest on the scan date:`);
  console.log(s.ranking.slice(0, top).map((x) => `${x.airport} ${result.summary.currency} ${x.price}`).join(", "));
  const line = (t: Trip) => {
    const j = t.out;
    const legs = j.steps.filter((x) => x.type === "flight").map((x) => (x.type === "flight" ? x.slice.segments.map((g) => g.from).join("-") + "-" + x.slice.to : "")).join(" + ");
    const back = t.back ? ` | back ${t.back.departLocal.slice(0, 10)}` : t.openReturn ? ` | back ${t.openReturn.date} (return ticket)` : "";
    return `${result.summary.currency} ${Math.round(t.price)}  ${j.departLocal.slice(0, 16)} ${legs} (${fmtDuration(j.elapsedMin)})${back}`;
  };
  console.log("\nCheapest 10:");
  [...result.trips].sort((a, b) => a.price - b.price).slice(0, 10).forEach((t, i) => console.log(`${i + 1}. ${line(t)}`));
  process.exit(0);
} else {
  console.log('Usage: tsx src/cli.ts refresh | sweep "<text search>" [top]');
  process.exit(1);
}
