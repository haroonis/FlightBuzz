/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Local wall-clock date-time at the airport, `YYYY-MM-DDTHH:mm`. No timezone. */
export type LocalDateTime = string;

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

export type Cabin = "economy" | "premium" | "business" | "first";

export type ReturnSpec =
  | { type: "oneway" }
  | { type: "dates"; range: DateRange }
  | { type: "nights"; min: number; max: number };

/** One stop on a stopover plan: stay `minNights..maxNights` somewhere in `places`. */
export interface StopoverStop {
  /** Place tokens, e.g. ["@uae"] or ["IST", "SAW"]. */
  places: string[];
  minNights: number;
  maxNights: number;
}

export type Direction = "out" | "back" | "both";

/**
 * A stopover plan is an alternative way of routing one direction through one or
 * more places, each on separate tickets. Nights 0-0 means a self-transfer
 * connection (same day, or overnight within `maxLayoverHours`).
 */
export interface StopoverPlan {
  direction: Direction;
  stops: StopoverStop[];
}

export interface Passengers {
  adults: number;
  children: number;
  infants: number;
}

export interface SearchSpec {
  /** Place tokens: `MAN` airport, `GB` country, `PK-PB` region, `@north-england` group. */
  origins: string[];
  destinations: string[];
  depart: DateRange;
  return: ReturnSpec;
  passengers: Passengers;
  cabin: Cabin;
  /** Max intermediate airports per direction (connections + stopovers). */
  maxStops: number;
  /** Max hours for a connection that is not a planned stopover night. */
  maxLayoverHours: number;
  /** Minimum minutes between separate tickets at the same airport. */
  minSelfTransferMinutes: number;
  /** Let separate-ticket routings arrive at one airport and leave from another nearby one. */
  groundTransfers: boolean;
  /** Max hours for a ground transfer between airports. */
  maxGroundHours: number;
  stopovers: StopoverPlan[];
  currency: string;
  /** Provider ids to query; empty = all enabled. */
  providers: string[];
}

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  /** L = large, M = medium, S = small. */
  size: "L" | "M" | "S";
}

export interface AirportGroup {
  slug: string;
  name: string;
  /** Members: airport codes, country/region codes or other `@group` tokens. */
  members: string[];
  description?: string;
  builtin?: boolean;
}

export interface GroundTransfer {
  from: string;
  to: string;
  minutes: number;
  /** Approximate one-way cost per person. */
  cost: number;
  currency: string;
  mode: "bus" | "train" | "taxi" | "metro" | "car" | "mixed";
  note?: string;
  /** True when derived from distance rather than curated. */
  estimated?: boolean;
}

export interface Segment {
  from: string;
  to: string;
  departLocal: LocalDateTime;
  arriveLocal: LocalDateTime;
  durationMin: number;
  carrier: string;
  carrierName?: string;
  flightNo?: string;
  /** Separate ticket from the previous segment: collect bags and check in again. */
  selfTransfer?: boolean;
}

/** A one-directional journey on one ticket (may include connections). */
export interface Slice {
  from: string;
  to: string;
  departLocal: LocalDateTime;
  arriveLocal: LocalDateTime;
  durationMin: number;
  segments: Segment[];
}

/** A priced ticket as returned by a provider. One slice = one-way, two = return. */
export interface Fare {
  id: string;
  provider: string;
  price: number;
  currency: string;
  slices: Slice[];
  deepLink?: string;
  fetchedAt: string;
  /**
   * Return ticket whose return flight is picked on the provider's site
   * (Google prices round trips per outbound flight). `price` covers both ways.
   */
  openReturn?: OpenReturn;
}

export interface OpenReturn {
  date: ISODate;
  from: string[];
  to: string[];
}

export type Step =
  | { type: "flight"; slice: Slice; fareId: string; provider: string }
  | {
      type: "layover";
      at: string;
      minutes: number;
      kind: "connection" | "self-transfer" | "stopover";
      overnight: boolean;
      nights: number;
    }
  | { type: "ground"; transfer: GroundTransfer; price: number };

export interface Journey {
  from: string;
  to: string;
  departLocal: LocalDateTime;
  arriveLocal: LocalDateTime;
  steps: Step[];
  /** Intermediate airports (connections + stopovers). */
  stops: number;
  /** Time in the air or connecting, excluding planned stopover nights. */
  travelMin: number;
  /** Door-to-door elapsed minutes. */
  elapsedMin: number;
  stopoverNights: number;
  selfTransfers: number;
  airportChanges: number;
  overnightLayovers: number;
}

export interface Trip {
  id: string;
  price: number;
  currency: string;
  out: Journey;
  back?: Journey;
  fares: Fare[];
  /** Return included in a return ticket, flight to be picked on the provider's site. */
  openReturn?: OpenReturn;
  /** Lower is better. Price plus penalties for time and hassle. */
  score: number;
  tags: TripTag[];
}

export type TripTag =
  | "direct"
  | "self-transfer"
  | "stopover"
  | "airport-change"
  | "open-jaw"
  | "overnight-layover"
  | "multi-provider"
  | "return-ticket";

/** One request a provider can answer. */
export interface LegQuery {
  from: string[];
  to: string[];
  departFrom: ISODate;
  departTo: ISODate;
  /** Present for native return fares only. */
  returnFrom?: ISODate;
  returnTo?: ISODate;
  /** For return fares: allowed nights between departure and return dates. */
  nightsMin?: number;
  nightsMax?: number;
  maxStops: number;
  passengers: Passengers;
  cabin: Cabin;
  currency: string;
}

export interface ProviderCapabilities {
  /** Accepts several airports per side in one request. */
  multiAirport: boolean;
  /** Most airports per side in one request (when multiAirport). */
  maxAirportsPerSide?: number;
  /** Accepts a departure date range in one request. */
  dateRange: boolean;
  /** Can price native return tickets. */
  returnFares: boolean;
}
