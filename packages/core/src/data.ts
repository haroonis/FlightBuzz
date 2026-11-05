import airportsRaw from "../../../data/airports.json";
import countriesRaw from "../../../data/countries.json";
import regionsRaw from "../../../data/regions.json";
import type { Airport } from "./types.ts";

type Row = [string, string, string, string, string, number, number, string];

export const AIRPORTS: Airport[] = (airportsRaw as Row[]).map(
  ([iata, name, city, country, region, lat, lon, size]) => ({
    iata,
    name,
    city: city.split(",")[0].trim() || name,
    country,
    region,
    lat,
    lon,
    size: size as Airport["size"],
  }),
);

export const COUNTRIES: Record<string, string> = countriesRaw as Record<string, string>;
export const REGIONS: Record<string, string> = regionsRaw as Record<string, string>;

const byCode = new Map(AIRPORTS.map((a) => [a.iata, a]));

export function airport(code: string): Airport | undefined {
  return byCode.get(code.toUpperCase());
}

export function airportsInCountry(country: string, includeSmall = false): Airport[] {
  const c = country.toUpperCase();
  return AIRPORTS.filter((a) => a.country === c && (includeSmall || a.size !== "S"));
}

export function airportsInRegion(region: string, includeSmall = false): Airport[] {
  const r = region.toUpperCase();
  return AIRPORTS.filter((a) => a.region === r && (includeSmall || a.size !== "S"));
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceKm(from: string, to: string): number {
  const a = airport(from);
  const b = airport(to);
  if (!a || !b) return NaN;
  return haversineKm(a, b);
}
