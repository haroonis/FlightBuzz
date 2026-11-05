import { addDays, type ReturnSpec, type SearchSpec, type SpecProblem } from "@flightbuzz/core";
import { useState } from "react";
import { DateRangePicker } from "./DateRangePicker.tsx";
import { OptionsPanel } from "./OptionsPanel.tsx";
import { PlacePicker } from "./PlacePicker.tsx";
import { QueryBar } from "./QueryBar.tsx";
import { Segmented } from "./Segmented.tsx";
import { StopoverEditor } from "./StopoverEditor.tsx";

interface Props {
  spec: SearchSpec;
  onChange: (spec: SearchSpec) => void;
  problems: SpecProblem[];
  running: boolean;
  progress: { done: number; total: number } | null;
  onSearch: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}

export function SearchForm({ spec, onChange, problems, running, progress, onSearch, onCancel, onSave, saving }: Props) {
  const [showMore, setShowMore] = useState(false);
  const patch = (p: Partial<SearchSpec>) => onChange({ ...spec, ...p });
  const complete = spec.origins.length > 0 && spec.destinations.length > 0;
  const problemFor = (field: string) => problems.filter((p) => p.field === field || p.field.startsWith(field + "."));

  const setReturnType = (type: ReturnSpec["type"]) => {
    if (type === spec.return.type) return;
    if (type === "oneway") patch({ return: { type } });
    else if (type === "nights") patch({ return: { type, min: 7, max: 14 } });
    else patch({ return: { type, range: { from: addDays(spec.depart.from, 7), to: addDays(spec.depart.to, 14) } } });
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <form
      className="search-form card"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <div className="places-row">
        <PlacePicker label="From" tokens={spec.origins} onChange={(origins) => patch({ origins })} />
        <button
          type="button"
          className="swap"
          aria-label="Swap origin and destination"
          title="Swap"
          onClick={() => patch({ origins: spec.destinations, destinations: spec.origins })}
        >
          ⇄
        </button>
        <PlacePicker label="To" tokens={spec.destinations} onChange={(destinations) => patch({ destinations })} />
      </div>
      {[...problemFor("origins"), ...problemFor("destinations")].map((p, i) => (
        <p key={i} className="error small">
          {p.field === "origins" ? "From" : "To"}: {p.message}
        </p>
      ))}

      <div className="dates-row">
        <div>
          <DateRangePicker label="Departure" value={spec.depart} onChange={(depart) => patch({ depart })} />
          {problemFor("depart").map((p, i) => (
            <p key={i} className="error small">
              {p.message}
            </p>
          ))}
        </div>
        <div className="return-block">
          <span className="field-label">Return</span>
          <Segmented<ReturnSpec["type"]>
            label="Return type"
            value={spec.return.type}
            onChange={setReturnType}
            options={[
              { value: "oneway", label: "One-way" },
              { value: "dates", label: "Return dates" },
              { value: "nights", label: "Nights away" },
            ]}
          />
          {spec.return.type === "dates" && (
            <DateRangePicker
              label="Return between"
              value={spec.return.range}
              minDate={spec.depart.from}
              onChange={(range) => patch({ return: { type: "dates", range } })}
            />
          )}
          {spec.return.type === "nights" && (
            <div className="nights-range">
              <label>
                <span className="small muted">min nights</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={spec.return.min}
                  onChange={(e) => {
                    const min = Math.max(0, Math.round(+e.target.value || 0));
                    const max = spec.return.type === "nights" ? Math.max(min, spec.return.max) : min;
                    patch({ return: { type: "nights", min, max } });
                  }}
                />
              </label>
              <span>–</span>
              <label>
                <span className="small muted">max nights</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={spec.return.max}
                  onChange={(e) => {
                    const max = Math.max(0, Math.round(+e.target.value || 0));
                    const min = spec.return.type === "nights" ? Math.min(max, spec.return.min) : max;
                    patch({ return: { type: "nights", min, max } });
                  }}
                />
              </label>
            </div>
          )}
          {problemFor("return").map((p, i) => (
            <p key={i} className="error small">
              {p.message}
            </p>
          ))}
        </div>
      </div>

      <StopoverEditor plans={spec.stopovers} onChange={(stopovers) => patch({ stopovers })} />
      {problemFor("stopovers").map((p, i) => (
        <p key={i} className="error small">
          {p.message}
        </p>
      ))}

      <button type="button" className="disclosure" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
        {showMore ? "▾" : "▸"} More options
        <span className="muted small">
          {" "}
          · {spec.maxStops === 0 ? "direct" : `≤${spec.maxStops} stops`} · {spec.passengers.adults + spec.passengers.children + spec.passengers.infants} pax ·{" "}
          {spec.cabin} · {spec.holdBags ? `${spec.holdBags} checked bag${spec.holdBags > 1 ? "s" : ""} each` : "no checked bags"} · {spec.currency}
        </span>
      </button>
      {showMore && <OptionsPanel spec={spec} onChange={patch} />}
      {problemFor("passengers").concat(problemFor("maxStops")).map((p, i) => (
        <p key={i} className="error small">
          {p.message}
        </p>
      ))}

      <QueryBar spec={spec} complete={complete} onSpec={onChange} />

      <div className="actions">
        {running ? (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Stop waiting
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={onSave} disabled={!complete || problems.length > 0 || saving}>
          {saving ? "Saving…" : "Save & track"}
        </button>
        <button type="submit" className="btn primary" disabled={running || problems.length > 0}>
          {running ? "Searching…" : "Search"}
        </button>
      </div>
      {running && (
        <div className="progress" aria-live="polite">
          <div className="bar">
            <div className="fill" style={{ width: `${pct ?? 5}%` }} />
          </div>
          <span className="small muted">
            {progress && progress.total ? `${progress.done} / ${progress.total} price requests` : "Planning routes…"}
          </span>
        </div>
      )}
    </form>
  );
}
