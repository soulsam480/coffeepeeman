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

## Deploy

Live at **https://coffee-ledger.sambitsahoojs.workers.dev**

```sh
npx wrangler deploy
```

The Worker gates every path behind an owner token: `/login`, an `HttpOnly`
cookie, one-year session. Set or rotate the token with:

```sh
printf '%s' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
  | npx wrangler secret put OWNER_TOKEN
```

The generated token lives in `.owner-token` locally (gitignored). Losing it only
means setting a new one.

`run_worker_first = true` in `wrangler.toml` is load-bearing. Without it,
Cloudflare serves the static assets directly and the gate is bypassed.

Recommended next: put Cloudflare Access on the Worker (Workers & Pages →
`coffee-ledger` → Access), allow only your email, protect preview URLs, and set
the route to fail closed. Access runs before the Worker, so bot traffic never
touches the daily request quota.


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

## Saptabeeja and licensing

The catalog comes from [Saptabeeja](https://saptabeeja.coffee). `scripts/sync.py`
reads two public files:

```
/data/catalog-index.json
/data/details/<roaster>.json
```

**What they allow.** Their `robots.txt` is `User-agent: * / Allow: /` (only SEO
crawlers are blocked), so automated fetching is not disallowed. Their `/about`
says the data is read from each roaster's own public product listing, refreshed
Monday and Thursday, that the roaster's page is the source of truth, and that
corrections and removal requests are handled.

**What they do not grant.** There is no licence and no terms page — `/terms`,
`/licence`, `/license` and `/privacy` all return 404. `robots.txt` is not a
licence. So there is no explicit permission to redistribute their catalog.

**What this project does about it.**

- The catalog is a **private cache for personal use**, not a republished dataset.
- We do not copy roaster images; `catalog.json` stores no image URLs.
- Every recommendation links out to the roaster to buy.
- If Saptabeeja or a roaster asks for a coffee or a brand to be removed, remove it.

**If you fork this and deploy it publicly:** do not serve `data/catalog.json` as
a public file or turn it into an open catalog API. Put the file behind auth, or
fetch from the roaster's own storefront (Shopify `products.json`, Woo Store API)
instead. For anything beyond personal use, ask Saptabeeja first.

The code is yours to fork. The catalog is not.

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
