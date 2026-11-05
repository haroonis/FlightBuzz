import { addDays, daysBetween, fromDayNum, today, type DateRange } from "@flightbuzz/core";
import { useEffect, useRef, useState } from "react";
import { monthName, shortDate } from "../format.ts";

interface Props {
  label: string;
  value: DateRange;
  onChange: (r: DateRange) => void;
  minDate?: string;
}

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function monthOf(d: string): { y: number; m: number } {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7) - 1 };
}

function shiftMonth(v: { y: number; m: number }, n: number) {
  const t = v.y * 12 + v.m + n;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

function Month({
  y,
  m,
  range,
  hover,
  pickingEnd,
  minDate,
  onPick,
  onHover,
}: {
  y: number;
  m: number;
  range: DateRange;
  hover: string | null;
  pickingEnd: boolean;
  minDate: string;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
}) {
  const first = Math.round(Date.UTC(y, m, 1) / 86_400_000);
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; i < daysIn; i++) cells.push(fromDayNum(first + i));
  // Preview range while choosing the end date.
  const end = pickingEnd && hover && hover >= range.from ? hover : range.to;
  return (
    <div className="cal-month">
      <div className="cal-title">
        {monthName(m)} {y}
      </div>
      <div className="cal-grid">
        {WEEK.map((w) => (
          <div key={w} className="cal-wd">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const disabled = d < minDate;
          const inRange = d >= range.from && d <= end;
          const isEdge = d === range.from || d === end;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              className={`cal-day${inRange ? " in" : ""}${isEdge ? " edge" : ""}${d === today() ? " today" : ""}`}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              aria-label={shortDate(d)}
              aria-pressed={inRange}
            >
              {+d.slice(8, 10)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ label, value, onChange, minDate }: Props) {
  const [open, setOpen] = useState(false);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => monthOf(value.from));
  const ref = useRef<HTMLDivElement>(null);
  const min = minDate ?? today();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPickingEnd(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (d: string) => {
    if (!pickingEnd) {
      onChange({ from: d, to: d });
      setPickingEnd(true);
    } else {
      if (d < value.from) onChange({ from: d, to: value.from });
      else onChange({ from: value.from, to: d });
      setPickingEnd(false);
    }
  };

  const nights = daysBetween(value.from, value.to);
  const second = shiftMonth(view, 1);

  return (
    <div className="field date-field" ref={ref}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className="date-button"
        onClick={() => {
          if (!open) setView(monthOf(value.from));
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        <span>
          {shortDate(value.from)}
          {value.to !== value.from && <> – {shortDate(value.to)}</>}
        </span>
        <span className="muted small">{nights ? `${nights + 1} days` : "exact"}</span>
      </button>
      {open && (
        <div className="cal-pop" role="dialog" aria-label={`${label} calendar`}>
          <div className="cal-head">
            <button type="button" className="icon-btn" onClick={() => setView(shiftMonth(view, -1))} aria-label="Previous month">
              ‹
            </button>
            <span className="muted small">{pickingEnd ? "Now pick the latest date" : "Pick the earliest date"}</span>
            <button type="button" className="icon-btn" onClick={() => setView(shiftMonth(view, 1))} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="cal-months" onMouseLeave={() => setHover(null)}>
            <Month {...view} range={value} hover={hover} pickingEnd={pickingEnd} minDate={min} onPick={pick} onHover={setHover} />
            <div className="cal-second">
              <Month {...second} range={value} hover={hover} pickingEnd={pickingEnd} minDate={min} onPick={pick} onHover={setHover} />
            </div>
          </div>
          <div className="cal-foot">
            <div className="quick">
              {[0, 2, 6].map((n) => (
                <button key={n} type="button" className="link-btn" onClick={() => onChange({ from: value.from, to: addDays(value.from, n) })}>
                  {n === 0 ? "Exact day" : n === 2 ? "3 days" : "1 week"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setOpen(false);
                setPickingEnd(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
