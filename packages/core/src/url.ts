import { normalizeToken } from "./places.ts";
import { DEFAULTS, defaultSpec } from "./spec.ts";
import type { Cabin, DateRange, Direction, SearchSpec, StopoverPlan } from "./types.ts";

/**
 * Kiwi-style, hand-editable search URLs:
 *
 *   /search/@north-england,BHX/@punjab-pk/2026-12-01_2026-12-10/2027-01-05_2027-01-12?stops=2&via=@uae:1-2
 *
 * Path: /search/{origins}/{destinations}/{depart}/{return}
 *   depart  2026-12-01 or 2026-12-01_2026-12-10
 *   return  2027-01-05_2027-01-12 | 7-14-nights | no-return
 * Query (all optional, defaults omitted):
 *   stops, layover (hours), selftransfer (minutes), ground (0|hours), adults,
 *   children, infants, bags (checked bags per person), cabin, cur, providers,
 *   returnonly (1 = single return tickets only), airlines (e.g. FZ,G9,W6),
 *   via (repeatable)
 *   via = [out.|back.]{places}:{min}[-{max}][~{places}:{min}[-{max}]...]
 */

const rangeStr = (r: DateRange) => (r.from === r.to ? r.from : `${r.from}_${r.to}`);

function parseRange(s: string): DateRange | undefined {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?$/);
  return m ? { from: m[1], to: m[2] ?? m[1] } : undefined;
}

export function formatVia(plan: StopoverPlan): string {
  const prefix = plan.direction === "both" ? "" : `${plan.direction}.`;
  return (
    prefix +
    plan.stops
      .map((s) => `${s.places.join(",")}:${s.minNights === s.maxNights ? s.minNights : `${s.minNights}-${s.maxNights}`}`)
      .join("~")
  );
}

export function parseVia(value: string): StopoverPlan | undefined {
  let direction: Direction = "both";
  let rest = value.trim();
  const dm = rest.match(/^(out|back)\./i);
  if (dm) {
    direction = dm[1].toLowerCase() as Direction;
    rest = rest.slice(dm[0].length);
  }
  const stops = [];
  for (const part of rest.split("~")) {
    const m = part.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!m) return undefined;
    const places = m[1].split(",").map(normalizeToken).filter(Boolean);
    stops.push({ places, minNights: +m[2], maxNights: m[3] !== undefined ? +m[3] : +m[2] });
  }
  return stops.length ? { direction, stops } : undefined;
}

export function specToPath(spec: SearchSpec): string {
  const ret =
    spec.return.type === "oneway"
      ? "no-return"
      : spec.return.type === "nights"
        ? `${spec.return.min}-${spec.return.max}-nights`
        : rangeStr(spec.return.range);
  const path = `/search/${spec.origins.join(",")}/${spec.destinations.join(",")}/${rangeStr(spec.depart)}/${ret}`;
  const q: string[] = [];
  const add = (k: string, v: string | number) => q.push(`${k}=${String(v)}`);
  if (spec.maxStops !== DEFAULTS.maxStops) add("stops", spec.maxStops);
  if (spec.maxLayoverHours !== DEFAULTS.maxLayoverHours) add("layover", spec.maxLayoverHours);
  if (spec.minSelfTransferMinutes !== DEFAULTS.minSelfTransferMinutes) add("selftransfer", spec.minSelfTransferMinutes);
  if (!spec.groundTransfers) add("ground", 0);
  else if (spec.maxGroundHours !== DEFAULTS.maxGroundHours) add("ground", spec.maxGroundHours);
  if (spec.passengers.adults !== 1) add("adults", spec.passengers.adults);
  if (spec.passengers.children) add("children", spec.passengers.children);
  if (spec.passengers.infants) add("infants", spec.passengers.infants);
  if (spec.holdBags) add("bags", spec.holdBags);
  if (spec.cabin !== DEFAULTS.cabin) add("cabin", spec.cabin);
  if (spec.currency !== DEFAULTS.currency) add("cur", spec.currency);
  if (spec.providers.length) add("providers", spec.providers.join(","));
  if (spec.returnTicketsOnly) add("returnonly", 1);
  if (spec.airlines?.length) add("airlines", spec.airlines.join(","));
  for (const plan of spec.stopovers) add("via", formatVia(plan));
  return q.length ? `${path}?${q.join("&")}` : path;
}

export interface ParseResult {
  spec?: SearchSpec;
  error?: string;
}

/** Parse a path such as `/search/MAN/LHE/2026-12-01/no-return?stops=1` (a full URL also works). */
export function pathToSpec(input: string): ParseResult {
  let s = input.trim();
  try {
    if (/^https?:\/\//.test(s)) {
      const u = new URL(s);
      s = u.pathname + u.search;
    }
  } catch {
    /* fall through with the raw string */
  }
  const [pathPart, query = ""] = s.split("?");
  const parts = decodeURIComponent(pathPart).split("/").filter(Boolean);
  const i = parts.indexOf("search");
  const seg = i >= 0 ? parts.slice(i + 1) : parts;
  if (seg.length < 3) return { error: "Expected /search/{from}/{to}/{dates}[/{return}]" };
  const spec = defaultSpec();
  spec.origins = seg[0].split(",").map(normalizeToken).filter(Boolean);
  spec.destinations = seg[1].split(",").map(normalizeToken).filter(Boolean);
  const depart = parseRange(seg[2]);
  if (!depart) return { error: `Bad departure dates "${seg[2]}"` };
  spec.depart = depart;
  const ret = seg[3] ?? "no-return";
  const nights = ret.match(/^(\d+)(?:-(\d+))?-nights?$/);
  if (ret === "no-return") spec.return = { type: "oneway" };
  else if (nights) spec.return = { type: "nights", min: +nights[1], max: +(nights[2] ?? nights[1]) };
  else {
    const r = parseRange(ret);
    if (!r) return { error: `Bad return "${ret}"` };
    spec.return = { type: "dates", range: r };
  }
  const params = new URLSearchParams(query);
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  spec.maxStops = num("stops") ?? spec.maxStops;
  spec.maxLayoverHours = num("layover") ?? spec.maxLayoverHours;
  spec.minSelfTransferMinutes = num("selftransfer") ?? spec.minSelfTransferMinutes;
  const ground = num("ground");
  if (ground === 0) spec.groundTransfers = false;
  else if (ground !== undefined) spec.maxGroundHours = ground;
  spec.passengers.adults = num("adults") ?? 1;
  spec.passengers.children = num("children") ?? 0;
  spec.passengers.infants = num("infants") ?? 0;
  if (num("bags")) spec.holdBags = num("bags");
  const cabin = params.get("cabin");
  if (cabin) spec.cabin = cabin as Cabin;
  const cur = params.get("cur");
  if (cur) spec.currency = cur.toUpperCase();
  if (params.get("returnonly") === "1") spec.returnTicketsOnly = true;
  const airlines = params.get("airlines");
  if (airlines) spec.airlines = airlines.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
  const providers = params.get("providers");
  if (providers) spec.providers = providers.split(",").filter(Boolean);
  for (const v of params.getAll("via")) {
    const plan = parseVia(v);
    if (!plan) return { error: `Bad via "${v}"` };
    spec.stopovers.push(plan);
  }
  for (const k of ["stops", "layover", "selftransfer", "ground", "adults", "children", "infants", "bags"]) {
    if (params.has(k) && !Number.isFinite(Number(params.get(k)))) return { error: `"${k}" must be a number` };
  }
  return { spec };
}
