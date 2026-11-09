import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { closeBrowser } from "./browser/session.ts";
import { config } from "./config.ts";
import { providerInfo } from "./providers/index.ts";
import { routes } from "./routes.ts";
import { startScheduler } from "./scheduler.ts";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, bodyLimit: 1_000_000 });

await app.register(routes);

// Serve the built web app (npm run build) from the same port.
if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: config.port, host: config.host });
const providers = await providerInfo();
console.log(`FlightBuzz API on http://${config.host}:${config.port}`);
console.log(`Providers: ${providers.map((p) => `${p.id}${p.enabled ? " ✓" : p.configured ? " (available)" : " ✗"}`).join(", ")}`);
startScheduler();

// Shut down cleanly (the open browser window would otherwise keep the process alive).
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal}: closing the browser window and stopping`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await Promise.allSettled([closeBrowser(), app.close()]);
    process.exit(0);
  });
}
