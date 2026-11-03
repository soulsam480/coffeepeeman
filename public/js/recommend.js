import { deriveFlavours, per100 } from "./format.js";

const ROAST_ORDER = {
  light: 0,
  "light-medium": 1,
  medium: 2,
  "medium-dark": 3,
  dark: 4,
};

const WEIGHTS = { roast: 0.3, flavour: 0.4, process: 0.15, price: 0.15 };
const PRICE_TOLERANCE = 0.5;
const PRICE_CAP_MULTIPLIER = 1.2;
const DEFAULT_PRICE_CAP = 600;
const MIN_PRICE_PER_100G = 100;
const STRETCH_START_RANK = 4;
const STRETCH_END_RANK = 30;
const STRETCH_MIN_SCORE = 0.3;
const NEUTRAL_SCORE = 0.5;
const MEDIUM_ROASTS = new Set(["medium", "medium-dark"]);
const NON_COFFEE =
  /chicory|pods|sachet|drip bag|green bean|gift|hamper|bundle|sampler|cascara|merch|mug|tumbler|voucher|custom/i;

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roastSimilarity(a, b) {
  if (!a.roast || !b.roast) return null;
  const distance = Math.abs(ROAST_ORDER[a.roast] - ROAST_ORDER[b.roast]);
  return 1 - Math.min(distance / 2, 1);
}

function overlapSimilarity(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return null;

  let shared = 0;
  left.forEach((item) => {
    if (right.has(item)) shared += 1;
  });
  return shared / Math.max(left.size, right.size);
}

function priceSimilarity(a, b) {
  if (!a || !b) return null;
  const distance = Math.abs(Math.log(a / b));
  return Math.max(0, 1 - distance / PRICE_TOLERANCE);
}

function similarity(coffee, bag) {
  const parts = [
    [roastSimilarity(coffee, bag), WEIGHTS.roast],
    [overlapSimilarity(coffee.flavours, bag.flavours), WEIGHTS.flavour],
    [overlapSimilarity(coffee.process, bag.process), WEIGHTS.process],
    [priceSimilarity(coffee.per100, per100(bag)), WEIGHTS.price],
  ].filter(([value]) => value !== null);

  if (!parts.length) return NEUTRAL_SCORE;

  const total = parts.reduce((sum, [value, weight]) => sum + value * weight, 0);
  const weights = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return total / weights;
}

function ratingWeight(bag) {
  const scores = [];
  if (bag.black) scores.push(bag.black - 3);
  if (bag.milk) scores.push(bag.milk - 3);
  return scores.length ? average(scores) : 0;
}

function bagFeatures(bag) {
  return {
    roast: bag.roast,
    flavours: bag.flavours?.length ? bag.flavours : deriveFlavours(bag.note),
    process: bag.process || [],
    per100: per100(bag),
  };
}

function nameKey(roaster, name) {
  return `${roaster} ${name}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function priceCapFor(bags) {
  const prices = bags
    .map(per100)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!prices.length) return DEFAULT_PRICE_CAP;
  return prices[Math.floor(prices.length / 2)] * PRICE_CAP_MULTIPLIER;
}

function isCandidate(coffee, priceCap, owned) {
  return (
    !NON_COFFEE.test(coffee.name) &&
    Boolean(coffee.url) &&
    Boolean(coffee.roast) &&
    coffee.per100 >= MIN_PRICE_PER_100G &&
    coffee.per100 <= priceCap &&
    !owned.has(nameKey(coffee.roaster, coffee.name))
  );
}

function coverage(coffee) {
  const fields = [
    coffee.roast,
    coffee.flavours.length,
    coffee.process.length,
    coffee.per100,
  ];
  return fields.filter(Boolean).length / fields.length;
}

function scoreCandidate(coffee, preferences) {
  let total = 0;
  let totalWeight = 0;
  let closest = null;
  let bestSimilarity = -Infinity;

  for (const { bag, weight } of preferences) {
    const value = similarity(coffee, bagFeatures(bag));
    total += weight * value;
    totalWeight += Math.abs(weight);

    if (weight > 0 && value > bestSimilarity) {
      bestSimilarity = value;
      closest = bag;
    }
  }

  let score = totalWeight
    ? (total / totalWeight) * (0.6 + 0.4 * coverage(coffee))
    : 0;
  if (MEDIUM_ROASTS.has(coffee.roast)) score += 0.03;

  return { coffee, score, closest };
}

function findStretch(scored, safe) {
  if (!safe) return null;

  const section = scored.slice(STRETCH_START_RANK, STRETCH_END_RANK);
  const differentRoaster = (pick) =>
    pick.coffee.roaster !== safe.coffee.roaster;

  return (
    section.find(
      (pick) => differentRoaster(pick) && pick.score > STRETCH_MIN_SCORE,
    ) ||
    scored.find(differentRoaster) ||
    null
  );
}

export function recommend(bags, catalog) {
  const preferences = bags
    .map((bag) => ({ bag, weight: ratingWeight(bag) }))
    .filter((preference) => preference.weight !== 0);

  if (!preferences.length) return [];

  const owned = new Set(bags.map((bag) => nameKey(bag.roaster, bag.name)));
  const recentRoasters = new Set(
    bags.slice(0, 2).map((bag) => bag.roaster.toLowerCase()),
  );
  const priceCap = priceCapFor(bags);

  const scored = catalog
    .filter((coffee) => isCandidate(coffee, priceCap, owned))
    .map((coffee) => scoreCandidate(coffee, preferences))
    .sort((a, b) => b.score - a.score);

  const safe =
    scored.find(
      (pick) => !recentRoasters.has(pick.coffee.roaster.toLowerCase()),
    ) || scored[0];
  const stretch = findStretch(scored, safe);

  return [safe, stretch].filter(Boolean).map((pick, index) => ({
    ...pick,
    kind: index === 0 ? "Safe pick" : "One stretch",
  }));
}
