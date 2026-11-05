# Where FlightBuzz gets prices

Status as researched in November 2026. Things marked ⚠ could not be fully confirmed and should be checked before relying on them.

## Policy: free sources only, fetched slowly

FlightBuzz uses **no paid APIs**. Where it has to scrape, it asks slowly enough that it should never hit rate limits.

## Summary

| Source | How | Cost | In FlightBuzz |
|---|---|---|---|
| **Google Flights** | `fast-flights-ts`: calls the endpoint the Google Flights page itself uses. No browser. Only contacts `www.google.com`. | Free | ✅ `google`, on by default |
| **Kiwi.com Tequila** | Official API. Free, but keys have only been issued to approved partners since May 2024. | Free (if you have a key) | ✅ `kiwi`, set `KIWI_TEQUILA_KEY` |
| Kiwi.com website GraphQL | Unofficial (`api.skypicker.com/umbrella/v2/graphql`). Finds Kiwi's self-transfer combinations. | Free | ❌ planned |
| Travelpayouts / Aviasales Data API | Free token. Cached prices users saw in the last 48 h; thin on small airports. | Free | ❌ planned as a pre-filter |
| Ryanair / Wizz Air | Unofficial cheapest-fare-per-day endpoints | Free | ❌ planned for European legs |
| **Skyscanner** | Partner API needs a big established business; the site is heavily bot-protected | — | 🔗 "check price" links only |
| **Kayak** | Affiliate API by approval; aggressive bot blocking | — | 🔗 "check price" links only |
| SerpApi, SearchApi, Ignav, Duffel | Paid | Paid | ❌ excluded by policy |
| Amadeus Self-Service | Shut down 17 July 2026 | — | ❌ |

## How Google is fetched politely

- **One request at a time.** After each request it waits 8–14 s, randomised (`GOOGLE_MIN_DELAY_MS=8000` plus up to 75% jitter). That is at most about 300 requests an hour, similar to one person clicking around steadily.
- **No automatic retries.**
- **Pause on any sign of blocking.** A `429`, `403` or `503`, or a CAPTCHA, stops all Google requests for 3 hours (`GOOGLE_COOLDOWN_MINUTES`). Searches carry on with cached prices, and the app shows the pause.
- **Daily cap.** At most `GOOGLE_DAILY_LIMIT` requests a day (default 1500).
- **Shared cache.** Answers are reused for 5 hours (`CACHE_TTL_MINUTES`), so overlapping saved searches don't ask twice.

### What this means for search size

Google answers **one airport pair on one day** per request. That makes it about 10 s per request:

| Search | Requests | Time |
|---|---|---|
| MAN → LHE, 7 days, one-way | 7 | about 1 min |
| MAN + LPL + LBA → LHE + SKT + LYP + MUX, 7 days, outbound only | 84 | about 15 min |
| …plus the return direction | ×2 | |
| …plus each stopover hub | more again | |

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
