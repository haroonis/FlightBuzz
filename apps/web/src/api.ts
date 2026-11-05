import type {
  AirportGroup,
  JobStatus,
  MetaResponse,
  SavedSearch,
  SavedSearchInput,
  SearchResult,
  SearchSpec,
} from "@flightbuzz/core";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Thrown when the server can't be reached at all (network error or proxy 5xx with no body). */
export class ServerDownError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ServerDownError("Server not reachable");
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    if ((res.status === 502 || res.status === 503 || res.status === 504) && data === undefined) {
      throw new ServerDownError("Server not reachable");
    }
    const msg = (data as { error?: string } | undefined)?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  meta: () => request<MetaResponse>("GET", "/api/meta"),
  search: (spec: SearchSpec) => request<{ jobId: string }>("POST", "/api/search", { spec }),
  job: (id: string) => request<JobStatus>("GET", `/api/jobs/${encodeURIComponent(id)}`),
  saved: () => request<SavedSearch[]>("GET", "/api/saved"),
  createSaved: (input: SavedSearchInput) => request<SavedSearch>("POST", "/api/saved", input),
  updateSaved: (id: string, patch: Partial<SavedSearchInput>) =>
    request<SavedSearch>("PUT", `/api/saved/${encodeURIComponent(id)}`, patch),
  deleteSaved: (id: string) => request<void>("DELETE", `/api/saved/${encodeURIComponent(id)}`),
  runSaved: (id: string) => request<{ jobId: string }>("POST", `/api/saved/${encodeURIComponent(id)}/run`),
  savedResult: (id: string) => request<SearchResult | null>("GET", `/api/saved/${encodeURIComponent(id)}/result`),
  groups: () => request<AirportGroup[]>("GET", "/api/groups"),
  saveGroup: (g: Omit<AirportGroup, "builtin">) =>
    request<AirportGroup>("PUT", `/api/groups/${encodeURIComponent(g.slug)}`, g),
  deleteGroup: (slug: string) => request<void>("DELETE", `/api/groups/${encodeURIComponent(slug)}`),
};
