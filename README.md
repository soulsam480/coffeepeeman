# Coffee

A personal coffee ledger. Add a bag, score it black and milk, and it suggests the
next two — one safe pick, one stretch.

Static HTML/CSS/JS. No framework, no build step, no runtime.

```
index.html        the app
styles.css
app.js            registry + scoring
data/catalog.json 1,696 Indian coffees (generated)
data/seed.json    first-run bags
scripts/sync.py   downloads the catalog
docs/             design notes
```

## Run

```sh
python3 -m http.server 8787 -d public
open http://127.0.0.1:8787
```

Registry lives in `localStorage` under `coffee.registry.v1`. Export downloads it
as JSON.

## Sync the catalog

```sh
python3 scripts/sync.py
```

Fetches Saptabeeja's index and per-roaster details, recomputes `per100` from
price and grams, and atomically replaces `data/catalog.json`. Exits non-zero on
failure.

Cron, Monday and Thursday after their refresh:

```cron
0 7 * * 1,4 cd /Users/sambitsahoo/projects/coffepeeman && /usr/bin/python3 scripts/sync.py >> /tmp/coffee-sync.log 2>&1
```

On macOS with launchd, point a `StartCalendarInterval` job at the same command.

## How the suggestion works

- Only bags with a black or milk score count.
- A bag's weight is `(score - 3)`, averaged across the axes you rated.
- Candidates are compared on roast distance, flavour overlap, process overlap
  and price proximity, with a penalty when the catalog row is thin.
- **Safe pick**: highest score, different from your last two roasters.
- **One stretch**: ranks 4–30, different roaster from the safe pick, above a
  floor.
- Candidates need a roast, a buy link, `per100` under 1.2× your median, and are
  not merch, samplers, pods or custom blends.
