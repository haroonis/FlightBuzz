import type { Direction, StopoverPlan, StopoverStop } from "@flightbuzz/core";
import { PlacePicker } from "./PlacePicker.tsx";
import { Segmented } from "./Segmented.tsx";

interface Props {
  plans: StopoverPlan[];
  onChange: (plans: StopoverPlan[]) => void;
}

const newStop = (): StopoverStop => ({ places: [], minNights: 1, maxNights: 2 });

function clampInt(v: string, min = 0, max = 30): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function StopoverEditor({ plans, onChange }: Props) {
  const setPlan = (i: number, p: StopoverPlan) => onChange(plans.map((x, j) => (j === i ? p : x)));
  const setStop = (i: number, k: number, s: StopoverStop) =>
    setPlan(i, { ...plans[i], stops: plans[i].stops.map((x, j) => (j === k ? s : x)) });

  return (
    <div className="stopovers">
      <div className="section-head">
        <h3>Stopovers &amp; self-transfers</h3>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onChange([...plans, { direction: "both", stops: [newStop()] }])}
        >
          + Add stopover
        </button>
      </div>
      {!plans.length && (
        <p className="muted small">
          Route through a city on separate tickets — stay a night or two, or just connect (0 nights). Arriving at one airport
          and leaving from another in the same group (e.g. Abu Dhabi → Dubai) is handled with ground transfers.
        </p>
      )}
      {plans.map((plan, i) => (
        <div className="stopover-plan" key={i}>
          <div className="plan-head">
            <Segmented<Direction>
              label="Direction"
              value={plan.direction}
              onChange={(direction) => setPlan(i, { ...plan, direction })}
              options={[
                { value: "out", label: "Outbound" },
                { value: "back", label: "Return" },
                { value: "both", label: "Both" },
              ]}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove stopover plan"
              onClick={() => onChange(plans.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          {plan.stops.map((stop, k) => (
            <div className="stop-row" key={k}>
              {k > 0 && <div className="then">then</div>}
              <PlacePicker
                compact
                label={`Stop ${k + 1}`}
                tokens={stop.places}
                onChange={(places) => setStop(i, k, { ...stop, places })}
                placeholder="e.g. Dubai, @uae, Istanbul"
              />
              <div className="nights">
                <label>
                  <span className="field-label">Nights</span>
                  <span className="nights-inputs">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={stop.minNights}
                      aria-label="Minimum nights"
                      onChange={(e) => {
                        const minNights = clampInt(e.target.value);
                        setStop(i, k, { ...stop, minNights, maxNights: Math.max(minNights, stop.maxNights) });
                      }}
                    />
                    <span>–</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={stop.maxNights}
                      aria-label="Maximum nights"
                      onChange={(e) => {
                        const maxNights = clampInt(e.target.value);
                        setStop(i, k, { ...stop, maxNights, minNights: Math.min(maxNights, stop.minNights) });
                      }}
                    />
                  </span>
                </label>
                <span className="muted small nights-hint">
                  {stop.maxNights === 0
                    ? "self-transfer / connection only"
                    : stop.minNights === 0
                      ? "connect, or stay up to " + stop.maxNights + " night" + (stop.maxNights > 1 ? "s" : "")
                      : "stay over"}
                </span>
                {plan.stops.length > 1 && (
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() => setPlan(i, { ...plan, stops: plan.stops.filter((_, j) => j !== k) })}
                  >
                    remove stop
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="link-btn small"
            onClick={() => setPlan(i, { ...plan, stops: [...plan.stops, newStop()] })}
          >
            + then another stop
          </button>
        </div>
      ))}
    </div>
  );
}
