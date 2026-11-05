import { airport, haversineKm } from "./data.ts";
import type { GroundTransfer } from "./types.ts";

type Row = [string, string, number, number, string, GroundTransfer["mode"], string?];

/** Curated airport-to-airport ground transfers (symmetric). Times include a buffer. */
const CURATED: Row[] = [
  ["VIE", "BTS", 60, 9, "EUR", "bus", "Direct coach (Flixbus / Slovak Lines)"],
  ["BUD", "BTS", 150, 15, "EUR", "bus"],
  ["BUD", "VIE", 180, 20, "EUR", "bus"],
  ["AUH", "DXB", 120, 40, "AED", "bus", "Coach or E101 bus; taxi ~AED 300"],
  ["AUH", "SHJ", 150, 60, "AED", "bus"],
  ["AUH", "DWC", 75, 200, "AED", "taxi"],
  ["DXB", "SHJ", 40, 70, "AED", "taxi"],
  ["DXB", "DWC", 60, 120, "AED", "taxi"],
  ["DWC", "SHJ", 75, 160, "AED", "taxi"],
  ["LHR", "LGW", 80, 30, "GBP", "bus", "National Express coach"],
  ["LHR", "STN", 100, 30, "GBP", "bus"],
  ["LHR", "LTN", 75, 25, "GBP", "bus"],
  ["LHR", "LCY", 75, 7, "GBP", "metro", "Elizabeth line + DLR"],
  ["LGW", "STN", 150, 30, "GBP", "bus"],
  ["LGW", "LTN", 120, 25, "GBP", "train"],
  ["LGW", "LCY", 80, 18, "GBP", "train"],
  ["STN", "LTN", 90, 25, "GBP", "bus"],
  ["MAN", "LPL", 75, 15, "GBP", "train"],
  ["MAN", "LBA", 100, 20, "GBP", "mixed"],
  ["MAN", "BHX", 120, 35, "GBP", "train"],
  ["LPL", "LBA", 150, 25, "GBP", "mixed"],
  ["BHX", "EMA", 75, 20, "GBP", "mixed"],
  ["LHE", "SKT", 120, 7000, "PKR", "car"],
  ["LHE", "LYP", 150, 9000, "PKR", "car"],
  ["LHE", "MUX", 270, 3500, "PKR", "bus", "Motorway coach"],
  ["LHE", "ISB", 270, 3000, "PKR", "bus", "Motorway coach (M-2)"],
  ["SKT", "ISB", 210, 15000, "PKR", "car"],
  ["LYP", "MUX", 210, 12000, "PKR", "car"],
  ["CDG", "ORY", 75, 20, "EUR", "mixed"],
  ["CDG", "BVA", 120, 20, "EUR", "bus"],
  ["ORY", "BVA", 150, 22, "EUR", "bus"],
  ["MXP", "LIN", 75, 13, "EUR", "bus"],
  ["MXP", "BGY", 90, 20, "EUR", "bus"],
  ["LIN", "BGY", 75, 10, "EUR", "bus"],
  ["FCO", "CIA", 75, 15, "EUR", "bus"],
  ["BRU", "CRL", 75, 18, "EUR", "bus"],
  ["CPH", "MMX", 70, 25, "EUR", "train"],
  ["IST", "SAW", 120, 15, "EUR", "bus"],
  ["JFK", "LGA", 60, 50, "USD", "taxi"],
  ["JFK", "EWR", 90, 90, "USD", "taxi"],
  ["EWR", "LGA", 75, 80, "USD", "taxi"],
  ["HND", "NRT", 90, 20, "USD", "train"],
];

const curated = new Map<string, GroundTransfer>();
for (const [a, b, minutes, cost, currency, mode, note] of CURATED) {
  curated.set(`${a}-${b}`, { from: a, to: b, minutes, cost, currency, mode, note });
  curated.set(`${b}-${a}`, { from: b, to: a, minutes, cost, currency, mode, note });
}

/** Distance under which an uncurated pair gets an estimated road transfer. */
export const AUTO_TRANSFER_MAX_KM = 150;

/**
 * Ground transfer between two airports, or undefined if they are the same or
 * too far apart for a reasonable transfer.
 */
export function groundTransfer(from: string, to: string, extra?: GroundTransfer[]): GroundTransfer | undefined {
  if (from === to) return undefined;
  const custom = extra?.find((t) => t.from === from && t.to === to);
  if (custom) return custom;
  const known = curated.get(`${from}-${to}`);
  if (known) return known;
  const a = airport(from);
  const b = airport(to);
  if (!a || !b) return undefined;
  const km = haversineKm(a, b);
  if (km > AUTO_TRANSFER_MAX_KM) return undefined;
  // Road distance ~1.3x straight line at ~70 km/h, plus 30 min to get out of the airport.
  const minutes = Math.round(30 + ((km * 1.3) / 70) * 60);
  const cost = Math.round(10 + km * 0.25);
  return { from, to, minutes, cost, currency: "EUR", mode: "car", estimated: true };
}

export function curatedTransfers(): GroundTransfer[] {
  return [...curated.values()];
}
