# Gradual Exploration Recommendation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic, medium-roast-skewed recommender with a profile-based engine that samples a fresh slate in comfort/one-step/further bands, capped at one unfamiliar axis by default.

**Architecture:** Pure client-side content scoring (`public/js/recommend.js`) builds a recency- and rating-weighted taste profile over roast, flavour tags, process and price; scores every catalog coffee; routes candidates into familiarity bands; then samples with MMR diversity and softmax temperature. Bag features are persisted in D1 so process and flavour matching actually work. A slider and Shuffle button in the Next tab control and reroll the slate.

**Tech Stack:** Cloudflare Worker, D1, vanilla ES modules, Alpine.js, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-04-recommendation-exploration-design.md`

## Global Constraints

- No build step, no framework, no new runtime dependencies.
- Recommendation runs in the browser over the full catalog; catalog API stays owner-only.
- Default adventure `40`; an 8-pick slate is 4 comfort / 2 one-step / 2 further.
- At adventure `< 70`, at most **one** novel axis per pick; at `>= 70`, at most two. Never three.
- Every pick must match at least one positive attribute (roast within one step, a liked flavour, or a liked process).
- Roast distance cap: 2 steps below adventure 70, 3 steps at or above.
- Price floor ₹100/100g; ceiling `2.5 × preferredPer100`.
- UI uses `x-text` only — never `x-html`.
- D1 changes must be additive; never re-run `0001_init.sql` against production.
- Existing recipes and copy stay as-is unless a task names them.

## Review Focus

- **Catalog row missing roast, flavours, process, or per100:** must be skipped or scored neutral, never throw.
- **Bag with only one score (black or milk) or both null:** weight comes from the score that exists; both null means the bag is excluded.
- **Catalog or eligible pool smaller than `limit`:** return fewer picks, never loop or pad with ineligible coffees.
- **All ratings neutral or negative (no positive signal):** still return a coherent slate using roast/price, without dividing by zero.
- **Bag with missing price or grams:** `per100` is null, so it contributes no price preference and cannot crash the profile.

---

### Task 0: Commit the OG preview work separately

**Files:**
- Commit only: `README.md`, `package.json`, `public/index.html`, `public/og.png`, `scripts/og-card.html`, `scripts/render-og.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean tree so the recommender commits do not mix with the OG card.

- [ ] **Step 1: Commit the existing OG work**

```bash
git add README.md package.json public/index.html public/og.png scripts/og-card.html scripts/render-og.sh
git commit -m "Add OG preview card and meta tags"
```

- [ ] **Step 2: Confirm the tree**

Run: `git status --short`
Expected: only `docs/` remains untracked.

---

### Task 1: Persist bag features and backfill the 14 bags

**Files:**
- Create: `migrations/0004_bag_features.sql`
- Create: `migrations/0005_backfill_bag_features.sql`
- Modify: `src/api.js:1-12, 55-90, 96-125, 126-150, 180-230`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET/POST/PATCH /api/bags` return `flavours: string[]` and `process: string[]`; existing 14 rows have hand-mapped values.

- [ ] **Step 1: Write the schema migration**

```sql
ALTER TABLE bags ADD COLUMN flavours TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bags ADD COLUMN process TEXT NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Write the manual backfill migration**

Use `WHERE roaster = ... AND name = ...` so it also works on a re-seeded local DB. The two `Ratnagiri Estate` rows share the same mapping.

```sql
UPDATE bags SET flavours='["chocolate","caramel","vanilla"]', process='["monsooned"]' WHERE roaster='Sip Magic' AND name='Monsoon Melody';
UPDATE bags SET flavours='["chocolate","nutty","citrus"]', process='["washed"]' WHERE roaster='Sip Magic' AND name='Mysore Nuggets Bold';
UPDATE bags SET flavours='["caramel","fruity","vanilla"]', process='["natural"]' WHERE roaster='Tiny Tiger Coffee' AND name='Caramel Espresso';
UPDATE bags SET flavours='["chocolate","fruity"]', process='["washed"]' WHERE roaster='Dancing Goat' AND name='Ratnagiri Estate';
UPDATE bags SET flavours='["chocolate","nutty","fruity"]', process='["experimental","washed"]' WHERE roaster='Fraction 9' AND name='Everyday Gold';
UPDATE bags SET flavours='["berry","fruity","citrus"]', process='["anaerobic"]' WHERE roaster='Riverside Coffee' AND name='Mad Monkey Medium';
UPDATE bags SET flavours='["floral","fruity","chocolate"]', process='[]' WHERE roaster='Odd Coffee Roasters' AND name='Breakfast Blend, Light Roast';
UPDATE bags SET flavours='["caramel","nutty","fruity"]', process='["washed"]' WHERE roaster='Savorworks' AND name='Riverdale, Medium to Dark';
UPDATE bags SET flavours='["nutty","fruity","caramel"]', process='["honey"]' WHERE roaster='Riverside Coffee' AND name='Skia Estate, Nelaji';
UPDATE bags SET roast='light-medium', flavours='["chocolate","caramel","nutty"]', process='["natural"]' WHERE roaster='Half Light Coffee' AND name='Tripura Hills';
UPDATE bags SET roast='medium-dark', flavours='["chocolate","caramel","nutty","citrus"]', process='["natural"]' WHERE roaster='Dancing Goat' AND name='DG Microlot #1';
UPDATE bags SET flavours='["chocolate","fruity","berry"]', process='["honey","natural"]' WHERE roaster='Blue Tokai' AND name='13th Birthday Blend';
UPDATE bags SET flavours='["chocolate"]', process='["washed"]' WHERE roaster='Kruti Coffee' AND name='Koraput Arabica Blend';
```

- [ ] **Step 3: Extend the API columns and parser**

In `src/api.js`:

- `BAG_COLUMNS` becomes `"id, roaster, name, roast, price, grams, date, black, milk, note, flavours, process, created_at"`.
- Add `flavours` and `process` to `EDITABLE_FIELDS`.
- Add `const MAX_TAGS = 20;` and `const MAX_TAG_LENGTH = 40;`.
- Add `isTags(value)` and `sanitizeTags(value)`:

```js
function isTags(value) {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_TAGS &&
      value.every(
        (tag) => typeof tag === "string" && tag.length <= MAX_TAG_LENGTH,
      ))
  );
}

function sanitizeTags(value) {
  return Array.isArray(value)
    ? value
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_TAGS)
    : [];
}
```

- `parseBagRow(row)` returns `{ ...row, flavours: parseArray(row.flavours), process: parseArray(row.process) }`.
- `listBags` maps rows through `parseBagRow`.
- `createBag` inserts `flavours, process` and binds `JSON.stringify(sanitizeTags(body.flavours))` and the same for process; returns `parseBagRow(row)`.
- `updateBag` stores arrays as JSON and returns `parseBagRow(row)`.
- `validateCreate` and `validateUpdate` reject when `!isTags(body.flavours)` or `!isTags(body.process)`, with messages `"invalid flavours"` and `"invalid process"`.

- [ ] **Step 4: Apply migrations locally and verify the rows**

Run:

```bash
npx wrangler d1 execute coffee-ledger --local --file=migrations/0001_init.sql
npx wrangler d1 execute coffee-ledger --local --file=migrations/0004_bag_features.sql
npx wrangler d1 execute coffee-ledger --local --file=migrations/0005_backfill_bag_features.sql
npx wrangler d1 execute coffee-ledger --local --json --command "SELECT roaster, name, roast, flavours, process FROM bags ORDER BY id"
```

Expected: 14 rows; every row has non-empty `flavours`; `Tripura Hills` is `light-medium`; `DG Microlot #1` is `medium-dark`.

- [ ] **Step 5: Verify the API returns arrays**

Run `npx wrangler dev --port 8788` in the background, then:

```bash
TOKEN=$(cat .owner-token)
curl -s -c /tmp/cp/cookies.txt -X POST http://127.0.0.1:8788/login \
  -H "Origin: http://127.0.0.1:8788" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "token=$TOKEN" >/dev/null
curl -s -b /tmp/cp/cookies.txt http://127.0.0.1:8788/api/bags \
  | python3 -c "import sys,json; b=json.load(sys.stdin); print(len(b), type(b[0]['flavours']).__name__, b[0]['flavours'])"
```

Expected: `14 list [...]` (or the first bag's populated array).

- [ ] **Step 6: Commit**

```bash
git add src/api.js migrations/0004_bag_features.sql migrations/0005_backfill_bag_features.sql docs/
git commit -m "Persist and backfill bag flavour and process features"
```

---

### Task 2: Build the gradual-exploration engine

**Files:**
- Modify: `public/js/recommend.js` (replace the current file)
- Create: `test/recommend.test.js`
- Modify: `package.json` (add `"type": "module"`, `"test": "node --test"`)

**Interfaces:**
- Consumes: `deriveFlavours`, `per100` from `public/js/format.js`; bags with `flavours`/`process` arrays from Task 1.
- Produces:

```js
export const DEFAULT_ADVENTURE = 40;
export function recommend(bags, catalog, options = {}) // options: { limit, adventure, seed, now }
```

Each pick: `{ coffee, score, kind, novelty, matchedFlavours, matchedProcess, anchored, closest, isNewRoaster }`, where `kind` is `"Comfort pick" | "One step out" | "Something new"`, `novelty` is `{ roast, process, flavour }`, `anchored` is true when the pick shares a liked attribute, and `score` is 0–1 affinity.

- [ ] **Step 1: Add the test harness**

In `package.json`, add `"type": "module"` and `"test": "node --test"`.

- [ ] **Step 2: Write the failing tests**

Create `test/recommend.test.js` with a fixture helper and these assertions:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { recommend, DEFAULT_ADVENTURE } from "../public/js/recommend.js";

// Build ~30 candidates across 3 roasters and all five roasts.
// Bag A: 5/4, medium, chocolate/caramel, washed, ₹550/250g, 2026-09-01
// Bag B: 4/4, medium-dark, chocolate/nutty, natural, ₹600/250g, 2026-10-01
// Bag C: 2/2, light, floral/citrus, honey, ₹500/250g, 2026-07-01

test("no ratings returns no picks", () => {
  assert.deepEqual(recommend([], catalog, { seed: 1 }), []);
});

test("same seed is reproducible and another seed differs", () => {
  const a = recommend(bags, catalog, { limit: 8, seed: 42 });
  const b = recommend(bags, catalog, { limit: 8, seed: 42 });
  const c = recommend(bags, catalog, { limit: 8, seed: 7 });
  assert.deepEqual(a.map((p) => p.coffee.id), b.map((p) => p.coffee.id));
  assert.notDeepEqual(a.map((p) => p.coffee.id), c.map((p) => p.coffee.id));
});

test("default adventure caps novelty at one axis and anchors every pick", () => {
  const picks = recommend(bags, catalog, { limit: 8, seed: 42 });
  for (const pick of picks) {
    const axes = Object.values(pick.novelty).filter(Boolean).length;
    assert.ok(axes <= 1, `${pick.coffee.name} had ${axes} novel axes`);
    assert.ok(
      pick.anchored,
      `${pick.coffee.name} had no anchor in the liked profile`,
    );
  }
});

test("high adventure allows two axes but never three", () => {
  const picks = recommend(bags, catalog, {
    limit: 12,
    adventure: 85,
    seed: 42,
  });
  for (const pick of picks) {
    assert.ok(Object.values(pick.novelty).filter(Boolean).length <= 2);
  }
});

test("default slate is 4 comfort, 2 one-step, 2 further", () => {
  const picks = recommend(bags, catalog, { limit: 8, seed: 42 });
  const counts = picks.reduce((acc, p) => {
    acc[p.kind] = (acc[p.kind] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, {
    "Comfort pick": 4,
    "One step out": 2,
    "Something new": 2,
  });
});

test("slate is diverse and excludes owned or non-coffee rows", () => {
  const picks = recommend(bags, catalog, { limit: 8, seed: 42 });
  assert.ok(new Set(picks.map((p) => p.coffee.roast)).size >= 2);
  assert.ok(new Set(picks.map((p) => p.coffee.roaster)).size >= 4);
  for (const pick of picks) {
    assert.ok(pick.coffee.url.startsWith("https://"));
    assert.ok(!/pods|chicory|gift/i.test(pick.coffee.name));
  }
});

test("missing catalog features and missing bag scores do not throw", () => {
  const sparse = catalog.map((c, i) =>
    i % 5 === 0 ? { ...c, flavours: [], process: [], roast: null } : c,
  );
  const oneSided = bags.map((b, i) =>
    i % 2 ? { ...b, black: null, milk: 4 } : b,
  );
  assert.doesNotThrow(() => recommend(oneSided, sparse, { seed: 3 }));
});

test("a tiny pool returns fewer picks without looping", () => {
  const picks = recommend(bags, catalog.slice(0, 2), { limit: 8, seed: 1 });
  assert.ok(picks.length <= 2);
});

test("missing per100 is skipped and all-neutral ratings still return a slate", () => {
  const noPrice = catalog.map((c, i) =>
    i % 7 === 0 ? { ...c, per100: null, price: null } : c,
  );
  const neutral = bags.map((b) => ({ ...b, black: 3, milk: 3 }));
  const picks = recommend(bags, noPrice, { limit: 8, seed: 5 });
  assert.ok(picks.length > 0);
  assert.doesNotThrow(() => recommend(neutral, noPrice, { seed: 5 }));
});

test("liked flavours outrank a disliked-only candidate", () => {
  const picks = recommend(bags, catalog, { limit: 20, seed: 42 });
  const liked = picks.find((p) => p.coffee.flavours.includes("chocolate"));
  const disliked = picks.find(
    (p) =>
      p.coffee.flavours.length &&
      p.coffee.flavours.every((f) => f === "floral" || f === "citrus"),
  );
  if (liked && disliked) assert.ok(liked.score > disliked.score);
});

test("price ceiling is 2.5x the preferred per100", () => {
  const expensive = catalog.map((c, i) =>
    i === 0 ? { ...c, per100: 2000, price: 5000, grams: 250 } : c,
  );
  const picks = recommend(bags, expensive, { limit: 8, seed: 42 });
  assert.ok(!picks.some((p) => p.coffee.id === expensive[0].id));
});
```

Add a fixture that guarantees enough eligible candidates for the seed test. Assert `pick.anchored` exists in the returned shape.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL — `recommend` still has the old signature / no `anchored`.

- [ ] **Step 4: Implement the engine**

Replace `public/js/recommend.js` with these pieces, keeping the existing `NON_COFFEE`, `ROAST_ORDER`, `nameKey`, and `per100` imports:

- Constants: `DEFAULT_LIMIT=8`, `DEFAULT_ADVENTURE=40`, `HIGH_ADVENTURE=70`, `HALF_LIFE_DAYS=180`, `MIN_DECAY=.15`, `PRICE_FLOOR=100`, `PRICE_SIGMA=.35`, `PRICE_CEILING=2.5`, `MMR_LAMBDA=.7`, `NEUTRAL=.5`.
- `bagFeatures(bag)` returns `{ roast, flavours: unique([...(bag.flavours||[]), ...deriveFlavours(bag.note)]), process: bag.process || [], per100: per100(bag) }`.
- `liking(bag)` averages `black` and `milk` when present; `weight = clamp((liking - 3) / 2, -1, 1) * max(MIN_DECAY, 2^(-ageDays/180))`.
- `buildProfile(bags, catalog, now)` returns `{ roastCenter, positiveRoasts, flavourWeights, processWeights, topFlavours, hasFlavour, hasProcess, pricePer100, hasPositive }`. Compute tag IDF from the catalog (`log((n+1)/(df+1)) + 1`).
- `affinity(coffee, profile, idf)` returns 0–1: roast `.3`, flavour `.4` (cosine over IDF-weighted signed profile), process `.15`, price `.15` (Gaussian on `log(candidate/preferred)`), each missing feature neutral `.5`; multiply by `0.85 + 0.15 * coverage`.
- `noveltyOf(coffee, profile, adventure)` returns `{ axes, novelty, roastDistance, matchedFlavours, matchedProcess, anchored }`. Only count an axis when the profile has evidence for it. Reject if roast distance exceeds the cap, axes exceed `adventure >= 70 ? 2 : 1`, or `!anchored`.
- `bandOf(pick)` → `Comfort pick` when `axes=0`; `One step out` when `axes=1 && score >= .45`; otherwise `Something new`.
- Quotas: `comfort = round(limit * (.65 - .35*a/100))`, `adjacent = round(limit * (.25 + .10*a/100))`, `explore = limit - comfort - adjacent`.
- `sampleBand(pool, count, selected, rng, temperature)`:
  - utility = `.7*score - .3*max(pairSimilarity(candidate, selected))`;
  - pair similarity = roast `.35`, flavour `.35`, process `.15`, same roaster `.15`;
  - softmax weights `exp((utility - maxUtility) / T)`, `T = .02 + .10*a/100`;
  - weighted sample without replacement; prefer a roaster not already selected when alternatives exist.
- Fill comfort, then adjacent, then explore. If a band is short, top up from the nearest remaining eligible candidates; return fewer when the pool is exhausted.
- `closest` is the positive bag with the highest pairwise feature similarity.
- Seed: `mulberry32(seed)`, default `Math.floor(Math.random() * 2 ** 32)`.
- Keep `recommend(bags, catalog, limitNumber)` working by treating a number as `{ limit: limitNumber }`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Sanity-check against the real data**

Run the engine over `/tmp/cp/bags.clean.json` and `/tmp/cp/catalog.parsed.json` (or fresh API dumps) at limit 8, adventure 40, three different seeds. Expected: 4/2/2 kinds, at least two roasts and four roasters per slate, and visibly different sets.

- [ ] **Step 7: Commit**

```bash
git add public/js/recommend.js test/recommend.test.js package.json
git commit -m "Add comfort-ladder recommendation engine with exploration"
```

---

### Task 3: Wire the slider, shuffle and reasons into the UI

**Files:**
- Modify: `public/js/app.js:1-10, 25-60, 150-170`
- Modify: `public/index.html:283-340`
- Modify: `public/styles.css:371-390`

**Interfaces:**
- Consumes: `recommend(bags, catalog, { limit, adventure })` and pick shape from Task 2.
- Produces: persisted `coffee.adventure`, a `shuffle()` action, and new reason copy.

- [ ] **Step 1: Add adventure state and actions**

In `app.js`:

- `import { recommend, DEFAULT_ADVENTURE } from "./recommend.js";`
- `const ADVENTURE_KEY = "coffee.adventure";`
- Initialize `adventure` from `localStorage`, falling back to `DEFAULT_ADVENTURE`.
- `setAdventure()` writes the value and calls `loadPicks()`.
- `shuffle()` calls `loadPicks()`.
- `loadPicks()` calls `recommend(this.bags, catalog, { limit: this.count, adventure: this.adventure })`.
- Replace `reason(pick, index)`:

```js
reason(pick) {
  const matched = pick.matchedFlavours.slice(0, 2).join(" and ");
  if (pick.kind === "Comfort pick") {
    return `Your usual ${pick.coffee.roast}${matched ? `, ${matched}` : ""}.`;
  }
  const novel = [];
  if (pick.novelty.roast) novel.push("a different roast");
  if (pick.novelty.process) novel.push("a new process");
  if (pick.novelty.flavour) novel.push("new flavours");
  const change = novel.join(" and ") || "a small change";
  return pick.kind === "One step out"
    ? `Same ${matched || "profile"}, ${change}.`
    : `Something new for you: ${change}${matched ? `, still ${matched}` : ""}.`;
}
```

- [ ] **Step 2: Add the controls**

Below the existing Show toolbar in `index.html`:

```html
<div class="picks-toolbar picks-tuning">
  <label class="toolbar-label" for="adventure">Try new things</label>
  <input
    id="adventure"
    class="adventure"
    type="range"
    min="0"
    max="100"
    step="5"
    x-model.number="adventure"
    @change="setAdventure()"
    :aria-valuetext="adventure + ' out of 100'"
  />
  <button class="ghost" type="button" @click="shuffle()">Shuffle</button>
</div>
```

- [ ] **Step 3: Style the second toolbar**

Add:

```css
.picks-tuning {
  justify-content: flex-start;
  gap: 14px;
  margin-top: -4px;
}

.picks-tuning .adventure {
  flex: 1;
  max-width: 280px;
  accent-color: var(--accent);
}

.picks-tuning .ghost {
  margin-left: auto;
}
```

- [ ] **Step 4: Verify in the browser**

Run `npx wrangler dev --port 8788`, then use the existing playwright-core script pattern to log in, open Next, screenshot at 1180px, and read the image. Expected: the slider and Shuffle render, kinds show comfort/one-step/something new, and clicking Shuffle changes several cards but keeps the 4/2/2 mix. Move the slider to 90, reroll, and confirm more variety without any pick showing three new axes.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/app.js public/styles.css
git commit -m "Add comfort slider and shuffle to the Next tab"
```

---

### Task 4: Migrate production, deploy, verify

**Files:**
- No source changes.
- Remote: `coffee-ledger` D1, Worker `coffee-ledger`.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: live site with populated bag features and the new engine.

- [ ] **Step 1: Apply the migrations to production**

```bash
npx wrangler d1 execute coffee-ledger --remote --file=migrations/0004_bag_features.sql
npx wrangler d1 execute coffee-ledger --remote --file=migrations/0005_backfill_bag_features.sql
npx wrangler d1 execute coffee-ledger --remote --json --command "SELECT roaster, name, roast, flavours, process FROM bags ORDER BY id"
```

Expected: 14 rows; every row has flavours; `Tripura Hills` and `DG Microlot #1` have their backfilled roasts.

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: `Deployed coffee-ledger triggers` and a new Version ID.

- [ ] **Step 3: Verify the live API and UI**

- Log in with the playwright-core script, open Next, screenshot, and read it.
- Confirm the kinds render as 4/2/2 at 8 picks and that Shuffle changes the slate.
- Confirm at least two roasts and four roasters in the visible slate.
- Use `curl` with the owner cookie to check `/api/bags` returns `flavours` and `process` arrays.

- [ ] **Step 4: Report the result**

Report the live Version ID, the slate mix, and any deviations from the spec. No commit for this task.
