import type { HistoryPoint } from "@flightbuzz/core";
import { money } from "../format.ts";

interface Props {
  history: HistoryPoint[];
  currency: string;
  width?: number;
  height?: number;
}

/** Price history chart: cheapest (solid) and best (dashed). */
export function Sparkline({ history, currency, width = 280, height = 72 }: Props) {
  const pts = history.filter((h) => h.cheapest !== null || h.best !== null);
  if (pts.length < 2) {
    return <div className="spark-empty small muted">History builds up after a few refreshes.</div>;
  }
  const values = pts.flatMap((p) => [p.cheapest, p.best]).filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = 6;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2));
  const line = (key: "cheapest" | "best") =>
    pts
      .map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key]!).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const last = pts[pts.length - 1];
  const first = new Date(pts[0].at).toLocaleDateString();
  const end = new Date(last.at).toLocaleDateString();
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`Price history from ${first} to ${end}`}>
        <line x1={pad} x2={width - pad} y1={y(lo)} y2={y(lo)} className="spark-grid" />
        <line x1={pad} x2={width - pad} y1={y(hi)} y2={y(hi)} className="spark-grid" />
        <polyline points={line("best")} className="spark-best" fill="none" />
        <polyline points={line("cheapest")} className="spark-cheap" fill="none" />
        {last.cheapest !== null && <circle cx={x(pts.length - 1)} cy={y(last.cheapest)} r={3} className="spark-dot" />}
        {pts.map((p, i) => (
          <rect key={i} x={x(i) - 4} y={0} width={8} height={height} fill="transparent">
            <title>
              {new Date(p.at).toLocaleString()} — cheapest {money(p.cheapest, currency)}, best {money(p.best, currency)}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className="small muted spark-legend">
        <span>
          <i className="sw cheap" /> cheapest
        </span>
        <span>
          <i className="sw best" /> best
        </span>
        <span>
          {money(lo, currency)}–{money(hi, currency)}
        </span>
        <span>
          {first} → {end}
        </span>
      </figcaption>
    </figure>
  );
}
