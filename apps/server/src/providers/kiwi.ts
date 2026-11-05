import { localMinutes, type Fare, type LegQuery, type Segment, type Slice } from "@flightbuzz/core";
import { config } from "../config.ts";
import { HttpStatusError, PoliteGate } from "./polite.ts";
import { sliceDuration, type FlightProvider } from "./types.ts";

/**
 * Kiwi.com through the GraphQL API its own website uses (no key). One request
 * covers several airports per side, a whole date range, and return trips, and
 * includes Kiwi's separate-ticket ("self-transfer") combinations.
 * Unofficial, so it follows the same polite rules as Google: one request at a
 * time with a long pause, a daily cap, and a long pause on any sign of blocking.
 */

export const kiwiGate = new PoliteGate("kiwi", () => ({
  cooldownMinutes: config.kiwiCooldownMinutes,
  dailyLimit: config.kiwiDailyLimit,
}));

const URL_BASE = "https://api.skypicker.com/umbrella/v2/graphql";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const SECTOR = `
  duration
  sectorSegments {
    layover { duration isBaggageRecheck }
    segment {
      duration
      code
      source { localTime station { code } }
      destination { localTime station { code } }
      carrier { name code }
    }
  }`;

const BOOKING = `bookingOptions { edges { node { bookingUrl price { amount } } } }`;

const ONE_WAY = `query SearchOneWayItinerariesQuery($search: SearchOnewayInput, $filter: ItinerariesFilterInput, $options: ItinerariesOptionsInput) {
  onewayItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries {
      itineraries {
        __typename
        ... on ItineraryOneWay { id price { amount } ${BOOKING} sector { ${SECTOR} } }
      }
    }
  }
}`;

const RETURN = `query SearchReturnItinerariesQuery($search: SearchReturnInput, $filter: ItinerariesFilterInput, $options: ItinerariesOptionsInput) {
  returnItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries {
      itineraries {
        __typename
        ... on ItineraryReturn { id price { amount } ${BOOKING} outbound { ${SECTOR} } inbound { ${SECTOR} } }
      }
    }
  }
}`;

interface KiwiSector {
  duration: number;
  sectorSegments: {
    layover: { duration: number; isBaggageRecheck: boolean } | null;
    segment: {
      duration: number;
      code: string;
      source: { localTime: string; station: { code: string } };
      destination: { localTime: string; station: { code: string } };
      carrier: { name: string; code: string };
    };
  }[];
}

interface KiwiItinerary {
  id: string;
  price: { amount: string };
  bookingOptions?: { edges: { node: { bookingUrl: string } }[] };
  sector?: KiwiSector;
  outbound?: KiwiSector;
  inbound?: KiwiSector;
}

const CABIN = { economy: "ECONOMY", premium: "PREMIUM_ECONOMY", business: "BUSINESS", first: "FIRST_CLASS" } as const;
const station = (code: string) => `Station:airport:${code}`;

export function kiwiVariables(q: LegQuery) {
  const itinerary: Record<string, unknown> = {
    source: { ids: q.from.map(station) },
    destination: { ids: q.to.map(station) },
    outboundDepartureDate: { start: `${q.departFrom}T00:00:00`, end: `${q.departTo}T23:59:59` },
  };
  if (q.returnFrom) itinerary.inboundDepartureDate = { start: `${q.returnFrom}T00:00:00`, end: `${q.returnTo}T23:59:59` };
  return {
    search: {
      itinerary,
      passengers: {
        adults: q.passengers.adults,
        children: q.passengers.children,
        infants: q.passengers.infants,
        adultsHoldBags: Array(q.passengers.adults).fill(0),
        adultsHandBags: Array(q.passengers.adults).fill(0),
        childrenHoldBags: Array(q.passengers.children).fill(0),
        childrenHandBags: Array(q.passengers.children).fill(0),
      },
      cabinClass: { cabinClass: CABIN[q.cabin], applyMixedClasses: false },
    },
    filter: {
      allowChangeInboundDestination: true,
      allowChangeInboundSource: true,
      allowDifferentStationConnection: true,
      enableSelfTransfer: true,
      enableThrowAwayTicketing: false,
      enableTrueHiddenCity: false,
      maxStopsCount: q.maxStops,
      transportTypes: ["FLIGHT"],
      contentProviders: ["KIWI", "FRESH", "KAYAK"],
      limit: 200,
    },
    options: {
      sortBy: "PRICE",
      currency: q.currency.toLowerCase(),
      locale: "en",
      market: "gb",
      partner: "skypicker",
      partnerMarket: "gb",
      storeSearch: false,
      searchStrategy: "REDUCED",
    },
  };
}

function toSlice(sector: KiwiSector): Slice {
  const segments: Segment[] = sector.sectorSegments.map(({ segment: s, layover }, i) => ({
    from: s.source.station.code,
    to: s.destination.station.code,
    departLocal: s.source.localTime.slice(0, 16),
    arriveLocal: s.destination.localTime.slice(0, 16),
    durationMin: Math.round(s.duration / 60),
    carrier: s.carrier.code,
    carrierName: s.carrier.name,
    flightNo: `${s.carrier.code}${s.code}`,
    // Kiwi marks layovers where you collect bags and check in again (separate tickets).
    ...(i > 0 && layover?.isBaggageRecheck ? { selfTransfer: true } : {}),
  }));
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    from: first.from,
    to: last.to,
    departLocal: first.departLocal,
    arriveLocal: last.arriveLocal,
    durationMin: sector.duration ? Math.round(sector.duration / 60) : sliceDuration(segments, localMinutes),
    segments,
  };
}

export function kiwiFares(itineraries: KiwiItinerary[], q: LegQuery): Fare[] {
  const fetchedAt = new Date().toISOString();
  const fares: Fare[] = [];
  for (const it of itineraries) {
    const sectors = it.sector ? [it.sector] : it.outbound && it.inbound ? [it.outbound, it.inbound] : [];
    if (!sectors.length || !sectors.every((s) => s.sectorSegments?.length)) continue;
    const link = it.bookingOptions?.edges?.[0]?.node.bookingUrl;
    fares.push({
      id: `kiwi:${it.id}`,
      provider: "kiwi",
      price: Number(it.price.amount),
      currency: q.currency,
      slices: sectors.map(toSlice),
      deepLink: link ? new URL(link, "https://www.kiwi.com").toString() : undefined,
      fetchedAt,
    });
  }
  return fares;
}

export const kiwiProvider: FlightProvider = {
  id: "kiwi",
  name: "Kiwi.com",
  capabilities: { multiAirport: true, dateRange: true, returnFares: true },
  concurrency: 1,
  get minDelayMs() {
    return config.kiwiMinDelayMs;
  },
  configured: () => true,
  note: "Free, unofficial (Kiwi's website API). Whole airport groups and date ranges in one request, including Kiwi's self-transfer deals.",
  unavailable: () => kiwiGate.unavailable(),
  onRequest: () => kiwiGate.onRequest(),
  async search(q: LegQuery, ctx): Promise<Fare[]> {
    const isReturn = !!q.returnFrom;
    const feature = isReturn ? "SearchReturnItinerariesQuery" : "SearchOneWayItinerariesQuery";
    try {
      const res = await fetch(`${URL_BASE}?featureName=${feature}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA,
          origin: "https://www.kiwi.com",
          referer: "https://www.kiwi.com/",
        },
        body: JSON.stringify({ query: isReturn ? RETURN : ONE_WAY, variables: kiwiVariables(q) }),
        signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(ctx.signal ? [ctx.signal] : [])]),
      });
      if (!res.ok) throw new HttpStatusError(res.status, "Kiwi");
      const body = (await res.json()) as {
        errors?: { message: string }[];
        data?: Record<string, { __typename: string; error?: string; itineraries?: KiwiItinerary[] }>;
      };
      if (body.errors?.length) throw new Error(`Kiwi: ${body.errors[0].message}`);
      const result = body.data?.[isReturn ? "returnItineraries" : "onewayItineraries"];
      if (!result) throw new Error("Kiwi: empty response");
      if (result.__typename === "AppError") throw new Error(`Kiwi: ${result.error}`);
      return kiwiFares(result.itineraries ?? [], q);
    } catch (e) {
      kiwiGate.onError(e);
      throw e;
    }
  },
};
