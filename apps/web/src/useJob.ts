import type { JobStatus, SearchResult } from "@flightbuzz/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

export interface JobState {
  running: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
}

/** Start a server job and poll it every second until it finishes. */
export function useJob(onResult: (r: SearchResult, job: JobStatus) => void, onError?: (e: unknown) => string) {
  const [state, setState] = useState<JobState>({ running: false, progress: null, error: null });
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const resultCb = useRef(onResult);
  resultCb.current = onResult;
  const errorCb = useRef(onError);
  errorCb.current = onError;

  useEffect(
    () => () => {
      generation.current++;
      window.clearTimeout(timer.current);
    },
    [],
  );

  const describe = (e: unknown) => errorCb.current?.(e) ?? (e instanceof Error ? e.message : String(e));

  const start = useCallback(async (begin: () => Promise<{ jobId: string }>) => {
    const gen = ++generation.current;
    window.clearTimeout(timer.current);
    setState({ running: true, progress: null, error: null });
    let jobId: string;
    try {
      jobId = (await begin()).jobId;
    } catch (e) {
      if (gen === generation.current) setState({ running: false, progress: null, error: describe(e) });
      return;
    }
    const poll = async () => {
      if (gen !== generation.current) return;
      try {
        const job = await api.job(jobId);
        if (gen !== generation.current) return;
        if (job.status === "running") {
          setState({ running: true, progress: job.progress, error: null });
          timer.current = window.setTimeout(poll, 1000);
        } else if (job.status === "done" && job.result) {
          setState({ running: false, progress: job.progress, error: null });
          resultCb.current(job.result, job);
        } else {
          setState({ running: false, progress: job.progress, error: job.error ?? "Search failed" });
        }
      } catch (e) {
        if (gen === generation.current) setState({ running: false, progress: null, error: describe(e) });
      }
    };
    void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    window.clearTimeout(timer.current);
    setState((s) => ({ ...s, running: false }));
  }, []);

  return { ...state, start, cancel };
}
