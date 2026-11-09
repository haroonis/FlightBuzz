import { kvGet, kvSet } from "../db.ts";

interface GateState {
  blockedUntil: number;
  blockReason: string;
  day: string;
  used: number;
}

/**
 * Shared "polite scraper" rules for unofficial sources: a daily request cap
 * and a long pause as soon as the site shows any sign of blocking us.
 * The count and any pause are saved, so restarting the app doesn't reset them.
 */
export class PoliteGate {
  private blockedUntil = 0;
  private blockReason = "";
  private day = "";
  private used = 0;

  constructor(
    private name: string,
    private opts: () => { cooldownMinutes: number; dailyLimit: number },
  ) {
    const saved = kvGet<GateState>(`gate:${name}`);
    if (saved) Object.assign(this, saved);
  }

  private save(): void {
    kvSet(`gate:${this.name}`, { blockedUntil: this.blockedUntil, blockReason: this.blockReason, day: this.day, used: this.used } satisfies GateState);
  }

  /** Reason to skip requests right now, if any. */
  unavailable(): string | undefined {
    if (Date.now() < this.blockedUntil) {
      const until = new Date(this.blockedUntil).toISOString().slice(11, 16);
      return `paused until ${until} UTC after ${this.blockReason}; using cached prices`;
    }
    if (this.day === today() && this.used >= this.opts().dailyLimit) return `daily limit of ${this.opts().dailyLimit} requests reached`;
    return undefined;
  }

  onRequest(): void {
    if (this.day !== today()) {
      this.day = today();
      this.used = 0;
    }
    this.used++;
    this.save();
  }

  /** Call with any request error; starts the cooldown if it looks like a block. */
  onError(e: unknown): void {
    const err = e as { name?: string; status?: number; message?: string };
    const block =
      err?.name === "CaptchaError" ||
      (err?.status !== undefined && [403, 429, 503].includes(err.status)) ||
      /captcha|unusual traffic|too many|rate limit/i.test(err?.message ?? "");
    if (!block) return;
    const { cooldownMinutes } = this.opts();
    this.blockedUntil = Date.now() + cooldownMinutes * 60_000;
    this.blockReason = err?.name === "CaptchaError" ? "a CAPTCHA" : err?.status ? `HTTP ${err.status}` : "a block";
    this.save();
    console.warn(`[${this.name}] ${this.blockReason}; pausing requests for ${cooldownMinutes} min`);
  }

  status() {
    return {
      blockedUntil: this.blockedUntil > Date.now() ? new Date(this.blockedUntil).toISOString() : null,
      blockReason: this.blockReason,
      usedToday: this.day === today() ? this.used : 0,
    };
  }

  note(): string {
    const st = this.status();
    const used = `${st.usedToday} requests today.`;
    return st.blockedUntil ? `Paused until ${st.blockedUntil.slice(11, 16)} UTC after ${st.blockReason}. ${used}` : used;
  }
}

export class HttpStatusError extends Error {
  constructor(
    public status: number,
    site: string,
    name = "HttpError",
  ) {
    super(`${site} answered HTTP ${status}`);
    this.name = name;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
