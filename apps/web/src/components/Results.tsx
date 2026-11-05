import { fmtDuration, type SearchResult, type StopBucket, type Trip } from "@flightbuzz/core";
import { useEffect, useMemo, useState } from "react";
import { money, relativeTime } from "../format.ts";
import { Segmented } from "./Segmented.tsx";
import { TripCard } from "./TripCard.tsx";

type Sort = "price" | "best" | "fastest";
type Only = null | "stopover" | "airport-change";
const BUCKETS: StopBucket[] = ["0", "1", "2", "3+"];
const PAGE = 30;

export function bucketOf(t: Trip): StopBucket {
  const s = Math.max(t.out.stops, t.back?.stops ?? 0);
  return s >= 3 ? "3+" : (String(s) as StopBucket);
}

const travel = (t: Trip) => t.out.travelMin + (t.back?.travelMin ?? (t.openReturn ? t.out.travelMin : 0));

export function Results({ result, title }: { result: SearchResult; title?: string }) {
  const { summary, spec } = result;
  const cur = summary.currency;
  const maxAll = useMemo(() => Math.ceil(Math.max(0, ...result.trips.map((t) => t.price))), [result]);
  const [sort, setSort] = useState<Sort>("price");
  const [buckets, setBuckets] = useState<Set<StopBucket>>(new Set(BUCKETS));
  const [allowSelf, setAllowSelf] = useState(true);
  const [allowStopover, setAllowStopover] = useState(true);
  const [allowChange, setAllowChange] = useState(true);
  const [only, setOnly] = useState<Only>(null);
  const [maxPrice, setMaxPrice] = useState(maxAll);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    setMaxPrice(maxAll);
    setShown(PAGE);
  }, [maxAll, result]);

  const reset = () => {
    setBuckets(new Set(BUCKETS));
    setAllowSelf(true);
    setAllowStopover(true);
    setAllowChange(true);
    setOnly(null);
    setMaxPrice(maxAll);
    setShown(PAGE);
  };

  const filtered = useMemo(() => {
    const list = result.trips.filter((t) => {
      if (!buckets.has(bucketOf(t))) return false;
      if (!allowSelf && t.tags.includes("self-transfer")) return false;
      if (!allowStopover && t.tags.includes("stopover")) return false;
      if (!allowChange && t.tags.includes("airport-change")) return false;
      if (only && !t.tags.includes(only)) return false;
      return t.price <= maxPrice;
    });
    const cmp: Record<Sort, (a: Trip, b: Trip) => number> = {
      price: (a, b) => a.price - b.price || a.score - b.score,
      best: (a, b) => a.score - b.score,
      fastest: (a, b) => travel(a) - travel(b) || a.price - b.price,
    };
    return list.sort(cmp[sort]);
  }, [result, buckets, allowSelf, allowStopover, allowChange, only, maxPrice, sort]);

  const fastestTrip = useMemo(() => [...result.trips].sort((a, b) => travel(a) - travel(b))[0], [result]);

  const tiles: { key: string; label: string; value: number | null; sub?: string; onClick: () => void; active: boolean }[] = [
    { key: "cheapest", label: "Cheapest", value: summary.cheapest, onClick: () => (reset(), setSort("price")), active: sort === "price" && !only && buckets.size === 4 },
    { key: "best", label: "Best", value: summary.best, onClick: () => (reset(), setSort("best")), active: sort === "best" && !only && buckets.size === 4 },
    {
      key: "fastest",
      label: "Fastest",
      value: summary.fastest,
      sub: fastestTrip ? fmtDuration(travel(fastestTrip)) : undefined,
      onClick: () => (reset(), setSort("fastest")),
      active: sort === "fastest" && !only && buckets.size === 4,
    },
    ...BUCKETS.map((b) => ({
      key: `b${b}`,
      label: b === "0" ? "Direct" : b === "3+" ? "3+ stops" : `${b} stop${b === "1" ? "" : "s"}`,
      value: summary.byStops[b],
      onClick: () => {
        reset();
        setBuckets(new Set([b]));
      },
      active: buckets.size === 1 && buckets.has(b) && !only,
    })),
    {
      key: "stopover",
      label: "With stopover",
      value: summary.stopover,
      onClick: () => {
        reset();
        setOnly("stopover");
      },
      active: only === "stopover",
    },
    {
      key: "change",
      label: "Airport change",
      value: summary.airportChange,
      onClick: () => {
        reset();
        setOnly("airport-change");
      },
      active: only === "airport-change",
    },
  ];

  const toggleBucket = (b: StopBucket) => {
    const next = new Set(buckets);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    setBuckets(next);
    setShown(PAGE);
  };

  return (
    <section className="results">
      <div className="results-head">
        <h2>{title ?? "Results"}</h2>
        <span className="muted small">
          {summary.tripCount} options · updated {relativeTime(result.finishedAt)}
        </span>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" className={`tile${t.active ? " active" : ""}`} onClick={t.onClick} disabled={t.value === null}>
            <span className="tile-label">{t.label}</span>
            <span className="tile-value">{money(t.value, cur)}</span>
            {t.sub && <span className="tile-sub">{t.sub}</span>}
          </button>
        ))}
      </div>

      <div className="filters card">
        <Segmented<Sort>
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "price", label: "Cheapest" },
            { value: "best", label: "Best" },
            { value: "fastest", label: "Fastest" },
          ]}
        />
        <div className="filter-group" role="group" aria-label="Stops">
          {BUCKETS.map((b) => (
            <label key={b} className="check">
              <input type="checkbox" checked={buckets.has(b)} onChange={() => toggleBucket(b)} />
              {b === "0" ? "Direct" : b === "3+" ? "3+" : b}
            </label>
          ))}
        </div>
        <div className="filter-group">
          <label className="check">
            <input type="checkbox" checked={allowSelf} onChange={(e) => setAllowSelf(e.target.checked)} /> Self-transfer
          </label>
          <label className="check">
            <input type="checkbox" checked={allowStopover} onChange={(e) => setAllowStopover(e.target.checked)} /> Stopovers
          </label>
          <label className="check">
            <input type="checkbox" checked={allowChange} onChange={(e) => setAllowChange(e.target.checked)} /> Airport changes
          </label>
        </div>
        {maxAll > 0 && (
          <label className="price-slider">
            <span className="small muted">Max {money(maxPrice, cur)}</span>
            <input
              type="range"
              min={Math.floor(summary.cheapest ?? 0)}
              max={maxAll}
              value={maxPrice}
              onChange={(e) => setMaxPrice(+e.target.value)}
            />
          </label>
        )}
        <span className="small muted count">
          {filtered.length} shown
          {filtered.length !== result.trips.length && (
            <>
              {" "}
              ·{" "}
              <button type="button" className="link-btn small" onClick={reset}>
                clear filters
              </button>
            </>
          )}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="empty card">
          <p>No trips match.</p>
          {result.trips.length === 0 && (
            <p className="small muted">
              Nothing came back from the providers. Try widening dates, allowing more stops, or adding a stopover hub.
            </p>
          )}
        </div>
      )}

      <div className="trip-list">
        {filtered.slice(0, shown).map((t) => (
          <TripCard key={t.id} trip={t} spec={spec} />
        ))}
      </div>
      {filtered.length > shown && (
        <button type="button" className="btn ghost wide" onClick={() => setShown(shown + PAGE)}>
          Show more ({filtered.length - shown} left)
        </button>
      )}

      <details className="search-details card">
        <summary>Search details</summary>
        <div className="details-grid">
          <div>
            <h4>Routes tried</h4>
            <ul>
              {result.routes.map((r) => (
                <li key={r.id}>
                  <span className="pill">{r.direction === "out" ? "Out" : "Back"}</span> {r.label}{" "}
                  <span className="muted small">· {r.journeys} journeys</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Stats</h4>
            <ul className="small">
              <li>{result.stats.requests} provider requests ({result.stats.cachedRequests} from cache)</li>
              {result.stats.skippedRequests > 0 && <li>{result.stats.skippedRequests} skipped (request budget)</li>}
              <li>{result.stats.fares} fares fetched</li>
              <li>{(result.stats.durationMs / 1000).toFixed(1)} s</li>
            </ul>
            {result.stats.errors.length > 0 && (
              <>
                <h4>Errors</h4>
                <ul className="small error">
                  {result.stats.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {result.stats.errors.length > 10 && <li>…and {result.stats.errors.length - 10} more</li>}
                </ul>
              </>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
