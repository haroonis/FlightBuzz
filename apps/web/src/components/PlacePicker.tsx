import { isValidToken, normalizeToken, placeInfo, searchPlaces, type PlaceInfo } from "@flightbuzz/core";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useApp } from "../context.tsx";

const KIND_LABEL: Record<PlaceInfo["kind"], string> = {
  airport: "Airport",
  country: "Country",
  region: "Region",
  group: "Group",
};

interface Props {
  label: string;
  tokens: string[];
  onChange: (tokens: string[]) => void;
  placeholder?: string;
  compact?: boolean;
}

export function PlacePicker({ label, tokens, onChange, placeholder, compact }: Props) {
  const { registry } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();

  const suggestions = useMemo(
    () => (query.trim() ? searchPlaces(query, registry, 10).filter((p) => !tokens.includes(p.token)) : []),
    [query, registry, tokens],
  );

  const add = (token: string) => {
    const t = normalizeToken(token);
    if (!tokens.includes(t)) onChange([...tokens, t]);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  const remove = (token: string) => onChange(tokens.filter((t) => t !== token));

  /** Accept "MAN,LPL" style typing/pasting of raw tokens. */
  const tryRawTokens = (text: string): boolean => {
    const parts = text.split(/[,\s]+/).map(normalizeToken).filter(Boolean);
    if (!parts.length || !parts.every((p) => isValidToken(p, registry))) return false;
    onChange([...tokens, ...parts.filter((p) => !tokens.includes(p))]);
    setQuery("");
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(suggestions.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      if (!query.trim()) return;
      if (query.includes(",") || e.key === ",") {
        if (tryRawTokens(query)) {
          e.preventDefault();
          return;
        }
      }
      const pick = suggestions[active];
      if (pick) {
        e.preventDefault();
        add(pick.token);
      } else if (tryRawTokens(query)) {
        e.preventDefault();
      }
    } else if (e.key === "Backspace" && !query && tokens.length) {
      remove(tokens[tokens.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`field place-picker${compact ? " compact" : ""}`}>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <div className="chip-input" onClick={() => inputRef.current?.focus()}>
        {tokens.map((t) => {
          const info = placeInfo(t, registry);
          return (
            <span
              key={t}
              className={`chip${info ? "" : " chip-bad"}`}
              title={info ? `${info.sublabel}\nAirports: ${info.airports.join(", ")}` : "Unknown place"}
            >
              <span className={`chip-kind kind-${info?.kind ?? "bad"}`}>{info ? KIND_LABEL[info.kind][0] : "?"}</span>
              {info?.label ?? t}
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${info?.label ?? t}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          id={inputId}
          ref={inputRef}
          value={query}
          placeholder={tokens.length ? "Add more…" : placeholder ?? "City, airport, country, @group"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="suggestions" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.token}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.token);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={`kind-badge kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="sugg-text">
                <span className="sugg-label">{s.label}</span>
                <span className="sugg-sub">{s.sublabel}</span>
              </span>
              <code className="sugg-token">{s.token}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
