import { randomUUID } from "node:crypto";
import type { JobStatus, SearchResult, SearchSpec } from "@flightbuzz/core";
import type { FetchOptions } from "./fetcher.ts";
import { getSaved, recordRun } from "./db.ts";
import { runSearch } from "./search.ts";

const jobs = new Map<string, JobStatus & { finished?: number }>();
/** One run at a time per saved search. */
const runningSaved = new Map<string, string>();

function sweep() {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, j] of jobs) if (j.finished && j.finished < cutoff) jobs.delete(id);
}

export function getJob(id: string): JobStatus | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  const { finished: _f, ...status } = j;
  return status;
}

/** Start a search in the background and return its job id. */
export function startJob(
  spec: SearchSpec,
  savedSearchId?: string,
  run: (spec: SearchSpec, opts: FetchOptions) => Promise<SearchResult> = runSearch,
): string {
  sweep();
  if (savedSearchId && runningSaved.has(savedSearchId)) return runningSaved.get(savedSearchId)!;
  const id = randomUUID();
  const job: JobStatus & { finished?: number } = { id, status: "running", progress: { done: 0, total: 0 }, savedSearchId };
  jobs.set(id, job);
  if (savedSearchId) runningSaved.set(savedSearchId, id);
  run(spec, { onProgress: (done, total) => (job.progress = { done, total }) })
    .then((result) => {
      job.result = result;
      job.status = "done";
      if (savedSearchId && getSaved(savedSearchId)) recordRun(savedSearchId, result);
    })
    .catch((e: Error) => {
      job.status = "error";
      job.error = e.message;
    })
    .finally(() => {
      job.finished = Date.now();
      if (savedSearchId) runningSaved.delete(savedSearchId);
    });
  return id;
}

/** Run and wait (used by the scheduler and CLI). */
export async function runSavedNow(savedSearchId: string): Promise<JobStatus> {
  const saved = getSaved(savedSearchId);
  if (!saved) throw new Error("Saved search not found");
  const id = startJob(saved.spec, savedSearchId);
  for (;;) {
    const j = getJob(id)!;
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 500));
  }
}
