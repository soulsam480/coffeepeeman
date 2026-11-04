import { deriveFlavours, per100 } from "./format.js";

const ROAST_ORDER = {
  light: 0,
  "light-medium": 1,
  medium: 2,
  "medium-dark": 3,
  dark: 4,
};

const WEIGHTS = { roast: 0.3, flavour: 0.4, process: 0.15, price: 0.15 };

const DEFAULT_LIMIT = 8;
export const DEFAULT_ADVENTURE = 40;

const HIGH_ADVENTURE = 70;
const HALF_LIFE_DAYS = 180;
const MIN_DECAY = 0.15;
const PRICE_FLOOR = 100;
const PRICE_SIGMA = 0.35;
const PRICE_CEILING = 2.5;
const DEFAULT_PRICE = 300;
const MMR_LAMBDA = 0.7;
const NEUTRAL = 0.5;
const ADJACENT_SCORE = 0.45;
const MAX_LIMIT = 50;

const NON_COFFEE =
  /chicory|pods|sachet|drip|brew bag|coffee bag|green bean|green coffee|trial|sample pack|gift|hamper|bundle|sampler|cascara|merch|mug|tumbler|voucher|custom/i;

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function weightedAverage(parts) {
  const usable = parts.filter(([value]) => value !== null && value !== undefined);
  if (!usable.length) return null;

  const total = usable.reduce((sum, [value, weight]) => sum + value * weight, 0);
  const weights = usable.reduce((sum, [, weight]) => sum + weight, 0);
  return weights ? total / weights : null;
}

function roastIndex(roast) {
  return roast in ROAST_ORDER ? ROAST_ORDER[roast] : null;
}

function overlap(a, b) {
  const left = new Set(a || []);
  const right = new Set(b || []);
  if (!left.size || !right.size) return null;

  let shared = 0;
  left.forEach((item) => {
    if (right.has(item)) shared += 1;
  });
  return shared / Math.max(left.size, right.size);
}

function tags(value) {
  if (Array.isArray(value)) return unique(value.map(String));
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? unique(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

function coffeePer100(coffee) {
  const value = Number(coffee.per100);
  if (Number.isFinite(value)) return value;
  return per100(coffee);
}

function normalizeCoffee(coffee) {
  return {
    ...coffee,
    flavours: tags(coffee.flavours),
    process: tags(coffee.process),
    per100: coffeePer100(coffee),
  };
}

function bagFeatures(bag) {
  return {
    roast: bag.roast || null,
    flavours: unique([
      ...tags(bag.flavours),
      ...deriveFlavours(bag.note || ""),
    ]),
    process: tags(bag.process),
    per100: per100(bag),
  };
}

function likingOf(bag) {
  const scores = [];
  if (Number.isFinite(bag.black)) scores.push(bag.black);
  if (Number.isFinite(bag.milk)) scores.push(bag.milk);
  return average(scores);
}

function ageInDays(now, date) {
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (now - time) / 86_400_000);
}

function decayFor(bag, now) {
  const days = ageInDays(now, bag.date);
  return Math.max(MIN_DECAY, 2 ** (-days / HALF_LIFE_DAYS));
}

function weightedMedian(samples) {
  const usable = samples.filter(
    (sample) => Number.isFinite(sample.value) && sample.value > 0,
  );
  if (!usable.length) return null;

  const positive = usable.filter((sample) => sample.weight > 0);
  const pool = positive.length ? positive : usable;
  const sorted = [...pool].sort((a, b) => a.value - b.value);
  const total =
    sorted.reduce((sum, sample) => sum + Math.abs(sample.weight), 0) ||
    sorted.length;

  let running = 0;
  for (const sample of sorted) {
    running += Math.abs(sample.weight) || 1;
    if (running >= total / 2) return sample.value;
  }

  return sorted[sorted.length - 1].value;
}

function buildIdf(catalog) {
  const documentFrequency = new Map();
  let documents = 0;

  for (const coffee of catalog) {
    if (!coffee.flavours.length) continue;
    documents += 1;
    for (const tag of coffee.flavours) {
      documentFrequency.set(tag, (documentFrequency.get(tag) || 0) + 1);
    }
  }

  const fallback = Math.log((documents + 1) / 1) + 1 || 1;
  const values = new Map();
  for (const [tag, count] of documentFrequency) {
    values.set(tag, Math.log((documents + 1) / (count + 1)) + 1);
  }

  return { values, fallback };
}

function idfFor(idf, tag) {
  return idf.values.get(tag) ?? idf.fallback;
}

function buildProfile(bags, catalog, now) {
  const idf = buildIdf(catalog);
  const flavourWeights = new Map();
  const processWeights = new Map();
  const positiveRoasts = new Set();
  const priceSamples = [];

  let roastTotal = 0;
  let roastWeightTotal = 0;
  let rated = 0;
  let positive = false;
  const allRoasts = [];

  for (const bag of bags) {
    const liking = likingOf(bag);
    if (liking === null) continue;
    rated += 1;

    const weight = clamp((liking - 3) / 2, -1, 1) * decayFor(bag, now);
    if (!weight) continue;
    if (weight > 0) positive = true;

    const features = bagFeatures(bag);

    if (features.roast) {
      const index = roastIndex(features.roast);
      if (index !== null) {
        allRoasts.push(index);
        if (weight > 0) {
          roastTotal += index * weight;
          roastWeightTotal += weight;
          positiveRoasts.add(index);
        }
      }
    }

    for (const tag of features.flavours) {
      flavourWeights.set(tag, (flavourWeights.get(tag) || 0) + weight);
    }
    for (const tag of features.process) {
      processWeights.set(tag, (processWeights.get(tag) || 0) + weight);
    }
    if (features.per100) {
      priceSamples.push({ value: features.per100, weight });
    }
  }

  const roastCenter =
    roastWeightTotal !== 0
      ? clamp(roastTotal / roastWeightTotal, 0, 4)
      : allRoasts.length
        ? average(allRoasts)
        : null;

  const topFlavours = [...flavourWeights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    idf,
    roastCenter,
    positiveRoasts,
    flavourWeights,
    processWeights,
    topFlavours,
    hasFlavour: topFlavours.length > 0,
    hasProcess: [...processWeights.values()].some((weight) => weight > 0),
    pricePer100: weightedMedian(priceSamples),
    hasPositive: positive,
    rated,
  };
}

function roastSimilarity(roast, profile) {
  const index = roastIndex(roast);
  if (index === null || profile.roastCenter === null) return NEUTRAL;

  return clamp(1 - Math.abs(index - profile.roastCenter) / 2, 0, 1);
}

function flavourSimilarity(flavours, profile) {
  if (!profile.hasFlavour || !flavours.length) return NEUTRAL;

  const idf = profile.idf;
  let dot = 0;
  let candidateNorm = 0;
  let profileNorm = 0;

  for (const tag of flavours) {
    const weight = idfFor(idf, tag);
    candidateNorm += weight * weight;
    dot += (profile.flavourWeights.get(tag) || 0) * weight * weight;
  }

  for (const [tag, weight] of profile.flavourWeights) {
    if (weight <= 0) continue;
    const value = weight * idfFor(idf, tag);
    profileNorm += value * value;
  }

  if (!candidateNorm || !profileNorm) return NEUTRAL;
  return clamp(dot / (Math.sqrt(candidateNorm) * Math.sqrt(profileNorm)), 0, 1);
}

function processSimilarity(process, profile) {
  if (!profile.hasProcess || !process.length) return NEUTRAL;

  let total = 0;
  let matched = 0;
  for (const [tag, weight] of profile.processWeights) {
    if (weight > 0) {
      total += weight;
      if (process.includes(tag)) matched += weight;
    }
  }

  return total ? clamp(matched / total, 0, 1) : NEUTRAL;
}

function priceSimilarity(candidate, preferred) {
  if (!candidate || !preferred) return NEUTRAL;
  const distance = Math.abs(Math.log(candidate / preferred));
  return clamp(Math.exp(-0.5 * (distance / PRICE_SIGMA) ** 2), 0, 1);
}

function affinityOf(coffee, profile) {
  const parts = [
    [roastSimilarity(coffee.roast, profile), WEIGHTS.roast],
    [flavourSimilarity(coffee.flavours, profile), WEIGHTS.flavour],
    [processSimilarity(coffee.process, profile), WEIGHTS.process],
    [priceSimilarity(coffee.per100, profile.pricePer100), WEIGHTS.price],
  ];

  const base = weightedAverage(parts) ?? NEUTRAL;
  const coverage =
    [coffee.roast, coffee.flavours.length, coffee.process.length, coffee.per100]
      .filter(Boolean).length / 4;

  return clamp(base * (0.85 + 0.15 * coverage), 0, 1);
}

function matchedFlavoursOf(coffee, profile) {
  return coffee.flavours
    .filter((tag) => (profile.flavourWeights.get(tag) || 0) > 0)
    .sort(
      (a, b) =>
        (profile.flavourWeights.get(b) || 0) -
        (profile.flavourWeights.get(a) || 0),
    )
    .slice(0, 2);
}

function matchedProcessOf(coffee, profile) {
  return coffee.process.filter(
    (tag) => (profile.processWeights.get(tag) || 0) > 0,
  );
}

function noveltyOf(coffee, profile, adventure) {
  const matchedFlavours = matchedFlavoursOf(coffee, profile);
  const matchedProcess = matchedProcessOf(coffee, profile);
  let roastDistance = null;

  if (coffee.roast && profile.positiveRoasts.size) {
    const index = roastIndex(coffee.roast);
    if (index !== null) {
      roastDistance = Math.min(
        ...[...profile.positiveRoasts].map((liked) => Math.abs(index - liked)),
      );
    }
  }

  const novelty = {
    roast:
      roastDistance !== null &&
      !profile.positiveRoasts.has(roastIndex(coffee.roast)),
    process:
      profile.hasProcess &&
      coffee.process.length > 0 &&
      matchedProcess.length === 0,
    flavour:
      profile.hasFlavour &&
      coffee.flavours.length > 0 &&
      matchedFlavours.length === 0,
  };

  const axes = Object.values(novelty).filter(Boolean).length;
  const anchored =
    !profile.hasPositive ||
    (roastDistance !== null && roastDistance <= 1) ||
    matchedFlavours.length > 0 ||
    matchedProcess.length > 0;

  const roastCap = adventure >= HIGH_ADVENTURE ? 3 : 2;
  const maxAxes = adventure >= HIGH_ADVENTURE ? 2 : 1;
  const allowed =
    !profile.hasPositive ||
    (anchored &&
      axes <= maxAxes &&
      (roastDistance === null || roastDistance <= roastCap));

  return {
    novelty,
    axes,
    roastDistance,
    matchedFlavours,
    matchedProcess,
    anchored,
    allowed,
  };
}

function featureSimilarity(coffee, features) {
  return (
    weightedAverage([
      [roastSimilarity(coffee.roast, { roastCenter: roastIndex(features.roast) }), WEIGHTS.roast],
      [overlap(coffee.flavours, features.flavours), WEIGHTS.flavour],
      [overlap(coffee.process, features.process), WEIGHTS.process],
      [priceSimilarity(coffee.per100, features.per100), WEIGHTS.price],
    ]) ?? 0
  );
}

function closestBagOf(coffee, likedBags) {
  let closest = null;
  let best = -Infinity;

  for (const { bag, features } of likedBags) {
    const score = featureSimilarity(coffee, features);
    if (score > best) {
      best = score;
      closest = bag;
    }
  }

  return closest;
}

function pairSimilarity(left, right) {
  return (
    weightedAverage([
      left.coffee.roast && right.coffee.roast
        ? [
            1 -
              Math.min(
                Math.abs(
                  roastIndex(left.coffee.roast) -
                    roastIndex(right.coffee.roast),
                ) / 2,
                1,
              ),
            0.35,
          ]
        : [null, 0],
      [overlap(left.coffee.flavours, right.coffee.flavours), 0.35],
      [overlap(left.coffee.process, right.coffee.process), 0.15],
      [
        left.coffee.roaster.toLowerCase() ===
        right.coffee.roaster.toLowerCase()
          ? 1
          : 0,
        0.15,
      ],
    ]) ?? 0
  );
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function weightedPick(items, weights, random) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return items[Math.floor(random() * items.length)];

  let remaining = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    remaining -= weights[index];
    if (remaining <= 0) return items[index];
  }

  return items[items.length - 1];
}

function maxSimilarity(candidate, selected) {
  if (!selected.length) return 0;
  return Math.max(...selected.map((pick) => pairSimilarity(candidate, pick)));
}

function sampleBand(pool, count, selected, kind, context) {
  const picks = [];
  const available = [...pool];

  while (picks.length < count && available.length) {
    const current = [...selected, ...picks];
    const usedRoasters = new Set(
      current.map((pick) => pick.coffee.roaster.toLowerCase()),
    );
    const fresh = available.filter(
      (candidate) =>
        !usedRoasters.has(candidate.coffee.roaster.toLowerCase()),
    );
    const eligible = fresh.length ? fresh : available;

    const utilities = eligible.map(
      (candidate) =>
        MMR_LAMBDA * candidate.score -
        (1 - MMR_LAMBDA) * maxSimilarity(candidate, current),
    );
    const best = Math.max(...utilities);
    const weights = utilities.map((utility) =>
      Math.exp((utility - best) / context.temperature),
    );

    const chosen = weightedPick(eligible, weights, context.random);
    const pick = { ...chosen, kind: kind || chosen.kind };
    picks.push(pick);
    available.splice(available.indexOf(chosen), 1);
  }

  return picks;
}

function classifierFor(candidate) {
  if (candidate.axes === 0) return "Comfort pick";
  if (candidate.axes === 1 && candidate.score >= ADJACENT_SCORE) {
    return "One step out";
  }
  return "Something new";
}

function quotaFor(limit, adventure) {
  const comfort = Math.round(limit * (0.65 - 0.35 * (adventure / 100)));
  const adjacent = Math.round(limit * (0.25 + 0.1 * (adventure / 100)));
  return {
    "Comfort pick": comfort,
    "One step out": adjacent,
    "Something new": Math.max(0, limit - comfort - adjacent),
  };
}

export function recommend(bags, catalog, options = {}) {
  if (typeof options === "number") options = { limit: options };

  if (!bags.length || !catalog.length) return [];

  if (!bags.some((bag) => likingOf(bag) !== null)) return [];

  const limit = clamp(
    Math.floor(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  const adventure = clamp(
    Number(options.adventure ?? DEFAULT_ADVENTURE),
    0,
    100,
  );
  const now =
    options.now instanceof Date
      ? options.now.getTime()
      : Number(options.now ?? Date.now());
  const seed =
    options.seed === undefined
      ? Math.floor(Math.random() * 4_294_967_296)
      : Number(options.seed) >>> 0;
  const random = mulberry32(seed);

  const normalizedCatalog = catalog.map(normalizeCoffee);
  const profile = buildProfile(bags, normalizedCatalog, now);

  const owned = new Set(
    bags.map((bag) =>
      `${bag.roaster} ${bag.name}`.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ),
  );
  const triedRoasters = new Set(
    bags.map((bag) => bag.roaster.toLowerCase()),
  );
  const likedBags = bags
    .map((bag) => ({
      bag,
      features: bagFeatures(bag),
      liking: likingOf(bag),
    }))
    .filter(({ liking }) => liking !== null)
    .sort((a, b) => (b.liking ?? 0) - (a.liking ?? 0));

  const preferred = profile.pricePer100 || DEFAULT_PRICE;
  const ceiling = preferred * PRICE_CEILING;

  const scored = [];

  for (const coffee of normalizedCatalog) {
    if (NON_COFFEE.test(coffee.name)) continue;
    if (!coffee.url || !coffee.roast) continue;
    if (!Number.isFinite(coffee.per100)) continue;
    if (coffee.per100 < PRICE_FLOOR || coffee.per100 > ceiling) continue;

    const key = `${coffee.roaster} ${coffee.name}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (owned.has(key)) continue;

    const details = noveltyOf(coffee, profile, adventure);
    if (!details.allowed) continue;

    const score = affinityOf(coffee, profile);
    const candidate = {
      coffee,
      score,
      ...details,
      closest: closestBagOf(coffee, likedBags),
      isNewRoaster: !triedRoasters.has(coffee.roaster.toLowerCase()),
    };

    candidate.kind = classifierFor(candidate);
    scored.push(candidate);
  }

  scored.sort((a, b) => b.score - a.score);

  const pools = {
    "Comfort pick": [],
    "One step out": [],
    "Something new": [],
  };
  for (const candidate of scored) pools[candidate.kind].push(candidate);

  const quotas = quotaFor(limit, adventure);
  const context = {
    random,
    temperature: 0.02 + 0.1 * (adventure / 100),
  };
  const selected = [];

  for (const kind of ["Comfort pick", "One step out", "Something new"]) {
    selected.push(
      ...sampleBand(pools[kind], quotas[kind], selected, kind, context),
    );
  }

  if (selected.length < limit) {
    const used = new Set(selected.map((pick) => pick.coffee.id));
    const rest = scored.filter((candidate) => !used.has(candidate.coffee.id));
    selected.push(
      ...sampleBand(rest, limit - selected.length, selected, null, context),
    );
  }

  return selected;
}
