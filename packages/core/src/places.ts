import { AIRPORTS, COUNTRIES, REGIONS, airport, airportsInCountry, airportsInRegion, haversineKm } from "./data.ts";
import { BUILTIN_GROUPS } from "./groups.ts";
import type { AirportGroup } from "./types.ts";

/**
 * Place tokens, used in the URL, the text query and the API:
 *   MAN          airport (3 letters)
 *   PK           country (2 letters)
 *   PK-PB        region (ISO 3166-2)
 *   @punjab-pk   airport group
 */
export type PlaceKind = "airport" | "country" | "region" | "group";

export interface PlaceInfo {
  token: string;
  kind: PlaceKind;
  label: string;
  sublabel: string;
  airports: string[];
}

export class GroupRegistry {
  private groups = new Map<string, AirportGroup>();

  constructor(custom: AirportGroup[] = []) {
    for (const g of BUILTIN_GROUPS) this.groups.set(g.slug, g);
    for (const g of custom) this.groups.set(g.slug, g);
  }

  get(slug: string): AirportGroup | undefined {
    return this.groups.get(slug.toLowerCase());
  }

  all(): AirportGroup[] {
    return [...this.groups.values()];
  }

  set(group: AirportGroup): void {
    this.groups.set(group.slug, group);
  }
}

export const defaultRegistry = new GroupRegistry();

export function normalizeToken(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("@")) return t.toLowerCase();
  return t.toUpperCase();
}

export function tokenKind(token: string): PlaceKind | undefined {
  if (/^@[a-z0-9][a-z0-9-]*$/.test(token)) return "group";
  if (/^[A-Z]{3}$/.test(token)) return "airport";
  if (/^[A-Z]{2}$/.test(token)) return "country";
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(token)) return "region";
  return undefined;
}

export function isValidToken(token: string, reg: GroupRegistry = defaultRegistry): boolean {
  switch (tokenKind(token)) {
    case "airport":
      return !!airport(token);
    case "country":
      return token in COUNTRIES;
    case "region":
      return token in REGIONS;
    case "group":
      return !!reg.get(token.slice(1));
    default:
      return false;
  }
}

/** Expand place tokens into a sorted, de-duplicated list of airport codes. */
export function expandPlaces(tokens: string[], reg: GroupRegistry = defaultRegistry, seen = new Set<string>()): string[] {
  const out = new Set<string>();
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    switch (tokenKind(token)) {
      case "airport":
        if (airport(token)) out.add(token);
        break;
      case "country":
        airportsInCountry(token).forEach((a) => out.add(a.iata));
        break;
      case "region":
        airportsInRegion(token).forEach((a) => out.add(a.iata));
        break;
      case "group": {
        if (seen.has(token)) break; // cycle guard
        const g = reg.get(token.slice(1));
        if (g) expandPlaces(g.members, reg, new Set([...seen, token])).forEach((c) => out.add(c));
        break;
      }
    }
  }
  return [...out].sort();
}

/**
 * Add every airport within `km` of any airport in the list (large and medium
 * airports with scheduled flights). Sorted, without duplicates.
 */
export function withNearby(codes: string[], km: number): string[] {
  if (!km || km <= 0) return codes;
  const out = new Set(codes);
  const base = codes.map((c) => airport(c)).filter((a): a is NonNullable<typeof a> => !!a);
  for (const a of AIRPORTS) {
    if (a.size === "S" || out.has(a.iata)) continue;
    if (base.some((b) => haversineKm(a, b) <= km)) out.add(a.iata);
  }
  return [...out].sort();
}

export function placeInfo(token: string, reg: GroupRegistry = defaultRegistry): PlaceInfo | undefined {
  const t = normalizeToken(token);
  const kind = tokenKind(t);
  if (!kind || !isValidToken(t, reg)) return undefined;
  const airports = expandPlaces([t], reg);
  switch (kind) {
    case "airport": {
      const a = airport(t)!;
      return { token: t, kind, label: `${a.city} (${a.iata})`, sublabel: `${a.name}, ${COUNTRIES[a.country] ?? a.country}`, airports };
    }
    case "country":
      return { token: t, kind, label: COUNTRIES[t], sublabel: `Country · ${airports.length} airports`, airports };
    case "region": {
      const country = COUNTRIES[t.slice(0, 2)] ?? t.slice(0, 2);
      return { token: t, kind, label: `${REGIONS[t]}, ${country}`, sublabel: `Region · ${airports.join(", ")}`, airports };
    }
    case "group": {
      const g = reg.get(t.slice(1))!;
      return { token: t, kind, label: g.name, sublabel: `Group · ${airports.join(", ")}`, airports };
    }
  }
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Autocomplete across groups, airports, regions and countries. */
export function searchPlaces(query: string, reg: GroupRegistry = defaultRegistry, limit = 12): PlaceInfo[] {
  const q = fold(query.trim().replace(/^@/, ""));
  if (!q) return [];
  const scored: { token: string; score: number }[] = [];
  const consider = (token: string, fields: string[], boost: number) => {
    let best = 0;
    for (const f of fields) {
      const v = fold(f);
      if (v === q) best = Math.max(best, 100);
      else if (v.startsWith(q)) best = Math.max(best, 60);
      else if (v.split(/[\s,()-]+/).some((w) => w.startsWith(q))) best = Math.max(best, 40);
      else if (q.length >= 3 && v.includes(q)) best = Math.max(best, 20);
    }
    if (best) scored.push({ token, score: best + boost });
  };
  for (const g of reg.all()) consider(`@${g.slug}`, [g.slug, g.name], 5);
  for (const a of AIRPORTS) {
    const sizeBoost = a.size === "L" ? 6 : a.size === "M" ? 3 : 0;
    consider(a.iata, [a.iata, a.city, a.name], sizeBoost + (a.iata.toLowerCase() === q ? 20 : 0));
  }
  for (const [code, name] of Object.entries(COUNTRIES)) consider(code, [name, code.length === q.length ? code : ""], 5);
  for (const [code, name] of Object.entries(REGIONS)) consider(code, [name], 0);
  scored.sort((a, b) => b.score - a.score);
  const out: PlaceInfo[] = [];
  for (const s of scored) {
    const info = placeInfo(s.token, reg);
    if (info && info.airports.length) out.push(info);
    if (out.length >= limit) break;
  }
  return out;
}
