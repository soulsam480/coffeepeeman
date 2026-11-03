const FLAVOUR_WORDS = [
  [/toffee|caramel|butterscotch|jaggery|brown sugar/i, "caramel"],
  [/hazelnut|almond|nut|praline|cashew/i, "nutty"],
  [/chocolate|cocoa|cacao|mocha/i, "chocolate"],
  [/raisin|fig|date|plum|berry|cherry|fruit/i, "fruity"],
  [/orange|lemon|citrus|mosambi|gooseberry/i, "citrus"],
  [/vanilla|cream/i, "vanilla"],
  [/spice|cinnamon|clove|pepper/i, "spice"],
  [/floral|jasmine|rose/i, "floral"],
];

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

export function cleanName(name) {
  return name
    .replace(/\s*[|·-]\s*(pack of\s*\d+|trial pack|sample pack).*$/i, "")
    .replace(/\s*[|·-]\s*\d+\s*(g|gm|grams|kg)\b.*$/i, "")
    .replace(/\s*[\[(]\s*\d+\s*(g|gm|grams|kg)\s*[\])]\s*$/i, "")
    .trim();
}

export function per100(bag) {
  return bag.price && bag.grams
    ? Math.round((bag.price / bag.grams) * 100)
    : null;
}

export function deriveFlavours(text) {
  if (!text) return [];
  const matches = FLAVOUR_WORDS.filter(([pattern]) => pattern.test(text));
  return [...new Set(matches.map(([, tag]) => tag))];
}
