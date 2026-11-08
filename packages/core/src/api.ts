/** Request/response shapes shared by the server and the web app. */
import type { AirportGroup, ProviderCapabilities, SearchSpec, Trip } from "./types.ts";

export interface ProviderInfo {
  id: string;
  name: string;
  /** Has the credentials/setup it needs. */
  configured: boolean;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  note: string;
}

export interface MetaResponse {
  providers: ProviderInfo[];
  groups: AirportGroup[];
  /** Local times the scheduler refreshes saved searches, e.g. ["07:00", "19:00"]. */
  schedule: string[];
  timezone: string;
  currencies: string[];
  browser: BrowserInfo;
}

export interface BrowserInfo {
  /** "headed", "headless", "headless (no screen)" or "off". */
  mode: string;
  /** Set while a site's human check is waiting for you in the browser window. */
  waitingForHuman: string | null;
}

export type StopBucket = "0" | "1" | "2" | "3+";

export interface ResultSummary {
  tripCount: number;
  cheapest: number | null;
  best: number | null;
  fastest: number | null;
  byStops: Record<StopBucket, number | null>;
  stopover: number | null;
  airportChange: number | null;
  currency: string;
}

export interface RouteSummary {
  id: string;
  direction: "out" | "back";
  label: string;
  journeys: number;
}

export interface SearchResult {
  spec: SearchSpec;
  trips: Trip[];
  summary: ResultSummary;
  routes: RouteSummary[];
  stats: {
    requests: number;
    cachedRequests: number;
    fares: number;
    skippedRequests: number;
    errors: string[];
    durationMs: number;
  };
  finishedAt: string;
}

export interface JobStatus {
  id: string;
  status: "running" | "done" | "error";
  progress: { done: number; total: number };
  error?: string;
  result?: SearchResult;
  savedSearchId?: string;
}

export interface HistoryPoint {
  at: string;
  cheapest: number | null;
  best: number | null;
  byStops: Record<StopBucket, number | null>;
  stopover: number | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  spec: SearchSpec;
  /** Kiwi-style path for the search, e.g. /search/MAN/LHE/2026-12-01/no-return */
  path: string;
  active: boolean;
  createdAt: string;
  lastRunAt: string | null;
  latest: ResultSummary | null;
  history: HistoryPoint[];
}

export interface SavedSearchInput {
  name: string;
  spec: SearchSpec;
  active?: boolean;
}
