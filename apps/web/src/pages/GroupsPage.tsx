import { BUILTIN_GROUPS, expandPlaces, placeInfo, type AirportGroup } from "@flightbuzz/core";
import { useMemo, useState } from "react";
import { api } from "../api.ts";
import { PlacePicker } from "../components/PlacePicker.tsx";
import { useApp } from "../context.tsx";

interface Draft {
  slug: string;
  name: string;
  members: string[];
  description: string;
  editing: boolean;
}

const empty: Draft = { slug: "", name: "", members: [], description: "", editing: false };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function GroupRow({ g, onEdit, onDelete }: { g: AirportGroup; onEdit?: () => void; onDelete?: () => void }) {
  const { registry } = useApp();
  const airports = expandPlaces([`@${g.slug}`], registry);
  return (
    <li className="group-row">
      <div>
        <strong>{g.name}</strong> <code className="small">@{g.slug}</code>
        {g.builtin ? <span className="pill">built-in</span> : <span className="pill tag-stopover">custom</span>}
        <div className="small muted">
          {g.members.map((m) => placeInfo(m, registry)?.label ?? m).join(" · ")}
          {airports.join(",") !== g.members.join(",") && <> — {airports.join(", ")}</>}
        </div>
        {g.description && <div className="small">{g.description}</div>}
      </div>
      <div className="row-actions">
        {onEdit && (
          <button type="button" className="btn ghost small" onClick={onEdit}>
            {g.builtin ? "Customise" : "Edit"}
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn danger small" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function GroupsPage() {
  const { meta, refreshMeta, reportError, serverDown, registry } = useApp();
  const [draft, setDraft] = useState<Draft>(empty);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = meta?.groups ?? BUILTIN_GROUPS;
  const custom = useMemo(() => groups.filter((g) => !g.builtin), [groups]);
  const builtin = useMemo(() => groups.filter((g) => g.builtin && !custom.some((c) => c.slug === g.slug)), [groups, custom]);

  const save = async () => {
    const slug = slugify(draft.slug || draft.name);
    if (!slug || !draft.name.trim() || !draft.members.length) {
      setErr("Give the group a name and at least one airport or place.");
      return;
    }
    if (draft.members.includes(`@${slug}`)) {
      setErr("A group can't contain itself.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.saveGroup({ slug, name: draft.name.trim(), members: draft.members, description: draft.description.trim() || undefined });
      setDraft(empty);
      await refreshMeta();
    } catch (e) {
      setErr(reportError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    if (!window.confirm(`Delete @${slug}? Saved searches using it will stop matching airports.`)) return;
    try {
      await api.deleteGroup(slug);
      await refreshMeta();
    } catch (e) {
      setErr(reportError(e));
    }
  };

  const edit = (g: AirportGroup) => {
    setDraft({ slug: g.slug, name: g.name, members: g.members, description: g.description ?? "", editing: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const previewAirports = expandPlaces(draft.members, registry);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Airport groups</h1>
        <span className="small muted">Use a group anywhere as @slug — e.g. from @north-england to @punjab-pk.</span>
      </div>

      <form
        className="card group-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{draft.editing ? `Edit @${draft.slug}` : "New group"}</h3>
        <div className="group-form-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={draft.name}
              placeholder="e.g. Yorkshire + Manchester"
              onChange={(e) => setDraft({ ...draft, name: e.target.value, slug: draft.editing ? draft.slug : slugify(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Slug</span>
            <input
              value={draft.slug}
              disabled={draft.editing}
              placeholder="yorkshire-manchester"
              onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })}
            />
            <span className="small muted">Reusing a built-in slug overrides it.</span>
          </label>
        </div>
        <PlacePicker label="Members (airports, countries, regions or other groups)" tokens={draft.members} onChange={(members) => setDraft({ ...draft, members })} />
        {previewAirports.length > 0 && <p className="small muted">Airports: {previewAirports.join(", ")}</p>}
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        {err && <p className="error small">{err}</p>}
        <div className="actions">
          {draft.editing && (
            <button type="button" className="btn ghost" onClick={() => setDraft(empty)}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || serverDown}>
            {draft.editing ? "Save group" : "Create group"}
          </button>
        </div>
      </form>

      {custom.length > 0 && (
        <section>
          <h2>Your groups</h2>
          <ul className="group-list card">
            {custom.map((g) => (
              <GroupRow key={g.slug} g={g} onEdit={() => edit(g)} onDelete={() => void remove(g.slug)} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Built-in groups</h2>
        <ul className="group-list card">
          {builtin.map((g) => (
            <GroupRow key={g.slug} g={g} onEdit={() => edit({ ...g, builtin: false })} />
          ))}
        </ul>
      </section>
    </div>
  );
}
