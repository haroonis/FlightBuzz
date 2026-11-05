import { airport } from "@flightbuzz/core";

const fmtCache = new Map<string, Intl.NumberFormat>();

export function money(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  let f = fmtCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
    } catch {
      f = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    }
    fmtCache.set(currency, f);
  }
  return f.format(Math.round(amount));
}

/** "Lahore" for LHE, falling back to the code. */
export function cityName(code: string): string {
  return airport(code)?.city ?? code;
}

export function airportName(code: string): string {
  const a = airport(code);
  return a ? `${a.name} (${a.iata})` : code;
}

/** "HH:mm" from a local date-time string. */
export function hhmm(t: string): string {
  return t.slice(11, 16);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 1 Dec" from YYYY-MM-DD or a local date-time. */
export function shortDate(d: string): string {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7) - 1;
  const day = +d.slice(8, 10);
  const wd = new Date(Date.UTC(y, m, day)).getUTCDay();
  return `${WEEKDAYS[wd]} ${day} ${MONTHS[m]}`;
}

export function monthName(m: number): string {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m];
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Next scheduled run among "HH:MM" times, in the given IANA timezone. */
export function nextScheduled(times: string[], timezone: string): string | null {
  if (!times.length) return null;
  let now: string;
  try {
    now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date());
  } catch {
    now = new Date().toTimeString().slice(0, 5);
  }
  const sorted = [...times].sort();
  const next = sorted.find((t) => t > now);
  return next ? `today ${next}` : `tomorrow ${sorted[0]}`;
}
