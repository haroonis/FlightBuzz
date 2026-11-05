/**
 * Command line helpers.
 *   npm run refresh -w @flightbuzz/server     refresh every active saved search now
 * Handy for running from system cron instead of keeping the server up.
 */
import { refreshAll } from "./scheduler.ts";

const cmd = process.argv[2];
if (cmd === "refresh") {
  await refreshAll("manual refresh");
  process.exit(0);
} else {
  console.log("Usage: tsx src/cli.ts refresh");
  process.exit(1);
}
