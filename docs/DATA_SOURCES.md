# Where FlightBuzz gets prices

Status as researched in November 2026. Things marked ⚠ could not be fully confirmed and should be checked before relying on them.

## Policy: free sources only, fetched slowly

FlightBuzz uses **no paid APIs**. Where it has to scrape, it asks slowly enough that it should never hit rate limits.

## Summary

| Source | How | Cost | In FlightBuzz |
|---|---|---|---|
| **Google Flights** | Opens the Google Flights results page in the FlightBuzz browser window (a real, kept-open window with a saved profile), clicks **Cheapest** and "View more flights", and reads the flights, with up to 7 airports per side. **The default and main source.** With `BROWSER=off` it calls the page's own endpoint directly instead. `fast-flights-ts` reads Google's data. Verified live. | Free | ✅ `google`, on by default |
| **Kiwi.com** | The GraphQL API kiwi.com itself uses (`api.skypicker.com/umbrella/v2/graphql`). One request covers several airports per side, a whole date range, and return trips, and includes Kiwi's self-transfer deals on budget airlines. Verified live. | Free | ✅ `kiwi`, opt-in |
| Kiwi.com Tequila | Official API, only for approved partners since May 2024 | — | ❌ not needed |
| Travelpayouts / Aviasales Data API | Free token. Cached prices users saw in the last 48 h; thin on small airports. | Free | ❌ planned as a pre-filter |
| Ryanair / Wizz Air | Unofficial cheapest-fare-per-day endpoints | Free | ❌ planned for European legs |
| **Skyscanner** | Partner API needs a big established business, and direct requests get HTTP 403. FlightBuzz instead opens Skyscanner's results page in the browser window and reads the search data the page loads. Skyscanner shows a "Press & Hold" robot check, which you do once in the window. The page's data format is not verified yet: run with `SKYSCANNER_DEBUG=1` the first time. | Free | ✅ `skyscanner`, opt-in |
| **Kayak** | Affiliate API by approval; aggressive bot blocking | — | 🔗 "check price" links only |
| SerpApi, SearchApi, Ignav, Duffel | Paid | Paid | ❌ excluded by policy |
| Amadeus Self-Service | Shut down 17 July 2026 | — | ❌ |

## The browser window

Google Flights and Skyscanner are read the way a person would read them: in a real Chrome window (Playwright) that stays open and is reused. Its saved profile in `.browser-profile/` keeps cookies and consent choices.

- **Cookie screens** are accepted automatically.
- **Robot checks** (Google "unusual traffic", Skyscanner "Press & Hold") are never automated. FlightBuzz brings the window to the front and shows a banner. You do the check, and the search carries on. If nobody does it within `HUMAN_WAIT_MINUTES` (default 10), that site is paused for 3 hours.
- **Human-like pacing on each page:** a few seconds of waiting, a scroll, and clicking "View more flights".

A real browser doesn't fix a flagged internet address. From this project's cloud test server, Google blocked direct requests after a handful of tries. From the same server, the browser window loaded Google Flights results normally. Skyscanner showed its robot check straight away. A home connection is the best place to run FlightBuzz.

## Kiwi pacing

Kiwi answers a whole leg in one request: every airport on both sides and every date in the range, or a full return search. A typical search therefore needs only a handful of Kiwi requests.

The same polite rules apply as for Google:

- one request at a time, 24–42 s apart (`KIWI_MIN_DELAY_MS`)
- a 3-hour pause on any sign of blocking
- at most 200 requests a day

By default, prices assume **no checked bags**. Set "Checked bags per person" (`bags=1` in the URL) and Kiwi prices include them. In a live test this took the cheapest return from £1,002 to £1,145. Google results are base fares: full-service airlines usually include a bag, budget ones don't.

## How Google is fetched politely

- **One request at a time.** After each request it waits 15–26 s, randomised (`GOOGLE_MIN_DELAY_MS=14700` plus up to 75% jitter). That is at most about 150 requests an hour. History: about 60 browser-window pages in a row at 45–80 s, 41 at 36–63 s, 22 at 29–50 s 28 at 23–40 s and more at 18–32 s all loaded with no blocks, so the pause was cut by 20% five times. In a live test from a cloud server, Google returned HTTP 429 after about 10 requests spaced 10–30 s apart, so the old 8–14 s gap was too fast. Home broadband IPs are usually treated more generously than cloud IPs.
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
