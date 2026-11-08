import type { Cabin, SearchSpec } from "@flightbuzz/core";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { Segmented } from "./Segmented.tsx";

interface Props {
  spec: SearchSpec;
  onChange: (patch: Partial<SearchSpec>) => void;
}

function num(v: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function OptionsPanel({ spec, onChange }: Props) {
  const { meta, currencies } = useApp();
  const pax = spec.passengers;
  const providers = meta?.providers ?? [];

  const toggleProvider = (id: string) => {
    // Empty list means "all enabled"; materialise it before toggling.
    const current = spec.providers.length ? spec.providers : providers.filter((p) => p.enabled && p.configured).map((p) => p.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange({ providers: next });
  };

  return (
    <div className="options">
      <div className="opt-grid">
        <div className="field">
          <span className="field-label">Max stops (each way)</span>
          <Segmented
            label="Max stops"
            value={spec.maxStops}
            onChange={(maxStops) => onChange({ maxStops })}
            options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 0 ? "Direct" : String(n) }))}
          />
        </div>

        <div className="field">
          <span className="field-label">Passengers</span>
          <div className="pax">
            {(["adults", "children", "infants"] as const).map((k) => (
              <label key={k} className="pax-item">
                <span className="small muted">{k}</span>
                <input
                  type="number"
                  min={k === "adults" ? 1 : 0}
                  max={9}
                  value={pax[k]}
                  onChange={(e) => onChange({ passengers: { ...pax, [k]: num(e.target.value, k === "adults" ? 1 : 0, 9) } })}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Cabin</span>
          <select value={spec.cabin} onChange={(e) => onChange({ cabin: e.target.value as Cabin })}>
            <option value="economy">Economy</option>
            <option value="premium">Premium economy</option>
            <option value="business">Business</option>
            <option value="first">First</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Checked bags per person</span>
          <select value={spec.holdBags ?? 0} onChange={(e) => onChange({ holdBags: Number(e.target.value) || undefined })}>
            <option value={0}>None</option>
            <option value={1}>1 bag</option>
            <option value={2}>2 bags</option>
          </select>
          <span className="small muted">Included in Kiwi prices. Google shows base fares.</span>
        </label>

        {spec.return.type !== "oneway" && (
          <label className="check field">
            <input
              type="checkbox"
              checked={!!spec.returnTicketsOnly}
              onChange={(e) => onChange({ returnTicketsOnly: e.target.checked || undefined })}
            />
            Return tickets only
            <span className="small muted block">Skips one-way and separate-ticket combinations: fewer pages, faster.</span>
          </label>
        )}

        <label className="field">
          <span className="field-label">Currency</span>
          <select value={spec.currency} onChange={(e) => onChange({ currency: e.target.value })}>
            {[...new Set([spec.currency, ...currencies])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Max connection (hours)</span>
          <input
            type="number"
            min={1}
            max={96}
            value={spec.maxLayoverHours}
            onChange={(e) => onChange({ maxLayoverHours: num(e.target.value, 1, 96) })}
          />
          <span className="small muted">Longer gaps only via planned stopovers</span>
        </label>

        <label className="field">
          <span className="field-label">Min self-transfer (minutes)</span>
          <input
            type="number"
            min={30}
            max={720}
            step={15}
            value={spec.minSelfTransferMinutes}
            onChange={(e) => onChange({ minSelfTransferMinutes: num(e.target.value, 30, 720) })}
          />
          <span className="small muted">Buffer between separate tickets</span>
        </label>

        <div className="field">
          <span className="field-label">Ground transfers</span>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.groundTransfers}
              onChange={(e) => onChange({ groundTransfers: e.target.checked })}
            />
            Allow changing airport (e.g. Bratislava → Vienna)
          </label>
          {spec.groundTransfers && (
            <label className="inline">
              <span className="small muted">up to</span>
              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                value={spec.maxGroundHours}
                onChange={(e) => onChange({ maxGroundHours: num(e.target.value, 0.5, 12) })}
              />
              <span className="small muted">hours</span>
            </label>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Providers</span>
        {!providers.length && <p className="small muted">Provider list loads from the server.</p>}
        <div className="providers">
          {providers.map((p) => {
            const checked = spec.providers.length ? spec.providers.includes(p.id) : p.enabled && p.configured;
            return (
              <label key={p.id} className={`provider${p.configured ? "" : " off"}`} title={p.note}>
                <input type="checkbox" checked={checked} disabled={!p.configured} onChange={() => toggleProvider(p.id)} />
                <span>
                  <strong>{p.name}</strong>
                  <span className={`status ${p.configured ? "ok" : "no"}`}>{p.configured ? "ready" : "not configured"}</span>
                  <span className="small muted block">{p.note}</span>
                </span>
              </label>
            );
          })}
        </div>
        {meta?.browser && meta.browser.mode !== "off" && (
          <p className="small muted">
            Browser window ({meta.browser.mode}). Open a site to accept its cookies or do its robot check once:{" "}
            {(["google", "skyscanner", "kiwi"] as const).map((site) => (
              <button key={site} type="button" className="link-btn small" onClick={() => void api.openBrowser(site).catch(() => undefined)}>
                {site === "google" ? "Google Flights" : site === "skyscanner" ? "Skyscanner" : "Kiwi"}
              </button>
            ))}
          </p>
        )}
        {spec.providers.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange({ providers: [] })}>
            Use all enabled providers
          </button>
        )}
      </div>
    </div>
  );
}
