# Coffee Ledger — design

2026-11-03

A phone-first web app that records every bag of coffee you buy, how it tasted
black and with milk, and recommends the next two bags: mostly in your lane, one
deliberate stretch.

---

## 1. Intent and why

You started drinking coffee in January 2026 and have bought ~13 bags across 10
roasters in 10 months. The pattern is already clear from your order history:
medium to medium-dark, washed or natural, caramel/toffee/chocolate/nut, ₹200–270
per 100 g, no anaerobic or experimental lots. Your only repeat purchase is
Dancing Goat's Ratnagiri Estate.

What is missing is not more catalog data — Saptabeeja already indexes 1,696
Indian bags with roast, process, estate, flavour and price. What is missing is
**your reaction to each bag**, recorded while you still remember it.

So the system is a personal feedback loop:

1. You add a bag (usually before or right after opening it).
2. You rate it on two axes — black and milk — after brewing it.
3. The app proposes two bags: one safe, one stretch.
4. Repeat.

The value compounds only if logging stays under ~15 seconds. Every design choice
below follows from that.

---

## 2. Goals

- Log a bag from a phone in under 15 seconds, with the name autocompleted from
  the catalog.
- Rate black and milk separately, plus one free-text note.
- Recommend exactly two bags per cycle: one high-confidence, one controlled
  exploration.
- Keep the catalog in sync with Saptabeeja twice a week without manual work.
- Be forkable: someone else can deploy their own instance with their own data.

## 3. Non-goals

- Multi-user accounts, comments, follows, sharing.
- OCR or photo scanning of bags.
- Public browsing/search of the full catalog (licensing — see §10).
- Price-drop alerts, stock alerts, subscription management.
- Native mobile apps.

## 4. Anti-goals

Things that would make this a failure even if it runs:

- Requires typing catalog fields (roast, process, estate) by hand.
- Ignores the black/milk split and recommends one generic "coffee".
- Dies when Saptabeeja changes its schema.
- Loses the ledger because it lives only in one browser.
- Publishes Saptabeeja's catalog as if it were ours.

## 5. Constraints

- Cloudflare Worker + D1 + static assets. One deployable unit.
- Single owner. Public read is acceptable; only the owner may write.
- Saptabeeja publishes no licence (`/terms`, `/licence` are 404). Its data may be
  cached for personal use and must not be exposed as a public API.
- Saptabeeja's `per100` field is unreliable (verified: Baarbara listed ₹162,
  live ₹256; Karma listed ₹167, live ₹256). Always recompute.
- Catalog refresh cadence: their own is Monday and Thursday mornings.
- 25 of 119 roasters have `count: 0` and no detail file. Sync must tolerate that.

---

## 6. Approaches considered

| approach | verdict | why |
|---|---|---|
| CLI only | rejected | you use your phone more; logging would die |
| TUI | rejected | same problem, more code |
| MyGo desktop app | rejected | needs Go 1.27.3 + Bun + webview packaging; the window is decoration until the loop works |
| **PWA + Worker + D1** | **chosen** | phone-first, installable, one database, forkable, free tier |

Rejected in an earlier round: local SQLite, Cloudflare Access as the only auth,
Telegram bot. The bot remains a possible second front door to the same API.

---

## 7. Architecture

```
 phone / laptop
 ┌────────────────────┐
 │  PWA (static)      │  public gallery
 │  - gallery         │  owner: add, rate, discover
 │  - add / rate      │
 │  - discover        │
 └─────────┬──────────┘
           │ fetch (JSON)
 ┌─────────▼──────────┐        ┌──────────────────┐
 │  Worker (TS)       │───────►│  D1 (SQLite)     │
 │  /api/*            │        │  catalog, bags,  │
 │  auth, recommender │        │  ratings, meta   │
 └─────────▲──────────┘        └──────────────────┘
           │ cron: Mon/Thu
 ┌─────────┴──────────┐
 │ saptabeeja.coffee  │  /data/catalog-index.json
 │ (public JSON)      │  /data/details/<roaster>.json
 └────────────────────┘
```

One Worker serves both the API and the static assets (Workers Assets binding).
No separate Pages project needed, though Pages is a valid split.

---

## 8. Data model (D1)

```sql
-- catalog: private cache of Saptabeeja, never exposed publicly
CREATE TABLE catalog_roasters (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  url         TEXT,
  platform    TEXT,           -- shopify | woo | other
  updated_at  TEXT NOT NULL
);

CREATE TABLE catalog_coffees (
  id          TEXT PRIMARY KEY,   -- "<roaster-slug>/<coffee-slug>"
  roaster     TEXT NOT NULL REFERENCES catalog_roasters(slug),
  name        TEXT NOT NULL,
  roast       TEXT,               -- light|light-medium|medium|medium-dark|dark
  process     TEXT,               -- JSON array
  species     TEXT,               -- JSON array
  estate      TEXT,
  region      TEXT,
  altitude    TEXT,               -- JSON [lo,hi]
  varieties   TEXT,               -- JSON array
  flavours    TEXT,               -- JSON array
  notes       TEXT,               -- JSON array
  price       REAL,
  grams       REAL,
  per100      REAL,               -- recomputed: price / grams * 100
  currency    TEXT DEFAULT 'INR',
  image_url   TEXT,
  buy_url     TEXT,
  available   INTEGER DEFAULT 1,
  first_seen  TEXT,
  synced_at   TEXT NOT NULL
);
CREATE INDEX idx_coffees_roaster ON catalog_coffees(roaster);
CREATE INDEX idx_coffees_per100  ON catalog_coffees(per100);

-- the ledger: what you actually bought
CREATE TABLE bags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  coffee_id    TEXT REFERENCES catalog_coffees(id),  -- nullable for manual
  roaster_name TEXT NOT NULL,
  coffee_name  TEXT NOT NULL,
  roast        TEXT,
  price        REAL,
  grams        REAL,
  per100       REAL,
  bought_at    TEXT NOT NULL,       -- ISO date
  source       TEXT NOT NULL,       -- catalog | manual
  note         TEXT,
  created_at   TEXT NOT NULL
);

-- two axes, because black and milk are different targets
CREATE TABLE ratings (
  bag_id     INTEGER PRIMARY KEY REFERENCES bags(id) ON DELETE CASCADE,
  black      INTEGER,               -- 1..5, null = never tried black
  milk       INTEGER,               -- 1..5, null = never tried with milk
  rebuy      INTEGER,               -- 0/1
  note       TEXT,
  rated_at   TEXT NOT NULL
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- meta: catalog_updated, schema_version, last_sync_at
```

A bag is immutable once logged; edits are allowed but recorded in `note` rather
than audited. v1 keeps no event log.

---

## 9. API

Public (no auth):

- `GET /api/gallery?limit=&cursor=` — bags + ratings, **price omitted**.
- `GET /api/bags/:id` — public bag view.

Owner (`Authorization: Bearer <OWNER_TOKEN>`):

- `GET  /api/search?q=` — catalog autocomplete (name, roaster, price, roast).
- `POST /api/bags` — add a bag.
- `PATCH /api/bags/:id` — fix a typo.
- `PUT  /api/bags/:id/rating` — black, milk, rebuy, note.
- `GET  /api/recommend` — two picks with reasons.
- `POST /api/sync` — manual catalog refresh.
- `GET  /api/export` — full JSON dump.

Errors are `{ error, detail }` with 401/403 on missing or wrong token.

Auth: one random 32-byte token in the Worker secret `OWNER_TOKEN`, compared in
constant time. The PWA stores it in `localStorage` after an "unlock" screen.
Bearer header, not a cookie, so there is no CSRF surface and no session server.
Losing the token means rotating the secret and re-entering it; data is unaffected.

---

## 10. Catalog sync and licensing

Cron Trigger, Monday and Thursday 02:00 IST.

1. Fetch `/data/catalog-index.json`. If its `updated` equals `meta.catalog_updated`,
   stop.
2. Upsert roasters.
3. Fetch `/data/details/<roaster>.json` for each roaster with `count > 0`
   (94 files today). Merge `summary`, `url`, `sizes` into the coffee row.
4. Recompute `per100` from price and grams; never trust their field.
5. Mark coffees absent from the new snapshot `available = 0` rather than deleting.
6. Write `catalog_updated` and `last_sync_at`.

Licensing: the catalog is a **private cache**. Public endpoints expose only your
bags and ratings. `/api/search` is owner-only, because it is effectively a
catalog query and would be redistribution. The public gallery shows bag name,
roaster, roast, your rating and note — not the catalogue.

---

## 11. Recommender

Deterministic and inspectable. No model calls in the scoring path.

Features per coffee:

- roast as ordinal 0–4
- process one-hot (washed, natural, honey, anaerobic/experimental)
- species (arabica, robusta)
- flavour tags multi-hot (the ~40 tags Saptabeeja uses)
- `log(per100)`
- estate / region presence flags

Profiles: two weighted centroids, `black` and `milk`. Each rated bag contributes
`(score - 3)` on its axis, so 1–2 subtract and 4–5 add. Unrated bags contribute
nothing.

Score = cosine similarity to the relevant centroid.

Output:

- **Safe pick** — highest score, roaster must differ from the last two bags.
- **Stretch** — best score in ranks 5–20 restricted to a process or roaster you
  have not tried, with a floor so it cannot be a bad match.
- **Guardrails** — `per100 ≤ 1.15 × your median`, roast within ±1 of your
  preference, exclude any roaster you rated ≤ 2 twice.

Cold start: seed from the 13 known bags (Sip Magic ×2, Fraction 9, Savorworks,
Riverside ×2, Odd, Dancing Goat ×3, Half Light, Kruti, Tiny Tiger, Blue Tokai).
Their ratings begin empty; the recommender falls back to the attribute prior
(medium/medium-dark, caramel/chocolate/nut, washed).

Every recommendation returns a one-line reason built from nearest neighbours:
"closest to Ratnagiri Estate (5★ black) — both washed, toffee, Chikmagalur."

---

## 12. PWA

Four screens:

1. **Gallery** — public grid of bags, roast, score chips (B/M), note. Price hidden.
2. **Add** — type a name, autocomplete from `/api/search`, prefill roaster,
   price, weight, roast; edit price and date; save.
3. **Rate** — two sliders (black, milk), rebuy toggle, note.
4. **Discover** — two cards (safe, stretch) with ₹/100g, reason, buy link.

Owner mode is a token unlock in settings; it toggles the Add/Rate/Discover tabs.
Offline: service worker caches the shell and last gallery; writes queue in
IndexedDB and flush on reconnect. Manifest makes it installable.

Stack: Vite + Preact + TypeScript, no UI framework. Small bundle, forkable.

**My call:** public gallery hides price and `buy_url`. Spend is private even if
the coffee is not.

---

## 13. Deployment and fork

- `wrangler.toml` with a D1 binding, cron trigger and assets.
- Migrations in `migrations/0001_init.sql`.
- Fork steps: clone, `wrangler d1 create`, set `OWNER_TOKEN`, `wrangler deploy`,
  open the app, paste token, run sync.

---

## 14. Risks

| risk | mitigation |
|---|---|
| Saptabeeja changes schema or blocks the crawler | sync fails loudly, last good data stays; adapters isolated in one module |
| D1 free-tier limits | 1,696 rows is trivial; details are text, well under 5 GB |
| Token leak | low stakes; rotate secret; writes only |
| Ledger loss | `/api/export` JSON dump; D1 time-travel |
| Public gallery exposing spend | price and buy link hidden |
| Catalog redistribution | public endpoints never serve catalog rows |

---

## 15. My calls (check these)

- Rating scale is 1–5 per axis, not stars or thumbs.
- Public gallery hides price and buy link.
- One Worker serves API and assets; no separate Pages project.
- Cold-start seed is the 13 bags from the Gmail registry, entered manually once.
- No event/audit log in v1.
- `workers.dev` subdomain, no custom domain.

## 16. Left to the builder

- Exact CSS and visual design.
- Whether to use Hono or plain `fetch` routing.
- Cursor pagination shape.
- Whether offline queue is v1 or a fast follow.
