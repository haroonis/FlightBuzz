import { formatDsl, type ResultSummary, type SavedSearch, type StopBucket } from "@flightbuzz/core";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { Sparkline } from "../components/Sparkline.tsx";
import { useApp } from "../context.tsx";
import { money, nextScheduled, relativeTime } from "../format.ts";
import { useJob } from "../useJob.ts";

function Delta({ now, prev, currency }: { now: number | null; prev: number | null | undefined; currency: string }) {
  if (now === null || prev === null || prev === undefined || now === prev) return null;
  const down = now < prev;
  return (
    <span className={`delta ${down ? "down" : "up"}`} title={`was ${money(prev, currency)}`}>
      {down ? "▼" : "▲"} {money(Math.abs(now - prev), currency)}
    </span>
  );
}

const BUCKET_LABEL: [StopBucket, string][] = [
  ["0", "Direct"],
  ["1", "1 stop"],
  ["2", "2 stops"],
  ["3+", "3+"],
];

function BucketTable({ s }: { s: ResultSummary }) {
  return (
    <table className="bucket-table">
      <thead>
        <tr>
          {BUCKET_LABEL.map(([, l]) => (
            <th key={l}>{l}</th>
          ))}
          <th>Stopover</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          {BUCKET_LABEL.map(([b]) => (
            <td key={b}>{money(s.byStops[b], s.currency)}</td>
          ))}
          <td>{money(s.stopover, s.currency)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function SavedCard({ item, onChanged }: { item: SavedSearch; onChanged: () => void }) {
  const { meta, reportError } = useApp();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const job = useJob(() => onChanged(), reportError);
  const s = item.latest;
  const cur = s?.currency ?? item.spec.currency;
  const prev = item.history.length >= 2 ? item.history[item.history.length - 2] : undefined;

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(reportError(e));
    }
  };

  return (
    <article className={`saved card${item.active ? "" : " paused"}`}>
      <div className="saved-head">
        <div>
          <h3>{item.name}</h3>
          <code className="small mono dsl">{formatDsl(item.spec)}</code>
        </div>
        {!item.active && <span className="pill">paused</span>}
      </div>

      <div className="saved-body">
        <div className="saved-prices">
          <div>
            <span className="small muted">Cheapest</span>
            <div className="big">
              {money(s?.cheapest, cur)} <Delta now={s?.cheapest ?? null} prev={prev?.cheapest} currency={cur} />
            </div>
          </div>
          <div>
            <span className="small muted">Best</span>
            <div className="big">
              {money(s?.best, cur)} <Delta now={s?.best ?? null} prev={prev?.best} currency={cur} />
            </div>
          </div>
        </div>
        {s && <BucketTable s={s} />}
        <Sparkline history={item.history} currency={cur} />
      </div>

      <div className="small muted saved-meta">
        Checked {relativeTime(item.lastRunAt)}
        {item.active && meta?.schedule.length ? ` · next ${nextScheduled(meta.schedule, meta.timezone)}` : ""}
        {s ? ` · ${s.tripCount} options` : ""}
      </div>

      {job.running && (
        <div className="progress">
          <div className="bar">
            <div
              className="fill"
              style={{ width: `${job.progress?.total ? Math.round((job.progress.done / job.progress.total) * 100) : 5}%` }}
            />
          </div>
          <span className="small muted">Refreshing…</span>
        </div>
      )}
      {(err || job.error) && <p className="error small">{err ?? job.error}</p>}

      <div className="saved-actions">
        <button
          type="button"
          className="btn primary small"
          onClick={() => navigate(item.path, { state: { savedId: item.id, savedName: item.name } })}
        >
          Open
        </button>
        <button type="button" className="btn ghost small" disabled={job.running} onClick={() => void job.start(() => api.runSaved(item.id))}>
          Run now
        </button>
        <button type="button" className="btn ghost small" onClick={() => void act(() => api.updateSaved(item.id, { active: !item.active }))}>
          {item.active ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            const name = window.prompt("Rename", item.name);
            if (name && name !== item.name) void act(() => api.updateSaved(item.id, { name }));
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn danger small"
          onClick={() => {
            if (window.confirm(`Delete “${item.name}” and its price history?`)) void act(() => api.deleteSaved(item.id));
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export function SavedPage() {
  const { meta, reportError } = useApp();
  const [items, setItems] = useState<SavedSearch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.saved());
      setErr(null);
    } catch (e) {
      setErr(reportError(e));
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tracked searches</h1>
        {meta && (
          <span className="small muted">
            Refreshed automatically at {meta.schedule.join(" and ")} ({meta.timezone})
          </span>
        )}
      </div>
      {err && <div className="banner error">{err}</div>}
      {items === null && !err && <p className="muted">Loading…</p>}
      {items?.length === 0 && (
        <div className="empty card">
          <h3>Nothing tracked yet</h3>
          <p className="muted">
            Set up a search, then press <strong>Save &amp; track</strong>. FlightBuzz re-checks every tracked search twice a day
            and keeps a price history, so you can see the cheapest direct, 1-stop, 2-stop and stopover options moving over time.
          </p>
        </div>
      )}
      <div className="saved-list">
        {items?.map((it) => (
          <SavedCard key={it.id} item={it} onChanged={() => void load()} />
        ))}
      </div>
    </div>
  );
}
