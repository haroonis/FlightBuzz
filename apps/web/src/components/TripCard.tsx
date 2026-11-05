import {
  datePart,
  daysBetween,
  fareLinks,
  fmtDuration,
  localMinutes,
  type Journey,
  type SearchSpec,
  type Segment,
  type Step,
  type Trip,
  type TripTag,
} from "@flightbuzz/core";
import { Fragment, useState } from "react";
import { cityName, hhmm, money, shortDate, airportName } from "../format.ts";

const TAG_LABEL: Record<TripTag, string> = {
  direct: "Direct",
  "self-transfer": "Self-transfer",
  stopover: "Stopover",
  "airport-change": "Airport change",
  "open-jaw": "Open-jaw",
  "overnight-layover": "Overnight layover",
  "multi-provider": "Mixed providers",
  "return-ticket": "Return ticket",
};

/** Return included in a return ticket; the flight itself is picked on Google. */
function OpenReturnSummary({ trip }: { trip: Trip }) {
  const r = trip.openReturn!;
  const link = trip.fares[0]?.deepLink;
  return (
    <div className="journey-summary open-return">
      <div className="js-label">
        <span className="dir">Return</span>
        <span className="muted small">{shortDate(`${r.date}T00:00`)}</span>
      </div>
      <p className="small muted">
        {r.from.join("/")} → {r.to.join("/")} · included in this return ticket. Pick the flight on{" "}
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Google Flights
          </a>
        ) : (
          "Google Flights"
        )}
        ; the price shown is the cheapest return for that date.
      </p>
    </div>
  );
}

function plusDays(from: string, to: string): string {
  const d = daysBetween(datePart(from), datePart(to));
  return d > 0 ? `+${d}` : "";
}

function carriers(j: Journey): string[] {
  const set = new Set<string>();
  for (const s of j.steps) if (s.type === "flight") for (const seg of s.slice.segments) set.add(seg.carrierName ?? seg.carrier);
  return [...set];
}

function stopsLabel(j: Journey): string {
  if (j.stops === 0) return "Direct";
  const via: string[] = [];
  for (const s of j.steps) {
    if (s.type === "flight") s.slice.segments.slice(1).forEach((seg) => via.push(seg.from));
    else if (s.type === "layover") via.push(s.at);
  }
  return `${j.stops} stop${j.stops > 1 ? "s" : ""} · ${via.join(", ")}`;
}

function JourneySummary({ j, label }: { j: Journey; label: string }) {
  return (
    <div className="journey-summary">
      <div className="js-label">
        <span className="dir">{label}</span>
        <span className="muted small">{shortDate(j.departLocal)}</span>
      </div>
      <div className="js-times">
        <div className="js-end">
          <span className="time">{hhmm(j.departLocal)}</span>
          <span className="code" title={airportName(j.from)}>
            {j.from}
          </span>
        </div>
        <div className="js-line">
          <span className="small muted">{fmtDuration(j.elapsedMin)}</span>
          <span className="line">
            {j.steps
              .filter((s) => s.type === "layover")
              .map((_, i) => (
                <i key={i} />
              ))}
          </span>
          <span className={`small ${j.stops === 0 ? "ok" : "muted"}`}>{stopsLabel(j)}</span>
        </div>
        <div className="js-end right">
          <span className="time">
            {hhmm(j.arriveLocal)}
            <sup>{plusDays(j.departLocal, j.arriveLocal)}</sup>
          </span>
          <span className="code" title={airportName(j.to)}>
            {j.to}
          </span>
        </div>
      </div>
      <div className="small muted js-carriers">
        {cityName(j.from)} → {cityName(j.to)} · {carriers(j).join(", ")}
        {j.stopoverNights > 0 && ` · ${j.stopoverNights} night${j.stopoverNights > 1 ? "s" : ""} stopover`}
      </div>
    </div>
  );
}

function SegmentRow({ seg }: { seg: Segment }) {
  return (
    <div className="seg">
      <div className="seg-times">
        <strong>{hhmm(seg.departLocal)}</strong> {seg.from}
        <span className="muted"> → </span>
        <strong>
          {hhmm(seg.arriveLocal)}
          <sup>{plusDays(seg.departLocal, seg.arriveLocal)}</sup>
        </strong>{" "}
        {seg.to}
      </div>
      <div className="small muted">
        {shortDate(seg.departLocal)} · {cityName(seg.from)} → {cityName(seg.to)} · {fmtDuration(seg.durationMin)} ·{" "}
        {seg.carrierName ?? seg.carrier}
        {seg.flightNo ? ` ${seg.flightNo}` : ""}
      </div>
    </div>
  );
}

function Connection({ a, b }: { a: Segment; b: Segment }) {
  const gap = localMinutes(b.departLocal) - localMinutes(a.arriveLocal);
  const overnight = datePart(a.arriveLocal) !== datePart(b.departLocal);
  const long = gap > 6 * 60;
  return (
    <div className={`layover connection${long ? " warn" : ""}`}>
      Connection in {cityName(a.to)} ({a.to}) · {fmtDuration(gap)}
      {long && <span className="pill warn">long layover</span>}
      {overnight && <span className="pill">overnight</span>}
      {a.to !== b.from && <span className="pill warn">change airport {a.to}→{b.from}</span>}
    </div>
  );
}

function StepRow({ step, currency }: { step: Step; currency: string }) {
  if (step.type === "flight") {
    const segs = step.slice.segments;
    return (
      <div className="ticket-block">
        <div className="small muted ticket-head">Ticket · {step.provider}</div>
        {segs.map((seg, i) => (
          <Fragment key={i}>
            {i > 0 && <Connection a={segs[i - 1]} b={seg} />}
            <SegmentRow seg={seg} />
          </Fragment>
        ))}
      </div>
    );
  }
  if (step.type === "layover") {
    if (step.kind === "stopover")
      return (
        <div className="layover stopover">
          🏨 Stopover in {cityName(step.at.split("→")[0])} · {step.nights} night{step.nights > 1 ? "s" : ""} ({fmtDuration(step.minutes)})
        </div>
      );
    return (
      <div className="layover self">
        ⚠ Self-transfer at {step.at} · {fmtDuration(step.minutes)} (separate tickets — collect bags &amp; check in again)
        {step.overnight && <span className="pill">overnight</span>}
      </div>
    );
  }
  const t = step.transfer;
  return (
    <div className="layover ground">
      🚌 Ground transfer {t.from} → {t.to} · {t.mode} · ~{fmtDuration(t.minutes)} · {money(step.price, currency)}
      {t.estimated && <span className="pill">estimated</span>}
      {t.note && <span className="small muted"> · {t.note}</span>}
    </div>
  );
}

export function TripCard({ trip, spec }: { trip: Trip; spec: SearchSpec }) {
  const [open, setOpen] = useState(false);
  const ground = [trip.out, trip.back].flatMap((j) => j?.steps ?? []).filter((s) => s.type === "ground");
  return (
    <article className="trip card">
      <div className="trip-main" onClick={() => setOpen(!open)}>
        <div className="trip-journeys">
          <JourneySummary j={trip.out} label="Outbound" />
          {trip.back && <JourneySummary j={trip.back} label="Return" />}
          {!trip.back && trip.openReturn && <OpenReturnSummary trip={trip} />}
        </div>
        <div className="trip-price">
          <div className="price">{money(trip.price, trip.currency)}</div>
          <div className="small muted">
            {trip.fares.length} ticket{trip.fares.length > 1 ? "s" : ""}
          </div>
          <div className="tags">
            {trip.tags.map((t) => (
              <span key={t} className={`pill tag-${t}`}>
                {TAG_LABEL[t]}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="link-btn small"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      {open && (
        <div className="trip-details">
          {[
            { j: trip.out, label: "Outbound" },
            ...(trip.back ? [{ j: trip.back, label: "Return" }] : []),
          ].map(({ j, label }) => (
            <section key={label} className="dir-details">
              <h4>
                {label} · {shortDate(j.departLocal)} · {fmtDuration(j.elapsedMin)} total
                {j.travelMin !== j.elapsedMin && <span className="muted small"> ({fmtDuration(j.travelMin)} travelling)</span>}
              </h4>
              {j.steps.map((s, i) => (
                <StepRow key={i} step={s} currency={trip.currency} />
              ))}
            </section>
          ))}
          <section className="tickets">
            <h4>Tickets</h4>
            {trip.fares.map((f) => (
              <div key={f.id} className="fare">
                <div className="fare-head">
                  <span>
                    <strong>{f.slices.map((s) => `${s.from}→${s.to}`).join(" / ")}</strong>{" "}
                    <span className="muted small">
                      {shortDate(f.slices[0].departLocal)} · via {f.provider}
                    </span>
                  </span>
                  <strong>{money(f.price, f.currency)}</strong>
                </div>
                <div className="fare-links">
                  {f.deepLink && (
                    <a className="btn primary small" href={f.deepLink} target="_blank" rel="noreferrer">
                      Book
                    </a>
                  )}
                  {fareLinks(f, spec.passengers, spec.cabin).map((l) => (
                    <a key={l.site} className={`site-link site-${l.site}`} href={l.url} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {ground.length > 0 && <p className="small muted">Price includes estimated ground transfer costs.</p>}
          </section>
        </div>
      )}
    </article>
  );
}
