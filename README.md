# FlightBuzz ✈️

Find the cheapest and most convenient ways to fly between **groups of airports**. FlightBuzz covers multi-stop routes, self-transfers, stopovers of a night or more, and arriving at one airport but leaving from another (Bratislava in, Vienna out; Abu Dhabi in, Dubai or Sharjah out). Saved searches are re-priced twice a day.

- **Airport groups.** Manchester only, or Manchester + Liverpool + Leeds, or + Birmingham, or all of London (6 airports), Vienna + Bratislava, the UAE, or Punjab, Pakistan (Lahore, Sialkot, Faisalabad, Multan). Countries and regions work too (`PK`, `PK-PB`), and you can define your own groups.
- **Date bands.** A departure window, plus either a return window or a nights-in-destination range, Kiwi style.
- **Routings.**
  - Single-ticket flights with up to N stops and long layovers (24 h, 48 h…).
  - Separate-ticket self-transfers through any hub.
  - Planned stopovers ("2 nights in the UAE on the way out"), including sequences such as Istanbul then Doha.
  - Ground transfers between nearby airports, with time and cost.
- **Results.** Cheapest, best (price plus time and hassle) and fastest, split into direct / 1 / 2 / 3+ stops, stopovers and airport changes. Each ticket links to Google Flights, Kiwi, Skyscanner and Kayak so you can check the price.
- **Editable everywhere.** The URL is hand-editable like Kiwi's, and the whole search can be typed as one line of text.

## Quick start

```bash
npm install
npx playwright install chromium   # the browser FlightBuzz drives
npm run build && npm start        # web app + API on http://localhost:8787
```

For development, `npm run dev` serves the web app on :5173 with live reload.

### The FlightBuzz browser window

Google Flights and Skyscanner are read through **a real, visible browser window**. FlightBuzz opens it on the first search and keeps it open, reusing it for every search, just like a person browsing. The window has its own saved profile (`.browser-profile/`), so cookie choices and robot-check passes survive restarts.

- **First run:** FlightBuzz accepts Google's cookie screen itself. If Skyscanner shows its "Press & Hold" robot check, the app shows a banner. Do the check in the window and the search carries on. FlightBuzz never tries to solve robot checks itself.
- **One-time setup in advance:** under More options → Providers, click *Google Flights*, *Skyscanner* or *Kiwi* to open that site in the window.
- **Leave the window open.** If you close it, it reopens on the next search.
- **On a server with no screen:** set `BROWSER=headless` (hidden window; robot checks can't be done there) or `BROWSER=off` (Google through direct requests; no Skyscanner).

### Sources

**Google Flights is the source.** FlightBuzz opens its results page in the browser window with all airports on each side, clicks the **Cheapest** tab and "View more flights", and reads the flights.

Optional extras, off unless you tick them for a search or add them to `PROVIDERS`:

- **Kiwi.com**, through the API kiwi.com itself uses, including Kiwi's separate-ticket deals.
- **Skyscanner**, through its results page in the browser window. It covers one airport pair per page.

Kayak appears as "check this price" links only.

Everything is fetched slowly on purpose: one request at a time, 24–63 s apart (Google: 3 windows, each about one page a minute, staggered), with a 3-hour pause if a site pushes back. A big search therefore takes minutes rather than seconds, which suits the twice-daily refresh. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for details and [.env.example](.env.example) for settings. To try the app without touching any real site, run `PROVIDERS=demo npm start`.

## Search URLs

```
/search/{from}/{to}/{depart}/{return}?{options}

/search/@north-england,BHX/@punjab-pk/2026-12-01_2026-12-10/2027-01-05_2027-01-12?stops=3&via=out.@uae:1-2
/search/VIE,BTS/@uae/2026-12-10/no-return
/search/@london/PK-PB/2026-12-01_2026-12-07/14-21-nights?via=IST:0
```

| Part | Format |
|---|---|
| places | `MAN` airport · `GB` country · `PK-PB` region · `@punjab-pk` group, comma-separated |
| depart | `2026-12-01` or `2026-12-01_2026-12-10` |
| return | date or range · `7-14-nights` · `no-return` |
| `stops` | max stops per direction (default 2) |
| `layover` | max connection hours (default 24) |
| `selftransfer` | min minutes between separate tickets (default 180) |
| `ground` | max ground-transfer hours, `0` to disable (default 5) |
| `via` | stopover plan, repeatable: `[out.\|back.]PLACES:MIN[-MAX][~PLACES:N…]`. Nights `0` means a self-transfer connection only. |
| `bags` | checked bags per person to include in prices, 0–2 (default 0) |
| `adults` `children` `infants` `cabin` `cur` `providers` | as named |

## Your searches: `searches.csv`

Every search plan lives in **`searches.csv`** at the top of the repo. It's plain CSV, so you can edit it in a spreadsheet or any text editor. Each line is one plan in FlightBuzz terms (airport groups, date ranges, options), not one Google page; FlightBuzz expands each line into as many site searches as it needs.

```csv
id,enabled,group,kind,from,to,depart,return,stops,layover_h,via,airlines,nearby_km,return_only,bags,adults,top,track,notes
primary,yes,primary,search,MAN LPL LBA,LHE MUX LYP,2026-12-16..2026-12-17,2026-12-31..2027-01-03,2,48,@uae 0-2n,,,no,0,1,,yes,Main search
flydubai,yes,budget-airlines,search,BGY NAP PRG BUD ...,MUX LHE LYP,2026-12-16..2026-12-17,2026-12-31..2027-01-03,1,,,FZ,,yes,0,1,,no,
europe-sweep,yes,europe,sweep,@europe,MUX LHE LYP,2026-12-16..2026-12-17,2026-12-31..2027-01-03,2,,,,,yes,0,1,7,no,
```

- **Lists inside a cell** are space-separated, so cells never need quoting.
- **Places:** `MAN` airport, `@group`, `PK` country, `PK-PB` region.
- **Dates:** `2026-12-16..2026-12-17`.
- **return:** a date range, `oneway`, or `14-21 nights`.
- **via:** `@uae 0-2n`, or `out IST 1n; back DOH 0n`.
- **enabled=no** keeps a line in the file without running it.
- **group** lets you run or switch a whole set at once.
- **kind=sweep** scans every origin, then searches the cheapest `top` in full.
- **track=yes** makes the line a saved search that refreshes twice a day. The running app picks up edits within seconds.

```bash
npm run searches -- list                     # every plan, with problems and a Google-page estimate
npm run searches -- run primary              # one plan by id
npm run searches -- run budget-airlines      # a whole group
npm run searches -- run all                  # every enabled plan
```

The same is available as `GET /api/plans` and `POST /api/plans/run {"selectors": ["primary"]}`. All columns are documented in `packages/core/src/searchFile.ts`.

## Wide searches: every airport in a region

- **`@europe`** is every European airport with scheduled flights (about 460).
- **Nearby airports** (`nearby=100`, or `nearby 100km` in text) adds every airport within that distance of a chosen one, on both sides. For example, Malpensa adds Bergamo and Linate.
- **Sweep** keeps a wide search affordable. It scans every starting airport on one date pair (return tickets only), ranks them, then runs the full search (all dates and options) from the cheapest N:

```bash
npm run sweep -w @flightbuzz/server -- "@europe > MUX,LHE,LYP 2026-12-16..2026-12-17 back 2026-12-31..2027-01-03 stops 2" 21
```

The same is available as `POST /api/sweep {"spec": …, "top": 21}`. Connections can be anywhere in the world; only the stop limit applies.

## Text search

```
MAN,LPL,LBA > @punjab-pk 2026-12-01..2026-12-10 back 14-21 nights stops 2
  via out @uae 1-2n via back IST 0n then DOH 1n adults 2 cur GBP
```

Keywords:

- **Places and dates:** `A > B`, a date or `DATE..DATE`, `back DATE..DATE`, `back N-M nights`, `oneway`.
- **Stops and connections:** `stops N`, `direct`, `via [out|back] PLACES N-Mn [then …]`, `layover 24h`, `selftransfer 180m`, `ground 4h`, `noground`.
- **Passengers, cabin and data:** `adults N`, `children N`, `infants N`, `bags N`, `economy|premium|business|first`, `cur XXX`, `providers a,b`.

## How it works

```
packages/core   shared TypeScript: airports (OurAirports), groups, ground transfers,
                URL + text formats, search planner, trip-stitching engine, deep links
apps/server     Fastify API, SQLite (node:sqlite), providers, fetch cache, twice-daily scheduler
apps/web        React app: Kiwi-style search form, results, saved-search dashboard, groups
```

1. **Plan.** The search becomes one-way legs: origins → destinations, origins → each stopover hub → destinations (with date windows shifted by the nights allowed), and the same for the return.
2. **Fetch.** Each leg is split to fit each provider (per day and/or per batch of airports), deduplicated, cached, paced and capped by a request budget.
3. **Stitch.** Legs are joined into journeys that respect minimum self-transfer time, maximum layover, nights per stopover and maximum ground-transfer time. Outbound and return journeys are then paired within the nights or return window, and native return fares are added where a provider has them.
4. **Rank.** Each trip gets a price and a "best" score: price plus £8 per travel hour, with penalties for stops, self-transfers, airport changes and overnight layovers. The kept results stay varied, with the cheapest and best in every stop/stopover bucket.
5. **Track.** Saved searches are re-run at `SCHEDULE` times (default 07:00 and 19:00), and each run's summary is stored for the price-history charts. `npm run refresh -w @flightbuzz/server` does the same from system cron.

## Development

```bash
npm test             # vitest: core formats, engine, provider parsers
npm run typecheck
npm run data:airports  # rebuild data/*.json from OurAirports
```

## Roadmap

- Travelpayouts cached-price pre-filter, so only promising dates are searched live
- More free providers: Ryanair / Wizz Air
- Price alerts (email or push) when a saved search drops below a target
- Real timezone data for exact elapsed times across time zones
- Multi-airport Google requests by encoding several airports per leg
