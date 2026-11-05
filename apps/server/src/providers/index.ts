import type { ProviderInfo } from "@flightbuzz/core";
import { config } from "../config.ts";
import { demoProvider } from "./demo.ts";
import { googleProvider, googleStatus } from "./google.ts";
import { kiwiProvider } from "./kiwi.ts";
import type { FlightProvider } from "./types.ts";

/** Every provider FlightBuzz knows. Skyscanner and Kayak are deep links only (see docs/DATA_SOURCES.md). */
export const ALL_PROVIDERS: FlightProvider[] = [googleProvider, kiwiProvider, demoProvider];

async function isEnabled(p: FlightProvider, realConfigured: boolean): Promise<boolean> {
  if (config.providers.length) return config.providers.includes(p.id);
  if (p.id === "demo") return config.demo ?? !realConfigured;
  // Unofficial Google scraping is on by default when the package is installed.
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
      note: p.id === "google" ? `${p.note} ${googleNote()}`.trim() : p.note,
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

function googleNote(): string {
  const st = googleStatus();
  const used = `${st.usedToday} requests today.`;
  return st.blockedUntil ? `Paused until ${st.blockedUntil.slice(11, 16)} UTC after ${st.blockReason}. ${used}` : used;
}
