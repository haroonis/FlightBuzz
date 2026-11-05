import {
  defaultSpec,
  pathToSpec,
  placeInfo,
  specToPath,
  validateSpec,
  type SearchResult,
  type SearchSpec,
} from "@flightbuzz/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { Results } from "../components/Results.tsx";
import { SearchForm } from "../components/SearchForm.tsx";
import { useApp } from "../context.tsx";
import { monthName } from "../format.ts";
import { useJob } from "../useJob.ts";

const STORAGE_KEY = "flightbuzz:lastSpec";

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function isComplete(s: SearchSpec) {
  return s.origins.length > 0 && s.destinations.length > 0;
}

function initialSpec(fullPath: string): SearchSpec {
  if (fullPath.startsWith("/search/")) {
    const r = pathToSpec(fullPath);
    if (r.spec) return r.spec;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const r = pathToSpec(raw);
      if (r.spec) return r.spec;
    }
  } catch {
    /* storage unavailable */
  }
  return defaultSpec();
}

function defaultName(spec: SearchSpec, registry: ReturnType<typeof useApp>["registry"]): string {
  const side = (tokens: string[]) =>
    tokens.length === 1 ? (placeInfo(tokens[0], registry)?.label ?? tokens[0]).replace(/ \([A-Z]{3}\)$/, "") : tokens.join(",");
  const m = monthName(+spec.depart.from.slice(5, 7) - 1).slice(0, 3);
  return `${side(spec.origins)} → ${side(spec.destinations)} ${m}`;
}

interface LocState {
  savedId?: string;
  savedName?: string;
}

export function SearchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { registry, reportError } = useApp();
  const fullPath = location.pathname + location.search;
  const locState = (location.state ?? {}) as LocState;

  const [spec, setSpec] = useState<SearchSpec>(() => initialSpec(fullPath));
  const [urlError, setUrlError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [resultTitle, setResultTitle] = useState<string | undefined>();
  const [notice, setNotice] = useState<{ text: string; link?: boolean; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastWritten = useRef<string | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const pathRef = useRef(fullPath);
  pathRef.current = fullPath;

  const job = useJob(
    (r) => {
      setResult(r);
      setResultTitle(undefined);
    },
    reportError,
  );

  // URL → form (back/forward, pasted URL, links).
  useEffect(() => {
    if (lastWritten.current !== null && safeDecode(fullPath) === safeDecode(lastWritten.current)) return;
    if (!location.pathname.startsWith("/search/")) return;
    const r = pathToSpec(fullPath);
    if (!r.spec) {
      setUrlError(r.error ?? "Couldn't read this search URL");
      return;
    }
    setUrlError(null);
    if (specToPath(r.spec) !== specToPath(specRef.current)) setSpec(r.spec);
  }, [fullPath, location.pathname]);

  // Form → URL (debounced) and remember the last search.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const path = isComplete(spec) ? specToPath(spec) : null;
      if (path && safeDecode(path) !== safeDecode(pathRef.current)) {
        lastWritten.current = path;
        navigate(path, { replace: true, state: location.state });
      }
      if (path) {
        try {
          localStorage.setItem(STORAGE_KEY, path);
        } catch {
          /* ignore */
        }
      }
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  // Opened from the Saved page: show that search's latest result.
  useEffect(() => {
    if (!locState.savedId) return;
    let cancelled = false;
    api
      .savedResult(locState.savedId)
      .then((r) => {
        if (cancelled) return;
        if (r) {
          setResult(r);
          setResultTitle(locState.savedName ? `${locState.savedName} — latest prices` : "Latest tracked prices");
        } else setNotice({ text: "No tracked prices yet for this search — run it now." });
      })
      .catch((e) => !cancelled && setNotice({ text: reportError(e), error: true }));
    return () => {
      cancelled = true;
    };
  }, [locState.savedId, locState.savedName, reportError]);

  const problems = useMemo(() => validateSpec(spec, registry), [spec, registry]);

  const onSave = async () => {
    const name = window.prompt("Name this tracked search", defaultName(spec, registry));
    if (!name) return;
    setSaving(true);
    try {
      await api.createSaved({ name, spec });
      setNotice({ text: `Saved “${name}”. Prices will refresh twice a day.`, link: true });
    } catch (e) {
      setNotice({ text: reportError(e), error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="search-page">
      <div className="search-col">
        {urlError && <div className="banner error">URL problem: {urlError}</div>}
        <SearchForm
          spec={spec}
          onChange={setSpec}
          problems={problems}
          running={job.running}
          progress={job.progress}
          onSearch={() => void job.start(() => api.search(spec))}
          onCancel={job.cancel}
          onSave={() => void onSave()}
          saving={saving}
        />
        {notice && (
          <div className={`banner${notice.error ? " error" : " ok"}`}>
            {notice.text} {notice.link && <Link to="/saved">View saved searches →</Link>}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}
        {job.error && <div className="banner error">Search failed: {job.error}</div>}
      </div>
      <div className="results-col">
        {result ? (
          <Results result={result} title={resultTitle} />
        ) : (
          <div className="hero card">
            <h2>Find the cheapest way there — even the long way round.</h2>
            <ul className="small">
              <li>
                Pick airport <strong>groups</strong>: <code>@north-england</code>, <code>@london</code>, <code>@punjab-pk</code>,{" "}
                <code>@vienna-bratislava</code>, whole countries or regions.
              </li>
              <li>Flexible departure and return date ranges, or a range of nights away.</li>
              <li>
                Add <strong>stopovers</strong> (stay 1–3 nights in Dubai or Istanbul) or self-transfer connections on separate
                tickets, with ground transfers between nearby airports.
              </li>
              <li>
                Type the whole search as text, or edit the URL directly — e.g.{" "}
                <code>MAN,LPL &gt; @punjab-pk 2026-12-01..2026-12-10 back 7-14 nights via @uae 1-2n</code>
              </li>
              <li>
                <strong>Save &amp; track</strong> to get prices refreshed twice a day with history.
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
