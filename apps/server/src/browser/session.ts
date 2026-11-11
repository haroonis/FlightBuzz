/**
 * One real browser window, kept open and reused for every search, with a
 * saved profile so cookies and consent choices survive restarts. Each site
 * gets its own tab. Searches run one at a time per site.
 *
 * When a site shows a human check (Google "unusual traffic", Skyscanner
 * "Press & Hold"), FlightBuzz never tries to solve it: it brings the window to
 * the front and waits for you to do it, then carries on in the same window.
 */
import { config } from "../config.ts";

type PW = typeof import("playwright");
type Context = import("playwright").BrowserContext;
type Page = import("playwright").Page;

let pw: PW | null | undefined;
let context: Context | null = null;
let launching: Promise<Context> | null = null;
/** Per site: its windows, which are busy, and who is waiting for one. */
const pools = new Map<string, { pages: Page[]; busy: Set<Page>; waiting: (() => void)[]; opening: number }>();

/** What the browser is waiting on, shown in the app. */
export const browserStatus: { waitingForHuman: string | null; mode: string; error: string | null } = {
  waitingForHuman: null,
  mode: config.browser,
  error: null,
};

async function loadPlaywright(): Promise<PW | null> {
  if (pw !== undefined) return pw;
  try {
    pw = await import("playwright");
  } catch {
    pw = null;
  }
  return pw;
}

export async function browserAvailable(): Promise<boolean> {
  return config.browser !== "off" && !!(await loadPlaywright());
}

async function launch(): Promise<Context> {
  const p = await loadPlaywright();
  if (!p) throw new Error("Playwright is not installed (npm install, then npx playwright install chromium)");
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const opts = {
    viewport: null,
    locale: "en-GB",
    timezoneId: config.timezone,
    proxy,
    args: ["--window-size=1280,900"],
    ...(config.browserExecutable ? { executablePath: config.browserExecutable } : {}),
  };
  try {
    context = await p.chromium.launchPersistentContext(config.browserProfileDir, { ...opts, headless: config.browser === "headless" });
  } catch (e) {
    if (config.browser !== "headed") throw e;
    // No screen (e.g. a headless server): fall back so searches still run.
    console.warn(`[browser] could not open a visible window (${(e as Error).message.split("\n")[0]}); using a hidden one`);
    context = await p.chromium.launchPersistentContext(config.browserProfileDir, { ...opts, headless: true });
    browserStatus.mode = "headless (no screen)";
  }
  context.on("close", () => {
    context = null;
    pools.clear();
  });
  console.log(`[browser] window open, profile ${config.browserProfileDir}`);
  return context;
}

async function getContext(): Promise<Context> {
  if (context) return context;
  launching ??= launch().finally(() => (launching = null));
  return launching;
}

function pool(site: string) {
  let p = pools.get(site);
  if (!p) pools.set(site, (p = { pages: [], busy: new Set(), waiting: [], opening: 0 }));
  p.pages = p.pages.filter((pg) => !pg.isClosed());
  return p;
}

async function openWindow(site: string): Promise<Page> {
  const ctx = await getContext();
  const used = new Set([...pools.values()].flatMap((x) => x.pages));
  const blank = ctx.pages().find((pg) => pg.url() === "about:blank" && !used.has(pg));
  const page = blank ?? (await ctx.newPage());
  pool(site).pages.push(page);
  return page;
}

/** A window for a site (the first one; opened on first use and reused afterwards). */
export async function tab(site: string): Promise<Page> {
  return pool(site).pages[0] ?? openWindow(site);
}

/**
 * Run `fn` in one of the site's windows. Up to `windows` windows are opened and
 * reused; each handles one page at a time, and callers wait for a free one.
 */
export async function withTab<T>(site: string, fn: (page: Page) => Promise<T>, windows = 1): Promise<T> {
  const max = Math.max(1, windows);
  for (;;) {
    const p = pool(site);
    let page = p.pages.find((pg) => !p.busy.has(pg));
    if (!page && p.pages.length + p.opening < max) {
      p.opening++;
      try {
        page = await openWindow(site);
      } finally {
        p.opening--;
      }
    }
    if (page && !p.busy.has(page)) {
      p.busy.add(page);
      try {
        return await fn(page);
      } finally {
        p.busy.delete(page);
        p.waiting.shift()?.();
      }
    }
    await new Promise<void>((resolve) => p.waiting.push(resolve));
  }
}

/** Click the first visible button matching one of the labels (cookie banners). */
export async function clickIfPresent(page: Page, labels: RegExp[], timeoutMs = 1500): Promise<boolean> {
  for (const name of labels) {
    const btn = page.getByRole("button", { name }).first();
    try {
      if (await btn.isVisible({ timeout: timeoutMs })) {
        await btn.click();
        return true;
      }
    } catch {
      /* not there */
    }
  }
  return false;
}

/**
 * If the page is a human check, wait for the person to complete it in the
 * window. Throws a CaptchaError if it isn't done in time (or there is no
 * visible window), which pauses that site for a while.
 */
export async function waitForHuman(page: Page, site: string, isCheck: (page: Page) => Promise<boolean>): Promise<void> {
  if (!(await isCheck(page))) return;
  const visible = config.browser === "headed" && browserStatus.mode === "headed";
  if (!visible) throw Object.assign(new Error(`${site} wants a human check; run with a visible browser window to complete it`), { name: "CaptchaError" });
  browserStatus.waitingForHuman = `${site}: complete the check in the FlightBuzz browser window`;
  console.warn(`[browser] ${browserStatus.waitingForHuman} (waiting up to ${config.humanWaitMinutes} min)`);
  await page.bringToFront().catch(() => undefined);
  const deadline = Date.now() + config.humanWaitMinutes * 60_000;
  try {
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (!(await isCheck(page).catch(() => true))) return;
    }
    throw Object.assign(new Error(`${site} human check not completed within ${config.humanWaitMinutes} min`), { name: "CaptchaError" });
  } finally {
    browserStatus.waitingForHuman = null;
  }
}

/** A short, human-like pause and scroll after a page loads. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(2500 + Math.random() * 2500);
  await page.mouse.wheel(0, 300 + Math.random() * 500).catch(() => undefined);
  await page.waitForTimeout(800 + Math.random() * 1200);
}

export async function closeBrowser(): Promise<void> {
  await context?.close().catch(() => undefined);
  context = null;
  pools.clear();
}
