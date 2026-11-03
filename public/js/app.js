import { addBag, getBags, getCatalog, getMe, updateBag } from "./api.js";
import { cleanName, deriveFlavours, escapeHtml, per100 } from "./format.js";
import { recommend } from "./recommend.js";

const VIEWS = ["ledger", "add", "next"];
const MAX_SUGGESTIONS = 7;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_WEIGHT_GRAMS = 250;

const state = { owner: false, bags: [], catalog: null };
const draft = { black: null, milk: null };
let pickedCoffee = null;

const $ = (id) => document.getElementById(id);

async function init() {
  try {
    const [me, bags] = await Promise.all([getMe(), getBags()]);
    state.owner = me.owner;
    state.bags = bags;
  } catch (error) {
    showLoadError(error);
    return;
  }

  wireTabs();
  wireHeader();
  if (state.owner) wireForm();
  render();
}

function showLoadError(error) {
  const empty = $("ledgerEmpty");
  empty.hidden = false;
  empty.textContent = `Could not load the list. ${error.message}`;
}

function wireHeader() {
  const link = $("authLink");

  if (!state.owner) {
    $("publicNote").hidden = false;
    return;
  }

  link.textContent = "Sign out";
  link.href = "/logout";
  $("exportBtn").hidden = false;
  $("exportBtn").addEventListener("click", exportBags);
}

function wireTabs() {
  const buttons = document.querySelectorAll(".tabs button");

  if (state.owner) {
    buttons.forEach((button) => {
      button.hidden = false;
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
    });
  });
}

function showView(view) {
  VIEWS.forEach((name) => {
    $("view-" + name).hidden = name !== view;
  });

  document.querySelectorAll(".tabs button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  });

  if (view === "next") renderPicks();
  window.scrollTo(0, 0);
}

function render() {
  renderCount();
  renderBags();
}

function renderCount() {
  const roasters = new Set(state.bags.map((bag) => bag.roaster.toLowerCase()));
  $("count").textContent = state.bags.length
    ? `${state.bags.length} bags · ${roasters.size} roasters`
    : "No bags yet";
  $("ledgerEmpty").hidden = state.bags.length > 0;
}

function renderBags() {
  const list = $("bagList");
  list.replaceChildren();

  state.bags.forEach((bag) => {
    list.appendChild(bagElement(bag));
  });
}

function bagElement(bag) {
  const element = document.createElement("li");
  element.className = "bag";
  element.innerHTML = bagMarkup(bag);

  if (state.owner) addRatingControls(element, bag);
  return element;
}

function bagMarkup(bag) {
  const price = per100(bag);

  return `
    <div class="bag-head">
      <div>
        <h3>${escapeHtml(cleanName(bag.name))}</h3>
        <p class="roaster">${escapeHtml(bag.roaster)}</p>
      </div>
      <span class="price">${price ? "₹" + price + "/100g" : ""}</span>
    </div>
    <div class="meta">
      ${bag.roast ? `<span class="chip">${escapeHtml(bag.roast)}</span>` : ""}
      ${bag.black ? `<span class="chip rated">Black ${bag.black}</span>` : ""}
      ${bag.milk ? `<span class="chip rated">Milk ${bag.milk}</span>` : ""}
      <span class="chip">${escapeHtml(bag.date || "")}</span>
    </div>
    ${bag.note ? `<p class="note">${escapeHtml(bag.note)}</p>` : ""}
    ${
      state.owner
        ? `<details class="rate">
             <summary>${bag.black || bag.milk ? "Edit score" : "Rate"}</summary>
             <div class="score-row"><span>Black</span><div class="score" data-axis="black"></div></div>
             <div class="score-row"><span>Milk</span><div class="score" data-axis="milk"></div></div>
           </details>`
        : ""
    }`;
}

function addRatingControls(element, bag) {
  const hosts = element.querySelectorAll(".score");

  hosts.forEach((host) => {
    renderScoreButtons(host, bag[host.dataset.axis], (score) => {
      saveRating(bag, host.dataset.axis, score);
    });
  });
}

async function saveRating(bag, axis, score) {
  const nextScore = bag[axis] === score ? null : score;

  try {
    const updated = await updateBag(bag.id, { [axis]: nextScore });
    Object.assign(bag, updated);
    render();
  } catch (error) {
    alert(error.message);
  }
}

function renderScoreButtons(container, currentScore, onChange) {
  container.replaceChildren();

  for (let score = 1; score <= 5; score++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(score);
    button.setAttribute("aria-pressed", String(currentScore === score));
    button.addEventListener("click", () => onChange(score));
    container.appendChild(button);
  }
}

function wireForm() {
  wireAutocomplete();
  renderDraftScores();

  $("addForm").addEventListener("submit", submitBag);
  document.addEventListener("click", closeSuggestions);
}

function wireAutocomplete() {
  const input = $("coffee");
  input.addEventListener("input", () => {
    pickedCoffee = null;
    showSuggestions(input.value);
  });
}

async function showSuggestions(query) {
  const container = $("suggest");
  const text = query.trim().toLowerCase();

  if (text.length < MIN_QUERY_LENGTH) {
    container.hidden = true;
    return;
  }

  const catalog = await loadCatalog();
  const matches = catalog
    .filter((coffee) => coffee.name.toLowerCase().includes(text))
    .slice(0, MAX_SUGGESTIONS);

  container.replaceChildren();
  matches.forEach((coffee) => container.appendChild(suggestionButton(coffee)));
  container.hidden = matches.length === 0;
}

function suggestionButton(coffee) {
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `${escapeHtml(cleanName(coffee.name))}<small>${escapeHtml(
    coffee.roaster,
  )}${coffee.per100 ? " · ₹" + Math.round(coffee.per100) + "/100g" : ""}</small>`;

  button.addEventListener("click", () => {
    pickedCoffee = coffee;
    $("coffee").value = coffee.name;
    $("roaster").value = coffee.roaster;
    $("roast").value = coffee.roast || "";
    $("price").value = coffee.price || "";
    $("grams").value = coffee.grams || DEFAULT_WEIGHT_GRAMS;
    $("suggest").hidden = true;
  });

  return button;
}

function closeSuggestions(event) {
  const suggest = $("suggest");
  if (!suggest.contains(event.target) && event.target !== $("coffee")) {
    suggest.hidden = true;
  }
}

function renderDraftScores() {
  renderScoreButtons($("blackScore"), draft.black, (score) => {
    draft.black = draft.black === score ? null : score;
    renderDraftScores();
  });

  renderScoreButtons($("milkScore"), draft.milk, (score) => {
    draft.milk = draft.milk === score ? null : score;
    renderDraftScores();
  });
}

async function submitBag(event) {
  event.preventDefault();

  const note = $("note").value.trim();
  const bag = {
    roaster: $("roaster").value.trim(),
    name: $("coffee").value.trim(),
    roast: $("roast").value || null,
    price: Number($("price").value) || null,
    grams: Number($("grams").value) || null,
    date: $("date").value || today(),
    black: draft.black,
    milk: draft.milk,
    note,
    flavours: pickedCoffee?.flavours ?? deriveFlavours(note),
    process: pickedCoffee?.process ?? [],
  };

  try {
    const saved = await addBag(bag);
    state.bags.unshift(saved);
    resetForm(event.target);
    showView("ledger");
    render();
  } catch (error) {
    alert(error.message);
  }
}

function resetForm(form) {
  form.reset();
  $("grams").value = DEFAULT_WEIGHT_GRAMS;
  draft.black = null;
  draft.milk = null;
  pickedCoffee = null;
  renderDraftScores();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadCatalog() {
  if (!state.catalog) state.catalog = await getCatalog();
  return state.catalog;
}

async function renderPicks() {
  const catalog = await loadCatalog();
  const picks = recommend(state.bags, catalog);

  $("nextEmpty").hidden = picks.length > 0;
  $("nextFine").textContent = picks.length
    ? "Prices from the last catalog sync. Check the roaster's page before buying."
    : "";
  $("picks").replaceChildren(...picks.map(pickElement));
}

function pickElement({ kind, coffee, closest }) {
  const element = document.createElement("article");
  element.className = "pick";
  element.innerHTML = `
    <div class="kind">${kind}</div>
    <h3>${escapeHtml(cleanName(coffee.name))}</h3>
    <p class="roaster">${escapeHtml(coffee.roaster)}</p>
    <div class="numbers">
      <div><strong>₹${Math.round(coffee.per100)}</strong>per 100g</div>
      <div><strong>${escapeHtml(coffee.roast)}</strong>roast</div>
      <div><strong>₹${coffee.price}</strong>per ${coffee.grams}g</div>
    </div>
    ${closest ? `<p class="why">${reasonText(coffee, closest)}</p>` : ""}
    ${
      coffee.url
        ? `<a href="${escapeHtml(coffee.url)}" target="_blank" rel="noopener">Open bag →</a>`
        : ""
    }`;

  return element;
}

function reasonText(coffee, closest) {
  const flavours = coffee.flavours.slice(0, 3).join(", ");
  return `Closest to ${escapeHtml(closest.name)} (${escapeHtml(closest.roaster)}) — ${escapeHtml(
    coffee.roast,
  )}${flavours ? ", " + escapeHtml(flavours) : ""}.`;
}

function exportBags() {
  const blob = new Blob([JSON.stringify(state.bags, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "coffee-bags.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

init();
