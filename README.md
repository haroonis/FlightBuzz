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
npm run dev          # API on :8787, web app on http://localhost:5173
```

With no API keys, FlightBuzz uses **Google Flights through `fast-flights-ts`**, which is free and unofficial. To try the app without touching any real site, run `PROVIDERS=demo npm run dev`, which uses clearly-labelled synthetic prices.

To run as one server:

```bash
npm run build && npm start   # serves the web app and API on :8787
```

See [.env.example](.env.example) for settings and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for the options for getting prices (Google, SerpApi, Kiwi, Skyscanner, Kayak and others).

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
| `adults` `children` `infants` `cabin` `cur` `providers` | as named |

## Text search

```
MAN,LPL,LBA > @punjab-pk 2026-12-01..2026-12-10 back 14-21 nights stops 2
  via out @uae 1-2n via back IST 0n then DOH 1n adults 2 cur GBP
```

Keywords:

- **Places and dates:** `A > B`, a date or `DATE..DATE`, `back DATE..DATE`, `back N-M nights`, `oneway`.
- **Stops and connections:** `stops N`, `direct`, `via [out|back] PLACES N-Mn [then …]`, `layover 24h`, `selftransfer 180m`, `ground 4h`, `noground`.
- **Passengers, cabin and data:** `adults N`, `children N`, `infants N`, `economy|premium|business|first`, `cur XXX`, `providers a,b`.

## How it works

```
packages/core   shared TypeScript: airports (OurAirports), groups, ground transfers,
                URL + text formats, search planner, trip-stitching engine, deep links
apps/server     Fastify API, SQLite (node:sqlite), providers, fetch cache, twice-daily scheduler
apps/web        React app: Kiwi-style search form, results, saved-search dashboard, groups
```

1. **Plan.** The search becomes one-way legs: origins → destinations, origins → each stopover hub → destinations (with date windows shifted by the nights allowed), and the same for the return.
2. **Fetch.** Each leg is split to fit each provider (per day, per airport pair or not), deduplicated, cached, paced and capped by a request budget.
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
- More providers: Ignav or SearchApi (paid fallback), Kiwi website GraphQL (self-transfers), Ryanair / Wizz Air
- Price alerts (email or push) when a saved search drops below a target
- Real timezone data for exact elapsed times across time zones
- Multi-airport Google requests by encoding several airports per leg
