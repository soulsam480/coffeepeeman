# Recommendation engine: gradual exploration — design

2026-11-04

## Intent

The current recommendation list is deterministic and narrow: on today's real
data it returns eight medium-roast coffees, every card says "same medium
profile", and the one "stretch" pick was another medium roast at ₹118/100g.
The owner wants the list to feel alive and to gently widen their taste over
time — new processes, roasts and flavour families — without ever jumping to a
completely different kind of coffee.

Random is a tool here, not the goal. Pure random would serve bad coffee more
often. The goal is **controlled exploration**: a mostly familiar slate with a
few deliberate one-step-out picks, varied within the slate, and different on
each visit.

## Goals

- A fresh, coherent slate on each visit (seeded sampling, not deterministic).
- A visible mix: roughly half comfort, a third one step out, the rest further.
- Novelty is limited: at most one unfamiliar axis per coffee at the default
  setting, and never a coffee with no anchor in what the owner already likes.
- The slate itself is diverse: not eight medium chocolate/caramel bags.
- Fix the data loss: flavours and process are persisted with each bag.
- Widen the candidate pool with a soft price preference instead of the current
  hard ₹264/100g cap.
- Every pick explains what is familiar and what is new.

## Non-goals

- Collaborative filtering — there is one user.
- Contextual bandits / online learning — not enough feedback yet. Phase 2.
- Embeddings, LLMs, or a server-side model.
- Telemetry, click tracking, or accounts.
- Catalog changes or republishing Saptabeeja data.

## Constraints

- 14 rated bags, 10 roasters; 1,696 catalog coffees (260 pass the current
  filters). Sparse data.
- Historical bags have no stored `flavours` or `process`, and their names do not
  match catalog names (`0 of 14` exact matches). Five roasters are no longer in
  the catalog. All 14 can still be mapped by hand from the Saptabeeja data and
  the roasters' own product pages; the mapping is part of this work.
- Recommendation runs in the browser, owner-only, over the full catalog.
- No build step, no framework. Vanilla ES modules + Alpine.
- `bags` is D1; changing its shape needs a migration.

## Approaches considered

**A. Comfort ladder + MMR + softmax sampling (chosen).** Profile-based content
scoring, then fill the slate in familiarity bands, rerank for diversity, and
sample instead of sorting. Directly encodes gradual exploration, explainable,
works with sparse data.

**B. Contextual bandit (Thompson sampling).** Learns feature preferences and
explores uncertain arms. Theoretically stronger, but 14 bags is too little
signal, there is no impression/buy feedback, and early slates could wander.
Revisit after the app records clicks.

**C. Weighted random top-N + slider.** Cheap and refreshing, but leaves the
medium-roast skew, the dead process matching and the samey slates intact.

## Design

### 1. Data: store bag features

Migration `0004_bag_features.sql`:

```sql
ALTER TABLE bags ADD COLUMN flavours TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bags ADD COLUMN process TEXT NOT NULL DEFAULT '[]';
```

- Add both to `BAG_COLUMNS`, `createBag` insert, and validation. The client
  already sends them when a bag is picked from the catalog.
- Parse as JSON arrays on read, like catalog rows.
- Backfill all 14 existing bags in `0005_backfill_bag_features.sql`, using the
  Saptabeeja rows where they exist and the roaster's own product page where
  they do not. Two bags with missing roast metadata (`Tripura Hills`,
  `DG Microlot #1`) get their roast set from the roaster at the same time.
  The bag's own note still contributes flavours through `deriveFlavours`, so
  stored and note-derived tags are unioned at scoring time.

### 1a. Manual backfill mapping

| Bag | Roaster | Roast | Process | Flavours | Source |
|---|---|---|---|---|---|
| Monsoon Melody | Sip Magic | medium | monsooned | chocolate, caramel, vanilla | sipmagic.in |
| Mysore Nuggets Bold | Sip Magic | medium-dark | washed | chocolate, nutty, citrus | sipmagic.in + typical washed Mysore Nuggets |
| Caramel Espresso | Tiny Tiger Coffee | medium-dark | natural | caramel, fruity, vanilla | tinytigercoffee.in |
| Ratnagiri Estate (×2) | Dancing Goat | medium | washed | chocolate, fruity | dancinggoatcoffee.in |
| Everyday Gold | Fraction 9 | medium | experimental, washed | chocolate, nutty, fruity | catalog exact |
| Mad Monkey Medium | Riverside Coffee | medium | anaerobic | berry, fruity, citrus | riversidecoffee.co.in |
| Breakfast Blend, Light Roast | Odd Coffee Roasters | light | — | floral, fruity, chocolate | indiancoffeebeans.com |
| Riverdale, Medium to Dark | Savorworks | medium-dark | washed | caramel, nutty, fruity | catalog exact |
| Skia Estate, Nelaji | Riverside Coffee | medium | honey | nutty, fruity, caramel | riversidecoffee.co.in |
| Tripura Hills | Half Light Coffee | light-medium (backfill) | natural | chocolate, caramel, nutty | indiancoffeebeans.com |
| DG Microlot #1 | Dancing Goat | medium-dark (backfill) | natural | chocolate, caramel, nutty, citrus | indiancoffeebeans.com |
| 13th Birthday Blend | Blue Tokai | medium | honey, natural | chocolate, fruity, berry | catalog exact |
| Koraput Arabica Blend | Kruti Coffee | medium | washed | chocolate | catalog exact |

### 2. Taste profile

Only bags with a rating contribute. For each bag:

- `liking = mean(black, milk)` using whichever score exists (1–5).
- `weight = (liking - 3) / 2`, clipped to −1…+1. 3 is neutral, 1 is −1, 5 is +1.
- Recency decay `2^(-ageDays / 180)`, floored at 0.15 so old favourites still
  count.
- Final `signed = weight * decay`.

Build:

- **Roast**: weighted mean position on the light→dark scale; also remember every
  roast with a positive weight.
- **Flavours**: signed tag weights over the flavour vocabulary; IDF-weighted so
  rare tags (floral, boozy) are not drowned by chocolate/caramel.
- **Process**: signed tag weights (washed, natural, honey, anaerobic, …).
- **Price**: weighted median `per100` of liked bags.

Negative ratings subtract from the profile (Rocchio-style), so a disliked
flavour family is avoided rather than merely ignored.

### 3. Affinity score

For each candidate, 0–1:

- roast similarity by distance from the profile's roast position;
- flavour similarity by cosine over IDF-weighted tag vectors;
- process similarity by tag overlap;
- price similarity by a Gaussian on `log(candidatePer100 / preferredPer100)`,
  sigma 0.35.

Weights: flavour 0.40, roast 0.30, process 0.15, price 0.15. Missing candidate
or profile features are neutral (0.5) and lower a small confidence multiplier —
never a hard rejection.

### 4. Novelty and the anchor rule

Three novelty axes, counted only when the profile has evidence for that axis:

- **Roast**: candidate roast is two or more steps from the nearest liked roast.
- **Process**: candidate shares no process with liked processes.
- **Flavour**: candidate shares no tag with the top five liked flavours.

Rules:

- At most **one** novel axis per pick at the default adventure level.
- At most **two** when adventure ≥ 70.
- Every pick must match at least one positive attribute (a liked flavour,
  process, or roast within one step). No totally alien coffee.
- Roast distance is capped at 2 steps (3 at high adventure), so a medium-dark
  drinker can be offered a light roast but never a dark one in the same slate.

This is the "slow" part: the engine can only step to a frontier one attribute
away, and the frontier moves as new bags are rated.

### 5. Slate construction

Adventure `a` is 0–100, default 40. Shares:

- familiar = `0.65 - 0.35 * a/100`
- adjacent = `0.25 + 0.10 * a/100`
- explore = the remainder

At `a=40`, an 8-pick slate is 4 familiar / 2 adjacent / 2 explore. The same
shares apply to 4, 12 and 20.

Within each band, sample without replacement with softmax weights
`exp(score / T)`, `T = 0.02 + 0.10 * a/100`. Low adventure is nearly deterministic;
high adventure is visibly varied. A supplied seed makes runs reproducible in
tests.

Diversity reranking (MMR, λ = 0.7 relevance / 0.3 diversity) penalises picks
that are near-duplicates of ones already chosen. Candidate-candidate similarity:
roast 0.35, flavour 0.35, process 0.15, same roaster 0.15. Keep the current
one-coffee-per-roaster preference, but relax it when the pool is too small.

### 6. Price

Replace the hard median × 1.2 cap with:

- soft Gaussian preference (above);
- hard floor ₹100/100g (as now);
- hard ceiling `2.5 × preferredPer100` (≈ ₹550 on today's data), tunable.

This lifts the pool from 260 to roughly 700 coffees without letting ₹2,000 bags
through.

### 7. Explanations and UI

Return structured reasons from `recommend()`:

- `kind`: `Comfort pick`, `One step out`, `Something new`.
- `novelty`: which axes are new.
- `matchedFlavours`, `matchedProcess`, `closest`.

Copy examples:

- "Your usual medium, chocolate and caramel."
- "Same chocolate base, new natural process."
- "One shade lighter than your usual, still washed."
- "New for you: floral and honey, but still a medium roast."

UI additions on the Next tab:

- **Comfort ↔ Explore** range slider (0–100), persisted in `localStorage` like
  the pick count.
- **Shuffle** button that rerolls the slate.
- Kind labels use the new three names.

### 8. Files

- `migrations/0004_bag_features.sql` — new columns.
- `src/api.js` — persist/validate/parse bag features.
- `public/js/recommend.js` — profile, affinity, novelty, bands, MMR, sampling.
- `public/js/app.js` — adventure state, shuffle, reason copy.
- `public/index.html` — slider, shuffle, labels.
- `public/styles.css` — toolbar slider styling.
- `test/recommend.test.js` — node:test unit tests.
- `package.json` — `"type": "module"`, `"test": "node --test"`.

### 9. Verification

- Unit tests with a seeded RNG:
  - same seed → same slate; different seeds → different slates;
  - no pick with more than one novel axis at default adventure;
  - every pick anchors to a liked attribute;
  - at least two roast positions and three distinct roasters in an 8-pick slate;
  - owned coffees and non-coffee items excluded;
  - price within floor/ceiling;
  - a disliked flavour does not dominate the top band.
- Local D1 migration test, then the deployed site: log in via Chromium, capture
  the Next tab before/after, confirm the visible mix and fresh rerolls.

## Risks

- Historical bags now carry hand-mapped features, but a few fields are
  inferences (Mysore Nuggets process, Breakfast Blend process). The algorithm
  treats missing features as neutral, so a wrong one is not catastrophic; the
  mapping can be corrected later.
- Randomness can surface a dud. The novelty cap, anchor rule, affinity floor and
  MMR limit the blast radius; the shuffle button makes recovery cheap.
- The comfort slider needs a clear label; "Try new things" may read better than
  "Adventure".

## Decisions left to the builder

- Final band shares, temperature and weights — tune against the real catalog,
  keeping the defaults above as the starting point.
- Exact slider and button copy.
- Whether to show novelty chips on cards or only in the reason sentence.
