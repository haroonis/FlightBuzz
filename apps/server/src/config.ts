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
  /**
   * Pause between Google requests (plus up to 75% jitter): 23–40 s, ~110 requests/hour at most.
   * At 15–26 s, Google showed a robot check after a full day (~150 pages) of searching.
   * A live test from a cloud server hit HTTP 429 after ~10 requests 10–30 s apart.
   */
  googleMinDelayMs: num(env.GOOGLE_MIN_DELAY_MS, 23000),
  googleConcurrency: num(env.GOOGLE_CONCURRENCY, 1),
  /** Hard cap on Google requests per day. */
  googleDailyLimit: num(env.GOOGLE_DAILY_LIMIT, 150),
  /** After a block (429 / CAPTCHA), stop asking Google for this long. */
  googleCooldownMinutes: num(env.GOOGLE_COOLDOWN_MINUTES, 180),
  /** Kiwi answers a whole leg (all airports, all dates) per request, so far fewer requests are needed. */
  kiwiMinDelayMs: num(env.KIWI_MIN_DELAY_MS, 24000),
  kiwiDailyLimit: num(env.KIWI_DAILY_LIMIT, 200),
  kiwiCooldownMinutes: num(env.KIWI_COOLDOWN_MINUTES, 180),
  /** Demo provider generates synthetic fares. On by default only when nothing else is configured. */
  demo: env.DEMO === undefined ? undefined : env.DEMO === "1" || env.DEMO === "true",
  /**
   * How to reach Google Flights and Skyscanner: "headed" (a real, visible browser
   * window that is kept open and reused; the default), "headless" (hidden
   * browser) or "off" (Google via direct requests; Skyscanner disabled).
   */
  browser: (env.BROWSER ?? "headed") as "headed" | "headless" | "off",
  /** Saved browser profile: cookies and consent choices live here. */
  browserProfileDir: env.BROWSER_PROFILE_DIR ?? path.resolve(import.meta.dirname, "../../../.browser-profile"),
  /** Use a specific Chrome/Chromium instead of Playwright's. */
  browserExecutable: env.BROWSER_EXECUTABLE ?? "",
  /** How long to wait for you to complete a human check in the window. */
  humanWaitMinutes: num(env.HUMAN_WAIT_MINUTES, 10),
  skyscannerMinDelayMs: num(env.SKYSCANNER_MIN_DELAY_MS, 36000),
  skyscannerDailyLimit: num(env.SKYSCANNER_DAILY_LIMIT, 150),
  skyscannerCooldownMinutes: num(env.SKYSCANNER_COOLDOWN_MINUTES, 180),
  webDist: path.resolve(import.meta.dirname, "../../web/dist"),
};
