# Coffeepeeman

A personal coffee ledger. The list is public; adding and rating is private. It
suggests what to buy next based on what you actually liked.

**https://coffeepeeman.sambitsahoo.com**

## Stack

Cloudflare Worker + D1 + static assets. Alpine.js for the UI, self-hosted. No
build step, no framework, no bundler.

```
public/               static app
  index.html
  styles.css
  js/api.js           fetch calls
  js/app.js           Alpine component
  js/format.js        naming, price, flavour helpers
  js/recommend.js     scoring, pure functions
  js/alpine.min.js    self-hosted Alpine

src/                  Worker
  index.js            routes and security headers
  auth.js             owner token, session cookie
  api.js              D1 queries and validation
  login.js            login page

migrations/           D1 schema and seed
scripts/sync.py       downloads the catalog into D1
```

## How it works

- `GET /api/bags` is public: the list, scores and notes.
- `/login` takes the owner token and sets an `HttpOnly` session cookie.
- Adding, rating, and the catalog are owner-only.
- The catalog lives in D1, not in the deployed assets.
- Recommendations score catalog coffees against your rated bags on roast,
  flavour, process and price. Default is 8 picks; the count is selectable.

## Run locally

```sh
npx wrangler dev
```

Local D1 starts empty:

```sh
npx wrangler d1 execute coffee-ledger --local --file=migrations/0001_init.sql
```

## Deploy

```sh
npx wrangler deploy
```

The owner token is a Worker secret:

```sh
printf '%s' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
  | npx wrangler secret put OWNER_TOKEN
```

The current token is in `.owner-token` locally (gitignored). Log in at `/login`;
the session lasts a year. `/logout` clears it.

`run_worker_first = true` in `wrangler.toml` is load-bearing: without it,
Cloudflare serves the static assets directly and the token gate is bypassed.

## Sync the catalog

```sh
python3 scripts/sync.py
```

Fetches Saptabeeja's index and per-roaster details, recomputes `per100` from
price and grams, and replaces the `catalog` table. Needs `npx wrangler login`
once. Run it when you want fresh prices; Saptabeeja refreshes Monday and
Thursday.

## Security

- One entry point: `workers.dev` and preview URLs are disabled.
- Session: `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, one year.
- Login rejects cross-origin posts; token comparison is constant-time.
- Writes require the owner cookie, `application/json`, and a body under 16 KB.
- Scores are validated 1–5; prices and grams must be non-negative numbers.
- SQL is parameterised; update fields are whitelisted.
- UI uses `x-text` only (no `x-html`); buy links must be `https:`.
- CSP, HSTS, COOP, `nosniff`, frame-deny, permissions policy.
- The catalog API is owner-only; the public sees bags only.

Not done yet: rate limiting on `/login`. The token is 43 random characters, so
guessing is impractical, but a request flood can still exhaust the Workers free
quota. Cloudflare Access is the remaining layer.

## Saptabeeja and licensing

The catalog comes from [Saptabeeja](https://saptabeeja.coffee). The sync reads
`/data/catalog-index.json` and `/data/details/<roaster>.json`.

Their `robots.txt` allows crawling; there is no terms page and no licence. The
data is a private cache for personal use. No roaster images are copied, every
pick links out to the roaster, and removal requests are honoured.

Do not expose the catalog as a public API, and do not republish the dataset. For
anything beyond personal use, ask Saptabeeja first or read each roaster's own
storefront.

The code is MIT licensed. The catalog is not covered.

## Data model

- `bags` — roaster, coffee, roast, price, grams, date, black score, milk score, note
- `catalog` — Saptabeeja's coffees: name, roaster, roast, process, flavours, price, buy URL

## Next

Enable Cloudflare Access on the Worker, allow only your email, protect preview
URLs, and fail closed.
