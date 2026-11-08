import type { ProviderInfo } from "@flightbuzz/core";
import { config } from "../config.ts";
import { demoProvider } from "./demo.ts";
import { googleGate, googleProvider } from "./google.ts";
import { kiwiGate, kiwiProvider } from "./kiwi.ts";
import { skyscannerGate, skyscannerProvider } from "./skyscanner.ts";
import type { FlightProvider } from "./types.ts";

/** Every provider FlightBuzz knows. Kayak is deep links only (see docs/DATA_SOURCES.md). */
export const ALL_PROVIDERS: FlightProvider[] = [googleProvider, kiwiProvider, skyscannerProvider, demoProvider];

const GATES: Record<string, { note(): string }> = { google: googleGate, kiwi: kiwiGate, skyscanner: skyscannerGate };

async function isEnabled(p: FlightProvider, realConfigured: boolean): Promise<boolean> {
  if (config.providers.length) return config.providers.includes(p.id);
  if (p.id === "demo") return config.demo ?? !realConfigured;
  // Google Flights is the source by default; the others only when asked for.
  if (p.id === "kiwi" || p.id === "skyscanner") return false;
  return !!(await p.configured());
}

export async function providerInfo(): Promise<ProviderInfo[]> {
  const configured = await Promise.all(ALL_PROVIDERS.map(async (p) => !!(await p.configured())));
  const realConfigured = ALL_PROVIDERS.some((p, i) => p.id !== "demo" && configured[i]);
  return Promise.all(
    ALL_PROVIDERS.map(async (p, i) => ({
      id: p.id,
      name: p.name,
      configured: configured[i],
      enabled: configured[i] && (await isEnabled(p, realConfigured)),
      capabilities: p.capabilities,
      note: GATES[p.id] ? `${p.note} ${GATES[p.id].note()}` : p.note,
    })),
  );
}

/** Providers to use for a search: the requested ids, else every enabled one. */
export async function providersFor(requested: string[]): Promise<FlightProvider[]> {
  const info = await providerInfo();
  const pairs = ALL_PROVIDERS.map((p, i) => ({ p, info: info[i] }));
  if (requested.length) return pairs.filter((x) => x.info.configured && requested.includes(x.p.id)).map((x) => x.p);
  return pairs.filter((x) => x.info.enabled).map((x) => x.p);
}

