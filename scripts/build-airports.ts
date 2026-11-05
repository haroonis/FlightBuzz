/**
 * Builds data/airports.json, data/countries.json and data/regions.json from the
 * public-domain OurAirports dataset (https://ourairports.com/data/).
 *
 * Usage: npm run data:airports [-- /path/to/csv/dir]
 * Without a directory argument the CSVs are downloaded from GitHub.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main";
const OUT = path.resolve(import.meta.dirname, "../data");

async function load(name: string, dir?: string): Promise<string> {
  if (dir) return readFile(path.join(dir, `${name}.csv`), "utf8");
  const res = await fetch(`${SRC}/${name}.csv`);
  if (!res.ok) throw new Error(`Failed to download ${name}.csv: ${res.status}`);
  return res.text();
}

/** Minimal RFC4180 CSV parser (handles quotes and embedded commas). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const dir = process.argv[2];
const [airportsCsv, regionsCsv, countriesCsv] = await Promise.all(
  ["airports", "regions", "countries"].map((n) => load(n, dir)),
);

const TYPE: Record<string, "L" | "M" | "S"> = { large_airport: "L", medium_airport: "M", small_airport: "S" };

// [iata, name, city, country, region, lat, lon, size]
const airports: [string, string, string, string, string, number, number, string][] = [];
const seen = new Set<string>();
for (const a of parseCsv(airportsCsv)) {
  const iata = a.iata_code?.trim();
  const size = TYPE[a.type];
  if (!iata || !/^[A-Z]{3}$/.test(iata) || !size) continue;
  if (a.scheduled_service !== "yes") continue;
  if (seen.has(iata)) continue;
  seen.add(iata);
  airports.push([
    iata,
    a.name,
    a.municipality,
    a.iso_country,
    a.iso_region,
    Math.round(Number(a.latitude_deg) * 1e4) / 1e4,
    Math.round(Number(a.longitude_deg) * 1e4) / 1e4,
    size,
  ]);
}
airports.sort((x, y) => x[0].localeCompare(y[0]));

const usedRegions = new Set(airports.map((a) => a[4]));
const usedCountries = new Set(airports.map((a) => a[3]));
const regions = Object.fromEntries(
  parseCsv(regionsCsv).filter((r) => usedRegions.has(r.code)).map((r) => [r.code, r.name]),
);
const countries = Object.fromEntries(
  parseCsv(countriesCsv).filter((c) => usedCountries.has(c.code)).map((c) => [c.code, c.name]),
);

await writeFile(path.join(OUT, "airports.json"), JSON.stringify(airports));
await writeFile(path.join(OUT, "regions.json"), JSON.stringify(regions));
await writeFile(path.join(OUT, "countries.json"), JSON.stringify(countries));
console.log(`airports: ${airports.length}, regions: ${Object.keys(regions).length}, countries: ${Object.keys(countries).length}`);
