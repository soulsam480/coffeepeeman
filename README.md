# Coffee

A personal coffee ledger. The list is public. Adding and rating is private.

Add a bag, score it black and milk, and it suggests the next two — one safe pick,
one stretch.

## How it's built

```
public/            static app, no build step
  index.html
  styles.css
  js/api.js        fetch calls
  js/format.js     naming, price, flavour helpers
  js/recommend.js  scoring (pure functions)
  js/app.js        DOM and state

src/               Cloudflare Worker
  index.js         routes
  auth.js          owner token, cookie
  api.js           D1 queries
  login.js         login page

migrations/        D1 schema and seed
scripts/sync.py    downloads the catalog into D1
```

D1 tables:

- `bags` — what you bought and how you scored it (single source of truth)
- `catalog` — Saptabeeja's coffees, private, owner-only

## Run locally

```sh
npx wrangler dev
```

Local D1 starts empty. Apply the schema first:

```sh
npx wrangler d1 execute coffee-ledger --local --file=migrations/0001_init.sql
```

## Deploy

Live at **https://coffeepeeman.sambitsahoo.com**

```sh
npx wrangler deploy
```

The owner token is a Worker secret:

```sh
printf '%s' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
  | npx wrangler secret put OWNER_TOKEN
```

The current one is in `.owner-token` locally (gitignored). Log in at `/login`;
the session is an `HttpOnly` cookie lasting a year. `/logout` clears it.

`run_worker_first = true` in `wrangler.toml` is load-bearing — without it,
Cloudflare serves the static assets directly and the gate is bypassed.

## Sync the catalog

```sh
python3 scripts/sync.py
```

Fetches Saptabeeja's index and per-roaster details, recomputes `per100` from
price and grams, and replaces the `catalog` table. Needs `npx wrangler login`
once. Run it whenever you want fresh prices — Monday and Thursday is when
Saptabeeja refreshes.

## Saptabeeja and licensing

The catalog comes from [Saptabeeja](https://saptabeeja.coffee). The sync reads
two public files:

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
licence. There is no explicit permission to redistribute their catalog.

**What this project does about it.**

- The catalog is a private cache, served only to the owner.
- No roaster images are copied.
- Every recommendation links out to the roaster to buy.
- If Saptabeeja or a roaster asks for something to be removed, remove it.

**If you fork this and deploy it publicly:** do not expose the catalog API or
turn it into an open catalogue. For anything beyond personal use, ask Saptabeeja
first, or fetch straight from each roaster's storefront.

The code is yours to fork. The catalog is not.

## Next

Put Cloudflare Access on the Worker (Workers & Pages → `coffee-ledger` →
Access), allow only your email, protect preview URLs, and set the route to fail
closed. Access runs before the Worker, so bot traffic never touches the daily
request quota.
