const STORE_KEY = "coffee.registry.v1";
const ROAST = {
  light: 0,
  "light-medium": 1,
  medium: 2,
  "medium-dark": 3,
  dark: 4,
};
const SKIP =
  /chicory|pods|sachet|drip bag|green bean|gift|hamper|bundle|sampler|cascara|merch|mug|tumbler|voucher|custom/i;

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

function deriveFlavours(text) {
  if (!text) return [];
  return [
    ...new Set(
      FLAVOUR_WORDS.filter(([re]) => re.test(text)).map(([, tag]) => tag),
    ),
  ];
}

function cleanName(name) {
  return name
    .replace(/\s*[|·-]\s*(pack of\s*\d+|trial pack|sample pack).*$/i, "")
    .replace(/\s*[|·-]\s*\d+\s*(g|gm|grams|kg)\b.*$/i, "")
    .replace(/\s*[\[(]\s*\d+\s*(g|gm|grams|kg)\s*[\])]\s*$/i, "")
    .trim();
}

let catalog = [];
let bags = [];

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(bags));
}

function per100(bag) {
  return bag.price && bag.grams
    ? Math.round((bag.price / bag.grams) * 100)
    : null;
}

async function init() {
  catalog = await fetch("data/catalog.json").then((r) => r.json());
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) {
    bags = JSON.parse(saved);
  } else {
    bags = await fetch("data/seed.json").then((r) => r.json());
    save();
  }
  wireTabs();
  wireForm();
  $("exportBtn").addEventListener("click", exportJson);
  render();
}

function wireTabs() {
  const tabs = document.querySelectorAll(".tabs button");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      ["ledger", "add", "next"].forEach((v) => {
        $("view-" + v).hidden = v !== btn.dataset.view;
      });
      if (btn.dataset.view === "next") renderPicks();
      window.scrollTo(0, 0);
    });
  });
}

/* ---------- ledger ---------- */

function render() {
  const roasters = new Set(bags.map((b) => b.roaster.toLowerCase()));
  $("count").textContent = bags.length
    ? `${bags.length} bags · ${roasters.size} roasters`
    : "No bags yet";

  const list = $("bagList");
  list.innerHTML = "";
  $("ledgerEmpty").hidden = bags.length > 0;

  [...bags]
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.date || "").localeCompare(x.b.date || ""))
    .forEach(({ b, i }) => {
      const li = document.createElement("li");
      li.className = "bag";
      const p = per100(b);
      li.innerHTML = `
        <div class="bag-head">
          <div>
            <h3>${esc(cleanName(b.name))}</h3>
            <p class="roaster">${esc(b.roaster)}</p>
          </div>
          <span class="price">${p ? "₹" + p + "/100g" : ""}</span>
        </div>
        <div class="meta">
          ${b.roast ? `<span class="chip">${esc(b.roast)}</span>` : ""}
          ${b.black ? `<span class="chip rated">B ${b.black}</span>` : ""}
          ${b.milk ? `<span class="chip rated">M ${b.milk}</span>` : ""}
          <span class="chip">${esc(b.date || "")}</span>
        </div>
        ${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}
        <details class="rate">
          <summary>${b.black || b.milk ? "Edit score" : "Rate"}</summary>
          <div class="score-row">
            <span>Black</span><div class="score" data-add="${i}" data-axis="black"></div>
          </div>
          <div class="score-row">
            <span>Milk</span><div class="score" data-add="${i}" data-axis="milk"></div>
          </div>
        </details>`;
      list.appendChild(li);
      li.querySelectorAll(".score[data-add]").forEach((host) =>
        scoreButtons(host, bags[host.dataset.add][host.dataset.axis]),
      );
    });
}

function scoreButtons(host, current) {
  host.innerHTML = "";
  for (let n = 1; n <= 5; n++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = n;
    btn.setAttribute("aria-pressed", String(current === n));
    btn.addEventListener("click", () => {
      const bag = bags[host.dataset.add];
      const axis = host.dataset.axis;
      bag[axis] = bag[axis] === n ? null : n;
      save();
      render();
      if (!$("view-next").hidden) renderPicks();
    });
    host.appendChild(btn);
  }
}

/* ---------- add ---------- */

function wireForm() {
  const coffee = $("coffee");
  const suggest = $("suggest");
  let picked = null;

  coffee.addEventListener("input", () => {
    picked = null;
    const q = coffee.value.trim().toLowerCase();
    if (q.length < 2) {
      suggest.hidden = true;
      return;
    }
    const hits = catalog
      .filter((c) => !SKIP.test(c.name) && c.name.toLowerCase().includes(q))
      .slice(0, 7);
    suggest.innerHTML = "";
    hits.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `${esc(c.name)}<small>${esc(c.roaster)}${c.per100 ? " · ₹" + Math.round(c.per100) + "/100g" : ""}</small>`;
      btn.addEventListener("click", () => {
        picked = c;
        coffee.value = c.name;
        $("roaster").value = c.roaster;
        $("roast").value = c.roast || "";
        $("price").value = c.price || "";
        $("grams").value = c.grams || 250;
        suggest.hidden = true;
      });
      suggest.appendChild(btn);
    });
    suggest.hidden = hits.length === 0;
  });

  document.addEventListener("click", (e) => {
    if (!suggest.contains(e.target) && e.target !== coffee)
      suggest.hidden = true;
  });

  ["blackScore", "milkScore"].forEach((id) => {
    const axis = id === "blackScore" ? "black" : "milk";
    const host = $(id);
    host.dataset.axis = axis;
    scoreButtons(host, null);
  });

  $("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const price = Number($("price").value) || null;
    const grams = Number($("grams").value) || null;
    const note = $("note").value.trim();
    bags.push({
      roaster: $("roaster").value.trim(),
      name: $("coffee").value.trim(),
      roast: $("roast").value || null,
      price,
      grams,
      flavours: picked ? picked.flavours : deriveFlavours(note),
      process: picked ? picked.process : [],
      date: $("date").value || new Date().toISOString().slice(0, 10),
      black: currentScore("blackScore"),
      milk: currentScore("milkScore"),
      note,
    });
    picked = null;
    save();
    e.target.reset();
    $("grams").value = 250;
    ["blackScore", "milkScore"].forEach((id) => scoreButtons($(id), null));
    document.querySelector('.tabs button[data-view="ledger"]').click();
    render();
  });
}

function currentScore(id) {
  const btn = $(id).querySelector('[aria-pressed="true"]');
  return btn ? Number(btn.textContent) : null;
}

/* ---------- recommendations ---------- */

function key(roaster, name) {
  return (roaster + " " + name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function similarity(a, b) {
  let score = 0;
  let weights = 0;

  if (a.roast && b.roast) {
    const d = Math.abs(ROAST[a.roast] - ROAST[b.roast]);
    score += (1 - Math.min(d / 2, 1)) * 0.3;
    weights += 0.3;
  }
  const af = new Set(a.flavours || []);
  const bf = new Set(b.flavours || []);
  if (af.size && bf.size) {
    let hit = 0;
    af.forEach((f) => bf.has(f) && hit++);
    score += (hit / Math.max(af.size, bf.size)) * 0.4;
    weights += 0.4;
  }
  const ap = new Set(a.process || []);
  const bp = new Set(b.process || []);
  if (ap.size && bp.size) {
    let hit = 0;
    ap.forEach((p) => bp.has(p) && hit++);
    score += (hit / Math.max(ap.size, bp.size)) * 0.15;
    weights += 0.15;
  }
  if (a.per100 && b.per100) {
    const d = Math.abs(Math.log(a.per100 / b.per100));
    score += Math.max(0, 1 - d / 0.5) * 0.15;
    weights += 0.15;
  }
  return weights ? score / weights : 0.5;
}

function recommendations() {
  const rated = bags
    .map((b) => {
      const axes = [];
      if (b.black) axes.push(b.black - 3);
      if (b.milk) axes.push(b.milk - 3);
      return {
        bag: b,
        weight: axes.length ? axes.reduce((x, y) => x + y, 0) / axes.length : 0,
      };
    })
    .filter((r) => r.weight !== 0);

  if (!rated.length) return [];

  const owned = new Set(bags.map((b) => key(b.roaster, b.name)));
  const lastTwo = new Set(
    [...bags]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 2)
      .map((b) => b.roaster.toLowerCase()),
  );
  const median = bags
    .map(per100)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const cap = median.length ? median[Math.floor(median.length / 2)] * 1.2 : 600;

  const scored = catalog
    .filter(
      (c) =>
        !SKIP.test(c.name) &&
        c.url &&
        c.per100 &&
        c.per100 >= 100 &&
        c.per100 <= cap,
    )
    .filter((c) => c.roast)
    .filter((c) => !owned.has(key(c.roaster, c.name)))
    .map((c) => {
      let total = 0;
      let denom = 0;
      let closest = null;
      let best = -Infinity;
      rated.forEach(({ bag, weight }) => {
        const s = similarity(c, {
          roast: bag.roast,
          flavours: bag.flavours || deriveFlavours(bag.note),
          process: bag.process || [],
          per100: per100(bag),
        });
        total += weight * s;
        denom += Math.abs(weight);
        if (weight > 0 && s > best) {
          best = s;
          closest = bag;
        }
      });
      const coverage =
        [c.roast, c.flavours.length, c.process.length, c.per100].filter(Boolean)
          .length / 4;
      let score = denom ? (total / denom) * (0.6 + 0.4 * coverage) : 0;
      if (c.roast === "medium" || c.roast === "medium-dark") score += 0.03;
      return { coffee: c, score, closest };
    })
    .sort((a, b) => b.score - a.score);

  const safe =
    scored.find((s) => !lastTwo.has(s.coffee.roaster.toLowerCase())) ||
    scored[0];
  const tried = new Set(bags.map((b) => b.roast));
  const stretch =
    scored
      .slice(4, 30)
      .find((s) => s.coffee.roaster !== safe.coffee.roaster && s.score > 0.3) ||
    scored.find((s) => s.coffee.roaster !== safe.coffee.roaster);

  return [safe, stretch]
    .filter(Boolean)
    .map((s, i) => ({ ...s, kind: i === 0 ? "Safe pick" : "One stretch" }));
}

function renderPicks() {
  const picks = recommendations();
  $("nextEmpty").hidden = picks.length > 0;
  $("picks").innerHTML = picks
    .map(({ coffee: c, kind, closest }) => {
      const reason = closest
        ? `Closest to ${esc(closest.name)} (${esc(closest.roaster)}) — ${c.roast ? esc(c.roast) : "similar"}${c.flavours.length ? ", " + c.flavours.slice(0, 3).map(esc).join(", ") : ""}.`
        : "";
      return `<article class="pick">
        <div class="kind">${kind}</div>
        <h3>${esc(cleanName(c.name))}</h3>
        <p class="roaster">${esc(c.roaster)}</p>
        <div class="numbers">
          <div><strong>₹${Math.round(c.per100)}</strong>per 100g</div>
          <div><strong>${c.roast ? esc(c.roast) : "—"}</strong>roast</div>
          <div><strong>₹${c.price}</strong>per ${c.grams}g</div>
        </div>
        ${reason ? `<p class="why">${reason}</p>` : ""}
        ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open bag →</a>` : ""}
      </article>`;
    })
    .join("");
  $("nextFine").textContent = picks.length
    ? "Prices from the last catalog sync. Check the roaster’s page before buying."
    : "";
}

function exportJson() {
  const blob = new Blob([JSON.stringify(bags, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "coffee-bags.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
