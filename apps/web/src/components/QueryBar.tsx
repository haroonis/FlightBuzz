import { formatDsl, parseDsl, pathToSpec, specToPath, type SearchSpec } from "@flightbuzz/core";
import { useEffect, useState } from "react";

interface Props {
  spec: SearchSpec;
  complete: boolean;
  onSpec: (spec: SearchSpec) => void;
}

/** Editable one-line text query and URL for the current search. */
export function QueryBar({ spec, complete, onSpec }: Props) {
  const dsl = complete ? formatDsl(spec) : "";
  const url = complete ? window.location.origin + specToPath(spec) : "";
  const [text, setText] = useState(dsl);
  const [textErr, setTextErr] = useState<string | null>(null);
  const [urlText, setUrlText] = useState(url);
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const [editingText, setEditingText] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editingText) setText(dsl);
  }, [dsl, editingText]);
  useEffect(() => {
    if (!editingUrl) setUrlText(url);
  }, [url, editingUrl]);

  const applyText = () => {
    setEditingText(false);
    if (text.trim() === dsl) return setTextErr(null);
    const r = parseDsl(text);
    if (r.spec) {
      setTextErr(null);
      onSpec(r.spec);
    } else setTextErr(r.error ?? "Couldn't parse");
  };

  const applyUrl = () => {
    setEditingUrl(false);
    if (urlText.trim() === url) return setUrlErr(null);
    const r = pathToSpec(urlText);
    if (r.spec) {
      setUrlErr(null);
      onSpec(r.spec);
    } else setUrlErr(r.error ?? "Couldn't parse");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="query-bar">
      <label className="field">
        <span className="field-label">Text query</span>
        <textarea
          className="mono"
          rows={2}
          value={text}
          placeholder="MAN,LPL > @punjab-pk 2026-12-01..2026-12-10 back 7-14 nights stops 2 via @uae 1-2n"
          onFocus={() => setEditingText(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={applyText}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          spellCheck={false}
        />
        {textErr && <span className="error small">{textErr}</span>}
      </label>
      <label className="field">
        <span className="field-label">Search URL</span>
        <div className="url-row">
          <input
            className="mono"
            value={urlText}
            placeholder="/search/MAN/LHE/2026-12-01_2026-12-07/no-return"
            onFocus={() => setEditingUrl(true)}
            onChange={(e) => setUrlText(e.target.value)}
            onBlur={applyUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            spellCheck={false}
          />
          <button type="button" className="btn ghost small" onClick={copy} disabled={!url}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {urlErr && <span className="error small">{urlErr}</span>}
      </label>
    </div>
  );
}
