import { normalizeToken } from "./places.ts";
import { DEFAULTS, defaultSpec } from "./spec.ts";
import type { Cabin, DateRange, Direction, SearchSpec, StopoverStop } from "./types.ts";

/**
 * Plain-text search language, for typing or editing a search in one line:
 *
 *   MAN,LPL,LBA > @punjab-pk 2026-12-01..2026-12-10 back 2027-01-05..2027-01-12
 *     stops 2 via @uae 1-2n via back IST 0n then DOH 1n adults 2 cur GBP
 *
 * Keywords:
 *   A > B              origins and destinations (also "to", "->", "→")
 *   DATE[..DATE]       departure date or range (first date seen)
 *   back DATE[..DATE]  return date range; "back 7-14 nights"; "oneway"
 *   stops N | direct   max stops per direction
 *   via [out|back] PLACES N[-M]n [then PLACES N[-M]n ...]   stopover plan
 *   layover 24h        max connection length; selftransfer 180m
 *   ground 4h | noground
 *   adults N, children N, infants N, bags N (checked bags per person), economy|premium|business|first
 *   cur GBP            currency; providers google,kiwi
 *   returnonly         single return tickets only
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CABINS: Cabin[] = ["economy", "premium", "business", "first"];

function parseDateRange(s: string): DateRange | undefined {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/);
  return m ? { from: m[1], to: m[2] ?? m[1] } : undefined;
}

function fmtRange(r: DateRange): string {
  return r.from === r.to ? r.from : `${r.from}..${r.to}`;
}

function parseNights(s: string): { min: number; max: number } | undefined {
  const m = s.match(/^(\d+)(?:-(\d+))?n?$/i);
  return m ? { min: +m[1], max: +(m[2] ?? m[1]) } : undefined;
}

function parseHours(s: string): number | undefined {
  const m = s.match(/^(\d+(?:\.\d+)?)h?$/i);
  return m ? +m[1] : undefined;
}

export interface DslResult {
  spec?: SearchSpec;
  error?: string;
}

export function parseDsl(text: string): DslResult {
  const cleaned = text
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*(→|->|>)\s*/g, " > ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const spec = defaultSpec();
  spec.return = { type: "oneway" };
  let sawDepart = false;
  let i = 0;
  const next = () => tokens[i++];
  const peek = () => tokens[i];
  const placeList = (t: string | undefined) => (t ? t.split(",").map(normalizeToken).filter(Boolean) : []);
  const fail = (msg: string): DslResult => ({ error: msg });

  // Leading "A > B" or "A to B".
  if (tokens.length >= 3 && (tokens[1] === ">" || tokens[1].toLowerCase() === "to")) {
    spec.origins = placeList(next());
    next();
    spec.destinations = placeList(next());
  }

  while (i < tokens.length) {
    const raw = next();
    const t = raw.toLowerCase();
    if (DATE.test(raw.slice(0, 10)) && !sawDepart) {
      const r = parseDateRange(raw);
      if (!r) return fail(`Bad date "${raw}"`);
      spec.depart = r;
      sawDepart = true;
    } else if (t === "back" || t === "return") {
      const v = next();
      if (!v) return fail("Missing value after back");
      if (DATE.test(v.slice(0, 10))) {
        const r = parseDateRange(v);
        if (!r) return fail(`Bad return date "${v}"`);
        spec.return = { type: "dates", range: r };
      } else {
        const n = parseNights(v);
        if (!n) return fail(`Bad return "${v}"`);
        if (["nights", "night", "n"].includes((peek() ?? "").toLowerCase())) next();
        spec.return = { type: "nights", ...n };
      }
    } else if (t === "oneway" || t === "one-way") {
      spec.return = { type: "oneway" };
    } else if (t === "direct") {
      spec.maxStops = 0;
    } else if (t === "stops") {
      const n = Number(next());
      if (!Number.isInteger(n)) return fail("stops needs a number");
      spec.maxStops = n;
    } else if (t === "via") {
      let direction: Direction = "both";
      if (["out", "back"].includes((peek() ?? "").toLowerCase())) direction = next().toLowerCase() as Direction;
      const stops: StopoverStop[] = [];
      for (;;) {
        const places = placeList(next());
        const nights = parseNights(peek() ?? "") ? parseNights(next())! : { min: 0, max: 0 };
        if (!places.length) return fail("via needs a place");
        stops.push({ places, minNights: nights.min, maxNights: nights.max });
        if ((peek() ?? "").toLowerCase() === "then") next();
        else break;
      }
      spec.stopovers.push({ direction, stops });
    } else if (t === "layover") {
      const h = parseHours(next() ?? "");
      if (h === undefined) return fail("layover needs hours, e.g. 24h");
      spec.maxLayoverHours = h;
    } else if (t === "selftransfer") {
      const m = (next() ?? "").match(/^(\d+)m?$/);
      if (!m) return fail("selftransfer needs minutes, e.g. 180m");
      spec.minSelfTransferMinutes = +m[1];
    } else if (t === "ground") {
      const h = parseHours(next() ?? "");
      if (h === undefined) return fail("ground needs hours, e.g. 4h");
      spec.groundTransfers = h > 0;
      if (h > 0) spec.maxGroundHours = h;
    } else if (t === "noground") {
      spec.groundTransfers = false;
    } else if (t === "adults" || t === "children" || t === "infants") {
      const n = Number(next());
      if (!Number.isInteger(n)) return fail(`${t} needs a number`);
      spec.passengers[t] = n;
    } else if (t === "bags") {
      const n = Number(next());
      if (!Number.isInteger(n)) return fail("bags needs a number");
      if (n) spec.holdBags = n;
    } else if ((CABINS as string[]).includes(t)) {
      spec.cabin = t as Cabin;
    } else if (t === "cur" || t === "currency") {
      const c = next();
      if (!c || !/^[a-z]{3}$/i.test(c)) return fail("cur needs a currency code");
      spec.currency = c.toUpperCase();
    } else if (t === "returnonly") {
      spec.returnTicketsOnly = true;
    } else if (t === "providers") {
      spec.providers = (next() ?? "").split(",").filter(Boolean);
    } else if (!spec.origins.length) {
      spec.origins = placeList(raw);
    } else if (!spec.destinations.length) {
      spec.destinations = placeList(raw);
    } else if (raw === ">") {
      /* stray arrow */
    } else {
      return fail(`Didn't understand "${raw}"`);
    }
  }
  if (!spec.origins.length || !spec.destinations.length) return fail("Start with: FROM > TO");
  if (!sawDepart) return fail("Add a departure date, e.g. 2026-12-01..2026-12-07");
  return { spec };
}

export function formatDsl(spec: SearchSpec): string {
  const parts = [`${spec.origins.join(",")} > ${spec.destinations.join(",")}`, fmtRange(spec.depart)];
  if (spec.return.type === "dates") parts.push(`back ${fmtRange(spec.return.range)}`);
  else if (spec.return.type === "nights")
    parts.push(`back ${spec.return.min === spec.return.max ? spec.return.min : `${spec.return.min}-${spec.return.max}`} nights`);
  else parts.push("oneway");
  if (spec.maxStops !== DEFAULTS.maxStops) parts.push(spec.maxStops === 0 ? "direct" : `stops ${spec.maxStops}`);
  for (const plan of spec.stopovers) {
    const dir = plan.direction === "both" ? "" : ` ${plan.direction}`;
    const stops = plan.stops
      .map((s) => `${s.places.join(",")} ${s.minNights === s.maxNights ? s.minNights : `${s.minNights}-${s.maxNights}`}n`)
      .join(" then ");
    parts.push(`via${dir} ${stops}`);
  }
  if (spec.maxLayoverHours !== DEFAULTS.maxLayoverHours) parts.push(`layover ${spec.maxLayoverHours}h`);
  if (spec.minSelfTransferMinutes !== DEFAULTS.minSelfTransferMinutes) parts.push(`selftransfer ${spec.minSelfTransferMinutes}m`);
  if (!spec.groundTransfers) parts.push("noground");
  else if (spec.maxGroundHours !== DEFAULTS.maxGroundHours) parts.push(`ground ${spec.maxGroundHours}h`);
  if (spec.passengers.adults !== 1) parts.push(`adults ${spec.passengers.adults}`);
  if (spec.passengers.children) parts.push(`children ${spec.passengers.children}`);
  if (spec.passengers.infants) parts.push(`infants ${spec.passengers.infants}`);
  if (spec.holdBags) parts.push(`bags ${spec.holdBags}`);
  if (spec.cabin !== DEFAULTS.cabin) parts.push(spec.cabin);
  if (spec.currency !== DEFAULTS.currency) parts.push(`cur ${spec.currency}`);
  if (spec.providers.length) parts.push(`providers ${spec.providers.join(",")}`);
  if (spec.returnTicketsOnly) parts.push("returnonly");
  return parts.join(" ");
}
