/**
 * Approximate exchange rates (units per 1 EUR). Used only for ground-transfer
 * costs and for comparing fares that come back in different currencies.
 * The server can refresh these at runtime with `setRates`.
 */
let RATES: Record<string, number> = {
  EUR: 1,
  GBP: 0.86,
  USD: 1.08,
  AED: 3.97,
  PKR: 300,
  TRY: 37,
  SEK: 11.4,
  CHF: 0.95,
  CZK: 25.2,
  HUF: 395,
  PLN: 4.3,
  SAR: 4.05,
  QAR: 3.93,
  INR: 90,
  JPY: 165,
};

export function setRates(rates: Record<string, number>): void {
  RATES = { ...RATES, ...rates };
}

export function knownCurrencies(): string[] {
  return Object.keys(RATES);
}

export function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const f = RATES[from.toUpperCase()];
  const t = RATES[to.toUpperCase()];
  if (!f || !t) return amount;
  return (amount / f) * t;
}
