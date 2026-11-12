/**
 * searches.csv: the human-editable list of search plans.
 *
 * One line is one plan in FlightBuzz terms (airport groups, date ranges,
 * options), not one Google page; the app expands it into as many site
 * searches as it needs. Lists inside a cell are separated by spaces, so
 * cells never need quoting (quotes are still understood).
 *
 * Columns (only id, from, to and depart are required):
 *   id            short unique name, e.g. primary
 *   enabled       yes/no: no = kept in the file but never run
 *   group         tag for running or switching several lines at once
 *   kind          search (default) or sweep (scan every origin on one date pair,
 *                 then search the cheapest `top` in full)
 *   from, to      place tokens: MAN, @north-england, PK, PK-PB
 *   depart        2026-12-16 or 2026-12-16..2026-12-17
 *   return        2026-12-31..2027-01-03, oneway, or 14-21 nights
 *   stops         max stops per direction (default 2)
 *   layover_h     max connection hours (default 24)
 *   via           stopover plans, e.g. "@uae 0-2n" or "out IST 1n; back DOH 0n"
 *   airlines      only these airlines, e.g. FZ or G9 3L 9P
 *   nearby_km     also use airports within this distance (both sides)
 *   return_only   yes = single return tickets only
 *   bags          checked bags per person (default 0)
 *   adults, children, infants, cabin, currency
 *   sources       google (default), kiwi, skyscanner
 *   top           for sweeps: how many origins to search in full
 *   track         yes = refresh twice a day as a saved search
 *   notes         anything
 */
import { parseDsl } from "./dsl.ts";
import type { SearchSpec } from "./types.ts";

export const SEARCH_FILE_COLUMNS = [
  "id", "enabled", "group", "kind", "from", "to", "depart", "return", "stops", "layover_h", "via", "airlines",
  "nearby_km", "return_only", "bags", "adults", "children", "infants", "cabin", "currency", "sources", "top", "track", "notes",
] as const;

export type SearchRow = Partial<Record<(typeof SEARCH_FILE_COLUMNS)[number], string>>;

export interface PlanLine {
  id: string;
  enabled: boolean;
  group: string;
  kind: "search" | "sweep";
  top: number;
  track: boolean;
  notes: string;
  spec: SearchSpec;
  /** The same plan as one line of the text search language. */
  text: string;
  line: number;
}

export interface SearchFileProblem {
  line: number;
  id?: string;
  message: string;
}

/** Minimal CSV reader (RFC 4180 quotes, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const yes = (v: string | undefined, dflt: boolean) => (v === undefined || v.trim() === "" ? dflt : /^(y|yes|true|1|on)$/i.test(v.trim()));
const list = (v: string | undefined) => (v ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** Build the text-search line for a row, so parsing and validation are shared with the app. */
export function rowToText(r: SearchRow): string {
  const parts = [`${list(r.from).join(",")} > ${list(r.to).join(",")}`, (r.depart ?? "").trim()];
  const ret = (r.return ?? "").trim();
  if (!ret || /^one-?way$/i.test(ret)) parts.push("oneway");
  else if (/nights?$/i.test(ret)) parts.push(`back ${ret.replace(/\s*nights?$/i, "")} nights`);
  else parts.push(`back ${ret}`);
  if (r.stops?.trim()) parts.push(`stops ${r.stops.trim()}`);
  if (r.layover_h?.trim()) parts.push(`layover ${r.layover_h.trim()}h`);
  for (const plan of (r.via ?? "").split(";").map((x) => x.trim()).filter(Boolean)) parts.push(`via ${plan}`);
  if (list(r.airlines).length) parts.push(`airlines ${list(r.airlines).join(",")}`);
  if (r.nearby_km?.trim()) parts.push(`nearby ${r.nearby_km.trim()}km`);
  if (yes(r.return_only, false)) parts.push("returnonly");
  for (const k of ["bags", "adults", "children", "infants"] as const) if (r[k]?.trim()) parts.push(`${k} ${r[k]!.trim()}`);
  if (r.cabin?.trim()) parts.push(r.cabin.trim().toLowerCase());
  if (r.currency?.trim()) parts.push(`cur ${r.currency.trim()}`);
  parts.push(`providers ${list(r.sources).join(",") || "google"}`);
  return parts.join(" ");
}

/** Read searches.csv. Lines whose first cell starts with # are comments. */
export function parseSearchFile(text: string): { plans: PlanLine[]; problems: SearchFileProblem[] } {
  const rows = parseCsv(text);
  const plans: PlanLine[] = [];
  const problems: SearchFileProblem[] = [];
  let header: string[] | null = null;
  const seen = new Set<string>();
  rows.forEach((cells, i) => {
    const line = i + 1;
    if (!cells.some((c) => c.trim())) return;
    if (cells[0].trim().startsWith("#")) return;
    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      const unknown = header.filter((h) => h && !(SEARCH_FILE_COLUMNS as readonly string[]).includes(h));
      if (unknown.length) problems.push({ line, message: `Unknown column(s): ${unknown.join(", ")}` });
      return;
    }
    const r: SearchRow = {};
    header.forEach((h, j) => ((r as Record<string, string>)[h] = cells[j] ?? ""));
    const id = (r.id ?? "").trim();
    if (!id) return problems.push({ line, message: "Missing id" });
    if (seen.has(id)) return problems.push({ line, id, message: `Duplicate id "${id}"` });
    seen.add(id);
    const text = rowToText(r);
    const { spec, error } = parseDsl(text);
    if (!spec) return problems.push({ line, id, message: error ?? "Could not read this line" });
    const kind = (r.kind ?? "").trim().toLowerCase() === "sweep" ? "sweep" : "search";
    plans.push({
      id,
      enabled: yes(r.enabled, true),
      group: (r.group ?? "").trim(),
      kind,
      top: Number(r.top) > 0 ? Math.round(Number(r.top)) : 21,
      track: yes(r.track, false),
      notes: (r.notes ?? "").trim(),
      spec,
      text,
      line,
    });
  });
  return { plans, problems };
}

/**
 * Pick plans by id or group, in the order the selectors are given ("all" adds
 * every remaining enabled plan in file order). Disabled plans are skipped
 * unless named by id. Each plan appears once.
 */
export function selectPlans(plans: PlanLine[], selectors: string[]): PlanLine[] {
  const out: PlanLine[] = [];
  const add = (p: PlanLine) => (out.includes(p) ? undefined : out.push(p));
  for (const sel of selectors.length ? selectors : ["all"]) {
    for (const p of plans) {
      if (sel === "all" ? p.enabled : p.id === sel || (p.enabled && p.group === sel)) add(p);
    }
  }
  return out;
}
