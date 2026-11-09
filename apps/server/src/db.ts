import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { AirportGroup, Fare, HistoryPoint, ResultSummary, SavedSearch, SearchResult, SearchSpec } from "@flightbuzz/core";
import { specToPath } from "@flightbuzz/core";
import { config } from "./config.ts";

// Loaded via require so test bundlers that don't know the newer node:sqlite builtin leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS groups (slug TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS saved (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, spec TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, last_run_at TEXT
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, saved_id TEXT NOT NULL, at TEXT NOT NULL,
    summary TEXT NOT NULL, result TEXT
  );
  CREATE INDEX IF NOT EXISTS runs_saved ON runs (saved_id, at);
  CREATE TABLE IF NOT EXISTS fare_cache (key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, fares TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// ---- small persistent settings/state ----

export function kvGet<T>(key: string): T | undefined {
  const r = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown): void {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

// ---- groups ----

export function listGroups(): AirportGroup[] {
  return (db.prepare("SELECT data FROM groups ORDER BY slug").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function putGroup(g: AirportGroup): void {
  db.prepare("INSERT INTO groups (slug, data) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET data = excluded.data").run(
    g.slug,
    JSON.stringify({ ...g, builtin: false }),
  );
}

export function deleteGroup(slug: string): boolean {
  return db.prepare("DELETE FROM groups WHERE slug = ?").run(slug).changes > 0;
}

// ---- saved searches ----

interface SavedRow {
  id: string;
  name: string;
  spec: string;
  active: number;
  created_at: string;
  last_run_at: string | null;
}

const HISTORY_POINTS = 120;

function toSaved(r: SavedRow): SavedSearch {
  const runs = (
    db.prepare("SELECT at, summary FROM runs WHERE saved_id = ? ORDER BY at DESC LIMIT ?").all(r.id, HISTORY_POINTS) as {
      at: string;
      summary: string;
    }[]
  ).reverse();
  const history: HistoryPoint[] = runs.map((run) => {
    const s = JSON.parse(run.summary) as ResultSummary;
    return { at: run.at, cheapest: s.cheapest, best: s.best, byStops: s.byStops, stopover: s.stopover };
  });
  const spec = JSON.parse(r.spec) as SearchSpec;
  return {
    id: r.id,
    name: r.name,
    spec,
    path: specToPath(spec),
    active: !!r.active,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at,
    latest: runs.length ? (JSON.parse(runs[runs.length - 1].summary) as ResultSummary) : null,
    history,
  };
}

export function listSaved(): SavedSearch[] {
  return (db.prepare("SELECT * FROM saved ORDER BY created_at").all() as unknown as SavedRow[]).map(toSaved);
}

export function getSaved(id: string): SavedSearch | undefined {
  const r = db.prepare("SELECT * FROM saved WHERE id = ?").get(id) as unknown as SavedRow | undefined;
  return r ? toSaved(r) : undefined;
}

export function createSaved(name: string, spec: SearchSpec, active = true): SavedSearch {
  const id = randomUUID().slice(0, 8);
  db.prepare("INSERT INTO saved (id, name, spec, active, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    name,
    JSON.stringify(spec),
    active ? 1 : 0,
    new Date().toISOString(),
  );
  return getSaved(id)!;
}

export function updateSaved(id: string, patch: { name?: string; spec?: SearchSpec; active?: boolean }): SavedSearch | undefined {
  const cur = getSaved(id);
  if (!cur) return undefined;
  db.prepare("UPDATE saved SET name = ?, spec = ?, active = ? WHERE id = ?").run(
    patch.name ?? cur.name,
    JSON.stringify(patch.spec ?? cur.spec),
    (patch.active ?? cur.active) ? 1 : 0,
    id,
  );
  return getSaved(id);
}

export function deleteSaved(id: string): boolean {
  db.prepare("DELETE FROM runs WHERE saved_id = ?").run(id);
  return db.prepare("DELETE FROM saved WHERE id = ?").run(id).changes > 0;
}

/** Store a run. Only the latest full result per search is kept; older runs keep their summary for history. */
export function recordRun(savedId: string, result: SearchResult): void {
  const at = result.finishedAt;
  db.prepare("UPDATE runs SET result = NULL WHERE saved_id = ?").run(savedId);
  db.prepare("INSERT INTO runs (saved_id, at, summary, result) VALUES (?, ?, ?, ?)").run(
    savedId,
    at,
    JSON.stringify(result.summary),
    JSON.stringify(result),
  );
  db.prepare("UPDATE saved SET last_run_at = ? WHERE id = ?").run(at, savedId);
}

export function latestResult(savedId: string): SearchResult | undefined {
  const r = db.prepare("SELECT result FROM runs WHERE saved_id = ? AND result IS NOT NULL ORDER BY at DESC LIMIT 1").get(savedId) as
    | { result: string }
    | undefined;
  return r ? JSON.parse(r.result) : undefined;
}

// ---- fare cache ----

export function cacheGet(key: string, maxAgeMinutes: number): Fare[] | undefined {
  const r = db.prepare("SELECT fetched_at, fares FROM fare_cache WHERE key = ?").get(key) as { fetched_at: number; fares: string } | undefined;
  if (!r || Date.now() - r.fetched_at > maxAgeMinutes * 60_000) return undefined;
  return JSON.parse(r.fares);
}

export function cachePut(key: string, fares: Fare[]): void {
  db.prepare("INSERT INTO fare_cache (key, fetched_at, fares) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, fares = excluded.fares").run(
    key,
    Date.now(),
    JSON.stringify(fares),
  );
}

export function cachePrune(maxAgeMinutes: number): void {
  db.prepare("DELETE FROM fare_cache WHERE fetched_at < ?").run(Date.now() - maxAgeMinutes * 60_000);
}
