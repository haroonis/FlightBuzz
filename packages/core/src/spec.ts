import { addDays, daysBetween, isISODate, today } from "./dates.ts";
import { GroupRegistry, defaultRegistry, isValidToken } from "./places.ts";
import type { SearchSpec } from "./types.ts";

export const DEFAULTS = {
  maxStops: 2,
  maxLayoverHours: 24,
  minSelfTransferMinutes: 180,
  groundTransfers: true,
  maxGroundHours: 5,
  currency: "GBP",
  cabin: "economy",
} as const;

export function defaultSpec(): SearchSpec {
  const start = addDays(today(), 30);
  return {
    origins: [],
    destinations: [],
    depart: { from: start, to: addDays(start, 6) },
    return: { type: "nights", min: 7, max: 14 },
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: DEFAULTS.cabin,
    maxStops: DEFAULTS.maxStops,
    maxLayoverHours: DEFAULTS.maxLayoverHours,
    minSelfTransferMinutes: DEFAULTS.minSelfTransferMinutes,
    groundTransfers: DEFAULTS.groundTransfers,
    maxGroundHours: DEFAULTS.maxGroundHours,
    stopovers: [],
    currency: DEFAULTS.currency,
    providers: [],
  };
}

export interface SpecProblem {
  field: string;
  message: string;
}

export function validateSpec(spec: SearchSpec, reg: GroupRegistry = defaultRegistry): SpecProblem[] {
  const p: SpecProblem[] = [];
  const checkPlaces = (field: string, tokens: string[]) => {
    if (!tokens.length) p.push({ field, message: "Choose at least one place" });
    for (const t of tokens) if (!isValidToken(t, reg)) p.push({ field, message: `Unknown place "${t}"` });
  };
  checkPlaces("origins", spec.origins);
  checkPlaces("destinations", spec.destinations);
  const { from, to } = spec.depart;
  if (!isISODate(from) || !isISODate(to)) p.push({ field: "depart", message: "Departure dates must be YYYY-MM-DD" });
  else if (daysBetween(from, to) < 0) p.push({ field: "depart", message: "Departure range ends before it starts" });
  else if (daysBetween(from, to) > 60) p.push({ field: "depart", message: "Departure range is limited to 60 days" });
  if (spec.return.type === "dates") {
    const r = spec.return.range;
    if (!isISODate(r.from) || !isISODate(r.to)) p.push({ field: "return", message: "Return dates must be YYYY-MM-DD" });
    else if (daysBetween(r.from, r.to) < 0) p.push({ field: "return", message: "Return range ends before it starts" });
    else if (isISODate(to) && daysBetween(r.to, from) > 0) p.push({ field: "return", message: "Return is before departure" });
  }
  if (spec.return.type === "nights" && (spec.return.min < 0 || spec.return.max < spec.return.min)) {
    p.push({ field: "return", message: "Nights range is invalid" });
  }
  if (spec.passengers.adults < 1) p.push({ field: "passengers", message: "At least one adult" });
  if ((spec.holdBags ?? 0) < 0 || (spec.holdBags ?? 0) > 2) p.push({ field: "holdBags", message: "Checked bags must be 0–2 per person" });
  for (const a of spec.airlines ?? []) if (!/^[A-Z0-9]{2}$/.test(a)) p.push({ field: "airlines", message: `Airline codes are 2 characters, e.g. FZ (got "${a}")` });
  if (spec.maxStops < 0 || spec.maxStops > 5) p.push({ field: "maxStops", message: "Stops must be 0–5" });
  spec.stopovers.forEach((plan, i) => {
    if (!plan.stops.length) p.push({ field: `stopovers.${i}`, message: "Stopover plan has no stops" });
    for (const s of plan.stops) {
      if (!s.places.length) p.push({ field: `stopovers.${i}`, message: "Stopover needs a place" });
      for (const t of s.places) if (!isValidToken(t, reg)) p.push({ field: `stopovers.${i}`, message: `Unknown place "${t}"` });
      if (s.minNights < 0 || s.maxNights < s.minNights) p.push({ field: `stopovers.${i}`, message: "Stopover nights are invalid" });
    }
  });
  return p;
}
