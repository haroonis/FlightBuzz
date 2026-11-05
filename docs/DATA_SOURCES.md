# Where FlightBuzz gets prices

Status as researched in November 2026. Things marked ⚠ could not be fully confirmed and should be checked before relying on them.

## Policy: free sources only, fetched slowly

FlightBuzz uses **no paid APIs**. Where it has to scrape, it asks slowly enough that it should never hit rate limits.

## Summary

| Source | How | Cost | In FlightBuzz |
|---|---|---|---|
| **Google Flights** | Calls the endpoint the Google Flights page itself uses, with several airports per side. No browser. Only contacts `www.google.com`. `fast-flights-ts` reads the answer. | Free | ✅ `google`, on by default |
| **Kiwi.com** | The GraphQL API kiwi.com itself uses (`api.skypicker.com/umbrella/v2/graphql`). One request covers several airports per side, a whole date range, and return trips, and includes Kiwi's self-transfer deals on budget airlines. Verified live. | Free | ✅ `kiwi`, on by default |
| Kiwi.com Tequila | Official API, only for approved partners since May 2024 | — | ❌ not needed |
| Travelpayouts / Aviasales Data API | Free token. Cached prices users saw in the last 48 h; thin on small airports. | Free | ❌ planned as a pre-filter |
| Ryanair / Wizz Air | Unofficial cheapest-fare-per-day endpoints | Free | ❌ planned for European legs |
| **Skyscanner** | Partner API needs a big established business. The website's search API returned HTTP 403 to us straight away (PerimeterX/HUMAN bot protection). | — | 🔗 "check price" links only |
| **Kayak** | Affiliate API by approval; aggressive bot blocking | — | 🔗 "check price" links only |
| SerpApi, SearchApi, Ignav, Duffel | Paid | Paid | ❌ excluded by policy |
| Amadeus Self-Service | Shut down 17 July 2026 | — | ❌ |

## Kiwi pacing

Kiwi answers a whole leg in one request: every airport on both sides and every date in the range, or a full return search. A typical search therefore needs only a handful of Kiwi requests.

The same polite rules apply as for Google:

- one request at a time, 30–52 s apart (`KIWI_MIN_DELAY_MS`)
- a 3-hour pause on any sign of blocking
- at most 200 requests a day

Kiwi prices assume **no checked bags**. Its cheapest deals are often separate tickets on budget airlines, where bags cost extra on every flight.

## How Google is fetched politely

- **One request at a time.** After each request it waits 45–80 s, randomised (`GOOGLE_MIN_DELAY_MS=45000` plus up to 75% jitter). That is at most about 60 requests an hour. In a live test from a cloud server, Google returned HTTP 429 after about 10 requests spaced 10–30 s apart, so the old 8–14 s gap was too fast. Home broadband IPs are usually treated more generously than cloud IPs.
- **No automatic retries.**
- **Pause on any sign of blocking.** A `429`, `403` or `503`, or a CAPTCHA, stops all Google requests for 3 hours (`GOOGLE_COOLDOWN_MINUTES`). Searches carry on with cached prices, and the app shows the pause.
- **Daily cap.** At most `GOOGLE_DAILY_LIMIT` requests a day (default 300).
- **Shared cache.** Answers are reused for 5 hours (`CACHE_TTL_MINUTES`), so overlapping saved searches don't ask twice.

### What this means for search size

Like the Google Flights page, one request covers **several airports on each side** (up to 7) for **one date**. With the pause, that's about 1 minute per request:

| Search | Requests | Time |
|---|---|---|
| MAN + LPL + LBA → LHE + MUX + LYP, out 16–17 Dec, back 31 Dec–3 Jan | 2 + 4 = 6 | about 6 min |
| …plus separate tickets via the UAE with 0–2 nights each way | about 20 | about 20 min |

`REQUEST_BUDGET` (default 600, about 1.5–2 h) caps a single run. Direct legs are fetched first.

Saved searches refresh in the background twice a day, so slow fetching is fine there. For quick interactive searches, keep the groups and date windows tight, or search once and let the twice-daily refresh do the rest.

The library may also return empty results for small airports, so check SKT, LYP and MUX early.

## Adding a provider

Create `apps/server/src/providers/<name>.ts` that implements `FlightProvider` from `providers/types.ts`, and add it to `ALL_PROVIDERS` in `providers/index.ts`.

- **`capabilities`** tells the planner how to split queries. Set `multiAirport`, `dateRange` and `returnFares` to match what one request can answer.
- **`search(query)`** returns `Fare[]`. Each fare has one slice for one-way or two for a return, with segment times in local airport time (`YYYY-MM-DDTHH:mm`).

## Sources

- fast-flights-ts: https://github.com/decocms/fast-flights-ts. Python original: https://pypi.org/project/fast-flights/
- Kiwi partner changes: https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/
- Skyscanner partner requirements: https://skyscannerpartnersupport.zendesk.com/hc/en-us/articles/10881149122717
- Kayak affiliate API: https://help.affiliates.kayak.com/article/812-do-you-offer-an-api
- Amadeus shutdown: https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
- Travelpayouts Data API: https://support.travelpayouts.com/hc/en-us/articles/4402565416594
