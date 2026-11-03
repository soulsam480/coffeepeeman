# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

plain static HTML/CSS/vanilla JS, served as Cloudflare Worker assets. No build
step. Forkable by copying the folder.

## Users

One person: the owner. Drinks coffee at home, buys 1–2 bags a month from Indian
roasters online, and uses a phone far more than a laptop. Brews mostly moka pot,
sometimes V60 and cold brew. Drinks roughly 50/50 black (brewed strong, diluted
with hot water) and milk coffee.

Job: remember what every bag tasted like, and choose the next bag without
wasting money on something they will not enjoy.

## Product Purpose

A personal coffee ledger and recommender. It records each bag bought, how it
tasted black and with milk, and proposes two bags to buy next — one safe, one
controlled stretch. Success means still logging after three months, fewer
disappointing bags, and deliberate exploration instead of random buys.

## Positioning

The catalog already exists elsewhere; the missing dataset is the owner's own
reaction to each bag. This product is the feedback loop: a two-axis (black/milk)
taste model over a live Indian coffee catalog, with an exploration quota that is
bounded rather than random.

## Operating Context

- Bags are bought online from Indian roasters; prices are per 250 g, sometimes 500 g or 1 kg.
- Taste band observed Jan–Oct 2026: medium to medium-dark, washed or natural, caramel/toffee/chocolate/nut, ₹200–270 per 100 g. No anaerobic or experimental lots.
- Moka pot is the primary brew; black is diluted with hot water.
- The catalog source is Saptabeeja's public JSON, refreshed Monday and Thursday.
- The public URL is a gallery anyone may read. Only the owner may add or rate.

## Capabilities and Constraints

- Public read; owner-only write behind a single bearer token.
- Catalog sync from Saptabeeja; the catalog is private and must never be served publicly.
- The public gallery hides price and buy links.
- Cheap by design: static assets are cached at the edge; dynamic requests are only auth, add, rate, search and recommend.
- Abuse protection matters: a spam flood must not create Cloudflare cost. Public reads must be cacheable and rate-limited.
- D1 is SQLite; schema stays portable.
- No OCR, no scanning, no multi-user accounts.

## Evidence on Hand

- 13 real purchases from Gmail, Jan–Oct 2026 (Sip Magic ×2, Fraction 9, Savorworks, Riverside ×2, Odd, Dancing Goat ×3, Half Light, Kruti, Tiny Tiger, Blue Tokai).
- Saptabeeja snapshot: 119 roasters, 1,696 Indian coffees with roast, process, estate, flavour, price, buy URL (`recon/saptabeeja/`).
- Design document: `docs/superpowers/specs/2026-11-03-coffee-ledger-design.md`.

## Product Principles

1. Logging must take under 15 seconds, or the system dies.
2. Black and milk are separate tastes and get separate scores.
3. Always one safe pick and one bounded stretch; never a random surprise.
4. The owner's data is exportable and the app degrades gracefully without the catalog.
5. Cheap to run: cache what can be cached, and make writes the only expensive path.

## Accessibility & Inclusion

Used one-handed on a phone, often in a kitchen. Large tap targets, strong
contrast in daylight, and no reliance on hover.
