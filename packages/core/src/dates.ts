import type { ISODate, LocalDateTime } from "./types.ts";

const DAY = 86_400_000;

/** Parse YYYY-MM-DD as a UTC midnight timestamp (timezone-free arithmetic). */
export function dayNum(d: ISODate): number {
  return Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
}

export function fromDayNum(n: number): ISODate {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, days: number): ISODate {
  return fromDayNum(dayNum(d) + days);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return dayNum(b) - dayNum(a);
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) out.push(fromDayNum(n));
  return out;
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNum(dayNum(s)) === s;
}

/** Minutes since epoch for a local wall-clock time (comparable within one timezone). */
export function localMinutes(t: LocalDateTime): number {
  return dayNum(t.slice(0, 10)) * 1440 + +t.slice(11, 13) * 60 + +t.slice(14, 16);
}

export function fromLocalMinutes(m: number): LocalDateTime {
  const day = Math.floor(m / 1440);
  const rem = m - day * 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return `${fromDayNum(day)}T${hh}:${mm}`;
}

export function datePart(t: LocalDateTime): ISODate {
  return t.slice(0, 10);
}

export function fmtDuration(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = Math.round(min % 60);
  if (d) return `${d}d ${h}h`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/** Today's date in the server/browser local timezone. */
export function today(): ISODate {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
