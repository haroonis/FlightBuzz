import type { FastifyInstance } from "fastify";
import {
  BUILTIN_GROUPS,
  knownCurrencies,
  searchPlaces,
  tokenKind,
  validateSpec,
  type AirportGroup,
  type MetaResponse,
  type SavedSearchInput,
  type SearchSpec,
} from "@flightbuzz/core";
import { config } from "./config.ts";
import { createSaved, deleteGroup, deleteSaved, getSaved, latestResult, listGroups, listSaved, putGroup, updateSaved } from "./db.ts";
import { getJob, startJob } from "./jobs.ts";
import { providerInfo } from "./providers/index.ts";
import { registry } from "./search.ts";

export async function routes(app: FastifyInstance): Promise<void> {
  // Errors as { error: "message" }.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: err.message });
  });
  const bad = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 });
  const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });
  const checkSpec = (spec: SearchSpec | undefined) => {
    if (!spec) throw bad("Missing spec");
    const problems = validateSpec(spec, registry());
    if (problems.length) throw bad(problems.map((p) => p.message).join("; "));
  };

  app.get("/api/meta", async (): Promise<MetaResponse> => {
    const custom = listGroups();
    const customSlugs = new Set(custom.map((g) => g.slug));
    return {
      providers: await providerInfo(),
      groups: [...BUILTIN_GROUPS.filter((g) => !customSlugs.has(g.slug)), ...custom],
      schedule: config.schedule,
      timezone: config.timezone,
      currencies: knownCurrencies(),
    };
  });

  app.get<{ Querystring: { q?: string } }>("/api/places", async (req) => searchPlaces(req.query.q ?? "", registry()));

  // ---- groups ----
  app.get("/api/groups", async () => registry().all());

  app.put<{ Params: { slug: string }; Body: Partial<AirportGroup> }>("/api/groups/:slug", async (req) => {
    const slug = req.params.slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw bad("Slug may contain a-z, 0-9 and dashes");
    const members = (req.body.members ?? []).map((m) => m.trim()).filter(Boolean);
    if (!members.length) throw bad("A group needs at least one member");
    for (const m of members) if (!tokenKind(m.startsWith("@") ? m.toLowerCase() : m.toUpperCase())) throw bad(`Bad member "${m}"`);
    const group: AirportGroup = { slug, name: req.body.name?.trim() || slug, members, description: req.body.description };
    putGroup(group);
    return group;
  });

  app.delete<{ Params: { slug: string } }>("/api/groups/:slug", async (req) => {
    if (!deleteGroup(req.params.slug)) throw notFound();
    return { ok: true };
  });

  // ---- one-off searches ----
  app.post<{ Body: { spec: SearchSpec } }>("/api/search", async (req) => {
    checkSpec(req.body?.spec);
    return { jobId: startJob(req.body.spec) };
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req) => {
    const job = getJob(req.params.id);
    if (!job) throw notFound();
    return job;
  });

  // ---- saved searches ----
  app.get("/api/saved", async () => listSaved());

  app.post<{ Body: SavedSearchInput }>("/api/saved", async (req) => {
    checkSpec(req.body?.spec);
    const saved = createSaved(req.body.name?.trim() || "Untitled search", req.body.spec, req.body.active ?? true);
    startJob(saved.spec, saved.id); // first prices right away
    return saved;
  });

  app.get<{ Params: { id: string } }>("/api/saved/:id", async (req) => getSaved(req.params.id) ?? Promise.reject(notFound()));

  app.put<{ Params: { id: string }; Body: Partial<SavedSearchInput> }>("/api/saved/:id", async (req) => {
    if (req.body.spec) checkSpec(req.body.spec);
    const s = updateSaved(req.params.id, req.body);
    if (!s) throw notFound();
    return s;
  });

  app.delete<{ Params: { id: string } }>("/api/saved/:id", async (req) => {
    if (!deleteSaved(req.params.id)) throw notFound();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/saved/:id/run", async (req) => {
    const s = getSaved(req.params.id);
    if (!s) throw notFound();
    return { jobId: startJob(s.spec, s.id) };
  });

  app.get<{ Params: { id: string } }>("/api/saved/:id/result", async (req) => {
    if (!getSaved(req.params.id)) throw notFound();
    return latestResult(req.params.id) ?? null;
  });
}
