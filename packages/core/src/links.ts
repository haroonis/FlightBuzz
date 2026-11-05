import type { Cabin, Fare, Passengers } from "./types.ts";

export interface SiteLink {
  site: "google" | "kiwi" | "skyscanner" | "kayak";
  label: string;
  url: string;
}

interface LinkInput {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  passengers?: Passengers;
  cabin?: Cabin;
  currency?: string;
}

const yymmdd = (d: string) => d.slice(2).replaceAll("-", "");

export function googleFlightsUrl(i: LinkInput): string {
  const q = `Flights from ${i.from} to ${i.to} on ${i.date}${i.returnDate ? ` returning ${i.returnDate}` : " one way"}`;
  const p = new URLSearchParams({ q, curr: i.currency ?? "GBP", hl: "en-GB" });
  return `https://www.google.com/travel/flights?${p}`;
}

export function kiwiUrl(i: LinkInput): string {
  const p = new URLSearchParams();
  if (i.passengers && i.passengers.adults !== 1) p.set("adults", String(i.passengers.adults));
  if (i.cabin && i.cabin !== "economy") p.set("cabinClass", i.cabin.toUpperCase() + "-false");
  const qs = p.toString();
  return `https://www.kiwi.com/en/search/results/${i.from}/${i.to}/${i.date}/${i.returnDate ?? "no-return"}${qs ? `?${qs}` : ""}`;
}

export function skyscannerUrl(i: LinkInput): string {
  const cabin = { economy: "economy", premium: "premiumeconomy", business: "business", first: "first" }[i.cabin ?? "economy"];
  const p = new URLSearchParams({ adultsv2: String(i.passengers?.adults ?? 1), cabinclass: cabin, rtn: i.returnDate ? "1" : "0" });
  const ret = i.returnDate ? `${yymmdd(i.returnDate)}/` : "";
  return `https://www.skyscanner.net/transport/flights/${i.from.toLowerCase()}/${i.to.toLowerCase()}/${yymmdd(i.date)}/${ret}?${p}`;
}

export function kayakUrl(i: LinkInput): string {
  const ret = i.returnDate ? `/${i.returnDate}` : "";
  const cabin = i.cabin && i.cabin !== "economy" ? `/${i.cabin}` : "";
  const pax = i.passengers && i.passengers.adults > 1 ? `/${i.passengers.adults}adults` : "";
  return `https://www.kayak.co.uk/flights/${i.from}-${i.to}/${i.date}${ret}${cabin}${pax}?sort=price_a`;
}

export function siteLinks(i: LinkInput): SiteLink[] {
  return [
    { site: "google", label: "Google Flights", url: googleFlightsUrl(i) },
    { site: "kiwi", label: "Kiwi", url: kiwiUrl(i) },
    { site: "skyscanner", label: "Skyscanner", url: skyscannerUrl(i) },
    { site: "kayak", label: "Kayak", url: kayakUrl(i) },
  ];
}

/** Links for checking one ticket of a trip on each site. */
export function fareLinks(fare: Fare, passengers?: Passengers, cabin?: Cabin): SiteLink[] {
  const [a, b] = fare.slices;
  return siteLinks({
    from: a.from,
    to: a.to,
    date: a.departLocal.slice(0, 10),
    returnDate: b?.departLocal.slice(0, 10),
    passengers,
    cabin,
    currency: fare.currency,
  });
}
