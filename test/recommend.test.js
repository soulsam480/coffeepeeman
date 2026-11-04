import test from "node:test";
import assert from "node:assert/strict";
import { recommend, DEFAULT_ADVENTURE } from "../public/js/recommend.js";

const NOW = Date.parse("2026-11-04T00:00:00Z");
const ROASTS = ["light", "light-medium", "medium", "medium-dark", "dark"];
const FLAVOURS = [
  ["chocolate", "caramel"],
  ["chocolate", "nutty"],
  ["caramel", "vanilla"],
  ["fruity", "berry"],
  ["floral", "citrus"],
  ["spice", "earthy"],
  ["chocolate", "fruity"],
  ["nutty", "caramel"],
];
const PROCESSES = [
  ["washed"],
  ["natural"],
  ["honey"],
  ["anaerobic"],
  ["washed", "honey"],
  [],
];

function bags() {
  return [
    {
      id: 1,
      roaster: "Alpha",
      name: "House Blend",
      roast: "medium",
      price: 550,
      grams: 250,
      date: "2026-09-01",
      black: 5,
      milk: 4,
      note: "chocolate and caramel",
      flavours: ["chocolate", "caramel"],
      process: ["washed"],
    },
    {
      id: 2,
      roaster: "Beta",
      name: "Dark Roast",
      roast: "medium-dark",
      price: 600,
      grams: 250,
      date: "2026-10-01",
      black: 4,
      milk: 4,
      note: "chocolate, nutty",
      flavours: ["chocolate", "nutty"],
      process: ["natural"],
    },
    {
      id: 3,
      roaster: "Gamma",
      name: "Light Thing",
      roast: "light",
      price: 500,
      grams: 250,
      date: "2026-07-01",
      black: 2,
      milk: 2,
      note: "floral, citrus",
      flavours: ["floral", "citrus"],
      process: ["honey"],
    },
    {
      id: 4,
      roaster: "Delta",
      name: "Smoky Thing",
      roast: "dark",
      price: 700,
      grams: 250,
      date: "2026-01-01",
      black: 1,
      milk: 2,
      note: "smoke and earth",
      flavours: ["earthy"],
      process: ["anaerobic"],
    },
  ];
}

function catalog() {
  const rows = [];

  for (let index = 0; index < 80; index += 1) {
    const price = 350 + (index % 6) * 40;
    rows.push({
      id: `c${index}`,
      roaster: `Roaster ${index % 10}`,
      name: `Coffee ${index}`,
      roast: ROASTS[index % ROASTS.length],
      process: PROCESSES[index % PROCESSES.length],
      flavours: FLAVOURS[index % FLAVOURS.length],
      price,
      grams: 250,
      per100: Math.round((price / 250) * 100),
      url: `https://example.com/coffee-${index}`,
    });
  }

  rows.push({
    id: "gift",
    roaster: "Gift Co",
    name: "Gift Hamper",
    roast: "medium",
    process: ["washed"],
    flavours: ["chocolate"],
    price: 500,
    grams: 250,
    per100: 200,
    url: "https://example.com/gift",
  });
  rows.push({
    id: "owned",
    roaster: "Alpha",
    name: "House Blend",
    roast: "medium",
    process: ["washed"],
    flavours: ["chocolate"],
    price: 550,
    grams: 250,
    per100: 220,
    url: "https://example.com/owned",
  });
  rows.push({
    id: "drip",
    roaster: "Drip Co",
    name: "Drip Coffee Bags",
    roast: "medium",
    process: ["washed"],
    flavours: ["chocolate"],
    price: 500,
    grams: 250,
    per100: 200,
    url: "https://example.com/drip",
  });
  rows.push({
    id: "pricey",
    roaster: "Fancy Co",
    name: "Very Fancy Coffee",
    roast: "medium",
    process: ["washed"],
    flavours: ["chocolate"],
    price: 5000,
    grams: 250,
    per100: 2000,
    url: "https://example.com/pricey",
  });

  return rows;
}

function run(options = {}) {
  return recommend(bags(), catalog(), { now: NOW, ...options });
}

test("no ratings returns no picks", () => {
  assert.deepEqual(recommend([], catalog(), { now: NOW, seed: 1 }), []);
});

test("same seed is reproducible and another seed differs", () => {
  const a = run({ limit: 8, seed: 42 });
  const b = run({ limit: 8, seed: 42 });
  const c = run({ limit: 8, seed: 7 });

  assert.deepEqual(
    a.map((pick) => pick.coffee.id),
    b.map((pick) => pick.coffee.id),
  );
  assert.notDeepEqual(
    a.map((pick) => pick.coffee.id),
    c.map((pick) => pick.coffee.id),
  );
});

test("default adventure caps novelty at one axis and anchors every pick", () => {
  const picks = run({ limit: 8, seed: 42 });

  for (const pick of picks) {
    const axes = Object.values(pick.novelty).filter(Boolean).length;
    assert.ok(axes <= 1, `${pick.coffee.name} had ${axes} novel axes`);
    assert.ok(pick.anchored, `${pick.coffee.name} had no anchor`);
  }
});

test("high adventure allows two axes but never three", () => {
  const picks = run({ limit: 12, adventure: 85, seed: 42 });

  for (const pick of picks) {
    assert.ok(Object.values(pick.novelty).filter(Boolean).length <= 2);
  }
});

test("default slate is 4 comfort, 2 one-step, 2 further", () => {
  const picks = run({ limit: 8, adventure: DEFAULT_ADVENTURE, seed: 42 });
  const counts = picks.reduce((result, pick) => {
    result[pick.kind] = (result[pick.kind] || 0) + 1;
    return result;
  }, {});

  assert.deepEqual(counts, {
    "Comfort pick": 4,
    "One step out": 2,
    "Something new": 2,
  });
});

test("slate is diverse and excludes owned, non-coffee and overpriced rows", () => {
  const picks = run({ limit: 8, seed: 42 });

  assert.ok(new Set(picks.map((pick) => pick.coffee.roast)).size >= 2);
  assert.ok(new Set(picks.map((pick) => pick.coffee.roaster)).size >= 4);
  assert.ok(!picks.some((pick) => pick.coffee.id === "owned"));
  assert.ok(!picks.some((pick) => pick.coffee.id === "gift"));
  assert.ok(!picks.some((pick) => pick.coffee.id === "drip"));
  assert.ok(!picks.some((pick) => pick.coffee.id === "pricey"));

  for (const pick of picks) {
    assert.ok(pick.coffee.url.startsWith("https://"));
    assert.ok(!/pods|chicory|gift|drip|trial/i.test(pick.coffee.name));
  }
});

test("missing catalog features and missing bag scores do not throw", () => {
  const sparse = catalog().map((coffee, index) =>
    index % 5 === 0
      ? { ...coffee, flavours: [], process: [], roast: null }
      : coffee,
  );
  const oneSided = bags().map((bag, index) =>
    index % 2 ? { ...bag, black: null, milk: 4 } : bag,
  );

  assert.doesNotThrow(() =>
    recommend(oneSided, sparse, { now: NOW, seed: 3 }),
  );
});

test("a tiny pool returns fewer picks without looping", () => {
  const picks = recommend(bags(), catalog().slice(0, 2), {
    now: NOW,
    limit: 8,
    seed: 1,
  });

  assert.ok(picks.length <= 2);
});

test("missing per100 is skipped and all-neutral ratings still return a slate", () => {
  const noPrice = catalog().map((coffee, index) =>
    index % 7 === 0
      ? { ...coffee, per100: null, price: null }
      : coffee,
  );
  const neutral = bags().map((bag) => ({ ...bag, black: 3, milk: 3 }));

  const picks = recommend(bags(), noPrice, { now: NOW, limit: 8, seed: 5 });
  assert.ok(picks.length > 0);
  assert.doesNotThrow(() =>
    recommend(neutral, noPrice, { now: NOW, seed: 5 }),
  );
});

test("liked flavours outrank a disliked-only candidate", () => {
  const picks = run({ limit: 20, seed: 42 });
  const liked = picks.find((pick) =>
    pick.coffee.flavours.includes("chocolate"),
  );
  const disliked = picks.find(
    (pick) =>
      pick.coffee.flavours.length &&
      pick.coffee.flavours.every(
        (flavour) => flavour === "floral" || flavour === "citrus",
      ),
  );

  if (liked && disliked) assert.ok(liked.score > disliked.score);
});
