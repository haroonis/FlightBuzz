/**
 * Command line helpers.
 *   npm run refresh -w @flightbuzz/server        refresh every active saved search now
 *   npm run sweep -w @flightbuzz/server -- "@europe > MUX,LHE,LYP 2026-12-16 back 2026-12-31..2027-01-03 stops 2" 21
 *       scan every starting airport on the first date pair, then search the 21 cheapest in full
 *   npm run searches -- list                     list the plans in searches.csv (with page estimates)
 *   npm run searches -- run primary flydubai     run plans by id or group ("all" = every enabled plan)
 */
import { fmtDuration, parseDsl, type Trip } from "@flightbuzz/core";
import { refreshAll } from "./scheduler.ts";
import { runSweep } from "./sweep.ts";
import { estimatePages, loadPlans, runPlans, syncTrackedPlans } from "./plans.ts";
import { DEFAULT_BEST, findBest } from "./best.ts";
import { config } from "./config.ts";

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
} else if (cmd === "searches" && args[0] === "list") {
  const { plans, problems } = loadPlans();
  console.log(`${config.searchesFile}: ${plans.length} plans`);
  for (const p of problems) console.log(`  ! line ${p.line}${p.id ? ` (${p.id})` : ""}: ${p.message}`);
  for (const p of plans) {
    console.log(`  ${p.enabled ? "on " : "off"} ${p.id.padEnd(22)} ${(p.group || "-").padEnd(16)} ${p.kind.padEnd(6)} ${p.track ? "track" : "     "} ~${String(estimatePages(p)).padStart(3)} pages  ${p.notes}`);
  }
  process.exit(problems.length ? 1 : 0);
} else if (cmd === "searches" && args[0] === "run" && args.length > 1) {
  syncTrackedPlans();
  const results = await runPlans(args.slice(1));
  for (const { plan, result } of results) {
    if (!result) continue;
    console.log(`\n${plan.id}: cheapest 5`);
    [...result.trips].sort((a, b) => a.price - b.price).slice(0, 5).forEach((t, i) => {
      const legs = t.out.steps.filter((x) => x.type === "flight").map((x) => (x.type === "flight" ? x.slice.segments.map((g) => g.from).join("-") + "-" + x.slice.to : "")).join(" + ");
      const back = t.back ? `back ${t.back.departLocal.slice(0, 10)}` : t.openReturn ? `back ${t.openReturn.date} (return ticket)` : "one-way";
      console.log(`  ${i + 1}. ${result.summary.currency} ${Math.round(t.price)}  ${t.out.departLocal.slice(0, 16)} ${legs} (${fmtDuration(t.out.elapsedMin)}), ${back}`);
    });
  }
  process.exit(0);
} else if (cmd === "searches" && args[0] === "best") {
  const list = findBest(DEFAULT_BEST, Number(args[1] ?? 10));
  console.log(`Cheapest door-to-door from ${DEFAULT_BEST.home.join("/")} (leave from ${DEFAULT_BEST.leaveFrom}, back by ${DEFAULT_BEST.backBy}), from prices fetched in the last ${DEFAULT_BEST.maxAgeHours}h:`);
  list.forEach((r, i) => {
    console.log(`\n${i + 1}. £${r.total} (${r.kind}${r.kind === "via Europe" ? ` ${r.hub}` : ""})`);
    for (const c of r.costs) console.log(`   £${String(c.gbp).padStart(4)}  ${c.label}`);
    for (const n of r.notes) console.log(`   ! ${n}`);
  });
  process.exit(0);
} else {
  console.log('Usage: tsx src/cli.ts refresh | sweep "<text search>" [top] | searches list | searches run <id|group|all>... | searches best [n]');
  process.exit(1);
}
