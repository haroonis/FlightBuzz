import path from "node:path";

// Load the repo-root .env if present (Node 21.7+).
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  /* no .env */
}

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(+v) ? +v : d);

export const config = {
  port: num(env.PORT, 8787),
  host: env.HOST ?? "127.0.0.1",
  dbPath: env.DB_PATH ?? path.resolve(import.meta.dirname, "../../../flightbuzz.db"),
  /** Local times to refresh saved searches. */
  schedule: (env.SCHEDULE ?? "07:00,19:00").split(",").map((s) => s.trim()).filter(Boolean),
  timezone: env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  /** Provider ids to enable; empty = every configured provider. */
  providers: (env.PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Max live provider requests per search run (cached answers are free). */
  requestBudget: num(env.REQUEST_BUDGET, 600),
  /** How long a fetched answer is reused. Keep below the schedule gap so each run refreshes. */
  cacheTtlMinutes: num(env.CACHE_TTL_MINUTES, 300),
  serpApiKey: env.SERPAPI_KEY ?? "",
  kiwiTequilaKey: env.KIWI_TEQUILA_KEY ?? "",
  googleMinDelayMs: num(env.GOOGLE_MIN_DELAY_MS, 1500),
  googleConcurrency: num(env.GOOGLE_CONCURRENCY, 1),
  /** Demo provider generates synthetic fares. On by default only when nothing else is configured. */
  demo: env.DEMO === undefined ? undefined : env.DEMO === "1" || env.DEMO === "true",
  webDist: path.resolve(import.meta.dirname, "../../web/dist"),
};
