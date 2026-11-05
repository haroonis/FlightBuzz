# Where FlightBuzz gets prices

Status as researched in November 2026. Things marked ⚠ could not be fully confirmed and should be checked before relying on them.

## Summary

| Source | How | Cost | Multi-airport per request | Date range per request | In FlightBuzz |
|---|---|---|---|---|---|
| **Google Flights** | `fast-flights-ts` (calls Google's internal endpoint, no browser) | Free | No (one pair) | No (one day) | ✅ `google` provider, on by default |
| Google Flights via **SerpApi** | Paid SERP API | Free 250/mo; $25/1k … $275/30k | Yes (comma list) | No | ✅ `serpapi`, set `SERPAPI_KEY` |
| **Kiwi.com Tequila** | Official API, partner-only since May 2024 | Free for partners | Yes | Yes, plus native returns | ✅ `kiwi`, set `KIWI_TEQUILA_KEY` |
| Kiwi.com website GraphQL | Unofficial (`api.skypicker.com/umbrella/v2/graphql`) | Free | Yes | Yes | ❌ not yet. Best-effort candidate for self-transfer fares |
| **Skyscanner** | Partner API needs an established business with 100k+ monthly visits; site is behind PerimeterX/HUMAN bot protection | — | — | — | 🔗 deep links only |
| **Kayak** | Affiliate API granted case by case; aggressive bot blocking | — | — | — | 🔗 deep links only |
| Travelpayouts / Aviasales Data API | Free token, cached prices users saw in the last 48 h | Free (600 req/min) | Yes | Yes | ❌ planned as a cheap pre-filter |
| Ignav | Paid flight API | 1k free, then $2/1k ⚠ | ⚠ | ⚠ | ❌ candidate paid fallback |
| SearchApi.io | Paid SERP API (also has a Google Flights calendar engine) | ~$4/1k ⚠ | ⚠ | Calendar engine | ❌ candidate paid fallback |
| Amadeus Self-Service | Shut down 17 July 2026 | — | — | — | ❌ |
| Duffel | Bookable fares API, charges for excess searches | ~$0.005/search after 1,500 per booking ⚠ | — | — | ❌ weak low-cost coverage |
| Ryanair / Wizz Air | Unofficial cheapest-per-day endpoints | Free | — | Yes | ❌ candidates for European positioning legs |

## Recommendation

1. **Google Flights through `fast-flights-ts` as the main source** (free). Each request covers one airport pair on one day, so FlightBuzz paces them (`GOOGLE_MIN_DELAY_MS`, default 1.5 s) and caches answers between saved searches. It is unofficial and against Google's terms. Enforcement against light personal use is rare, but heavy use gets `429` responses or CAPTCHAs. It may also return empty results for small airports, so check SKT, LYP and MUX early.
2. **A paid fallback when scraping is blocked.** SerpApi is already wired up. Ignav or SearchApi are cheaper per request and easy to add as another provider file.
3. **Kiwi Tequila if you can get a partner key.** It answers a whole airport group and date range in one request, includes return fares, and finds Kiwi's self-transfer combinations.
4. **Skyscanner and Kayak as "check this price" links.** Every ticket in the results has links that open the same flight on Google Flights, Kiwi, Skyscanner and Kayak.

## Request volume

FlightBuzz plans every search as a set of one-way legs: direct, each stopover hub, and the return direction. It then splits each leg to suit each provider:

- **Google (fast-flights-ts):** airports on side A × airports on side B × days.
  - MAN, LPL, LBA → LHE, SKT, LYP, MUX over 7 days is 3 × 4 × 7 = 84 requests for the direct outbound leg alone.
- **SerpApi:** one request per day, so the same leg is 7 requests.
- **Kiwi:** one request per leg, whatever the date range.

Ways to keep the count down:

- Answers are cached for `CACHE_TTL_MINUTES` (default 300), so overlapping saved searches share them.
- `REQUEST_BUDGET` (default 600) caps live requests per run. Direct legs are fetched first, then stopover legs.
- For Google, smaller airport groups and shorter date windows give the biggest saving.

### Cost at about 5,000 leg requests a day (about 150k a month)

| Source | Monthly cost |
|---|---|
| fast-flights-ts | about $0, plus optional residential proxies ⚠ |
| Ignav | about $300 ⚠ |
| SearchApi | about $375–500 ⚠ |
| SerpApi | about $1,100–1,500 ⚠ |

Pre-filtering with cached prices and grouped airports should bring this down to about 500–1,000 live requests a day.

## Adding a provider

Create `apps/server/src/providers/<name>.ts` that implements `FlightProvider` from `providers/types.ts`, and add it to `ALL_PROVIDERS` in `providers/index.ts`.

- **`capabilities`** tells the planner how to split queries. Set `multiAirport`, `dateRange` and `returnFares` to match what one request can answer.
- **`search(query)`** returns `Fare[]`. Each fare has one slice for one-way or two for a return, with segment times in local airport time (`YYYY-MM-DDTHH:mm`).

## Sources

- SerpApi: https://serpapi.com/google-flights-api, https://serpapi.com/pricing
- fast-flights-ts: https://github.com/decocms/fast-flights-ts. Python original: https://pypi.org/project/fast-flights/
- Kiwi partner changes: https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/
- Skyscanner partner requirements: https://skyscannerpartnersupport.zendesk.com/hc/en-us/articles/10881149122717
- Kayak affiliate API: https://help.affiliates.kayak.com/article/812-do-you-offer-an-api
- Amadeus shutdown: https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
- Travelpayouts Data API: https://support.travelpayouts.com/hc/en-us/articles/4402565416594
- Duffel excess search: https://help.duffel.com/hc/en-gb/articles/4412912264466-What-is-Excess-Search
- Ignav pricing: https://ignav.com/pricing
