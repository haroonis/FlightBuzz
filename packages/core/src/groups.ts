import type { AirportGroup } from "./types.ts";

/**
 * Built-in airport groups. Users can add their own (stored by the server) and
 * override these by reusing the slug.
 */
export const BUILTIN_GROUPS: AirportGroup[] = [
  // United Kingdom
  { slug: "manchester", name: "Manchester", members: ["MAN"] },
  { slug: "north-west-england", name: "North West England", members: ["MAN", "LPL"] },
  { slug: "north-england", name: "North of England", members: ["MAN", "LPL", "LBA"] },
  { slug: "north-midlands", name: "North + Midlands", members: ["MAN", "LPL", "LBA", "BHX", "EMA"] },
  { slug: "london", name: "London (all)", members: ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"] },
  { slug: "uk", name: "United Kingdom", members: ["GB"] },
  // Central Europe
  { slug: "vienna-bratislava", name: "Vienna + Bratislava", members: ["VIE", "BTS"] },
  { slug: "budapest-vienna-bratislava", name: "Budapest + Vienna + Bratislava", members: ["BUD", "VIE", "BTS"] },
  { slug: "paris", name: "Paris (all)", members: ["CDG", "ORY", "BVA"] },
  { slug: "milan", name: "Milan (all)", members: ["MXP", "LIN", "BGY"] },
  { slug: "rome", name: "Rome (all)", members: ["FCO", "CIA"] },
  { slug: "brussels", name: "Brussels (all)", members: ["BRU", "CRL"] },
  { slug: "copenhagen-malmo", name: "Copenhagen + Malmö", members: ["CPH", "MMX"] },
  { slug: "istanbul", name: "Istanbul (all)", members: ["IST", "SAW"] },
  // Middle East
  { slug: "uae", name: "UAE (Dubai, Abu Dhabi, Sharjah)", members: ["DXB", "DWC", "AUH", "SHJ"] },
  { slug: "dubai-sharjah", name: "Dubai + Sharjah", members: ["DXB", "DWC", "SHJ"] },
  { slug: "gulf-hubs", name: "Gulf hubs", members: ["DXB", "AUH", "SHJ", "DOH", "BAH", "MCT", "KWI"] },
  { slug: "saudi-hubs", name: "Saudi hubs", members: ["JED", "RUH", "DMM", "MED"] },
  // Pakistan
  { slug: "punjab-pk", name: "Punjab, Pakistan", members: ["LHE", "SKT", "LYP", "MUX"] },
  { slug: "north-pakistan", name: "Northern Pakistan", members: ["ISB", "LHE", "SKT", "LYP", "PEW"] },
  { slug: "pakistan", name: "Pakistan", members: ["PK"] },
  // Elsewhere
  { slug: "new-york", name: "New York (all)", members: ["JFK", "EWR", "LGA"] },
  { slug: "tokyo", name: "Tokyo (all)", members: ["HND", "NRT"] },
  { slug: "europe-hubs", name: "European hubs", members: ["AMS", "FRA", "CDG", "MUC", "IST", "ZRH", "VIE"] },
  // Found with Google Flights on 8 Nov 2026: one-stop single tickets on 16 Dec to Lahore,
  // Multan or Faisalabad. A minimum list: Google shows ~10 flights per page.
  {
    slug: "europe-pk-1stop",
    name: "Europe with 1-stop to Punjab (PK)",
    members: ["AMS", "ARN", "ATH", "BCN", "BEG", "BER", "BHX", "BLQ", "BRU", "BUD", "CDG", "CGN", "CPH", "DUB", "DUS", "EDI", "FCO", "FRA", "GLA", "GOT", "GVA", "HAJ", "HAM", "HEL", "LGW", "LHR", "LIS", "LUX", "MAD", "MAN", "MUC", "MXP", "NAP", "NCL", "NUE", "OPO", "OSL", "OTP", "SOF", "STN", "STR", "TIA", "VCE", "VIE", "VLC", "WAW", "ZRH"],
  },
  { slug: "lhe-mux-lyp", name: "Lahore, Multan, Faisalabad", members: ["LHE", "MUX", "LYP"] },
].map((g) => ({ ...g, builtin: true }));
