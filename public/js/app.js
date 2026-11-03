import { addBag, getBags, getCatalog, getMe, updateBag } from "./api.js";
import { cleanName, deriveFlavours, per100 } from "./format.js";
import { recommend } from "./recommend.js";

const PICK_COUNT_KEY = "coffee.pickCount";
const DEFAULT_PICK_COUNT = 8;
const SEARCH_LIMIT = 7;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_WEIGHT_GRAMS = 250;

function blankForm() {
  return {
    roaster: "",
    roast: "",
    price: null,
    grams: DEFAULT_WEIGHT_GRAMS,
    date: new Date().toISOString().slice(0, 10),
    note: "",
    black: null,
    milk: null,
  };
}

document.addEventListener("alpine:init", () => {
  Alpine.data("coffeeLedger", () => ({
    view: "ledger",
    owner: false,
    bags: [],
    catalog: null,
    picks: [],
    count: Number(localStorage.getItem(PICK_COUNT_KEY)) || DEFAULT_PICK_COUNT,
    query: "",
    suggestions: [],
    picked: null,
    form: blankForm(),
    error: "",
    scores: [1, 2, 3, 4, 5],

    async init() {
      try {
        const [me, bags] = await Promise.all([getMe(), getBags()]);
        this.owner = me.owner;
        this.bags = bags;
      } catch (error) {
        this.error = `Could not load the list. ${error.message}`;
      }
    },

    get summary() {
      if (!this.bags.length) return "No bags yet";
      const roasters = new Set(
        this.bags.map((bag) => bag.roaster.toLowerCase()),
      );
      return `${this.bags.length} bags · ${roasters.size} roasters`;
    },

    displayName: (name) => cleanName(name),

    priceLabel(bag) {
      const price = per100(bag);
      return price ? `₹${price}/100g` : "";
    },

    reason(pick) {
      const flavours = pick.coffee.flavours.slice(0, 3).join(", ");
      const tail = flavours ? `, ${flavours}` : "";
      return `Closest to ${pick.closest.name} (${pick.closest.roaster}) — ${pick.coffee.roast}${tail}.`;
    },

    showView(view) {
      this.view = view;
      if (view === "next") this.loadPicks();
      window.scrollTo(0, 0);
    },

    async rate(bag, axis, score) {
      const next = bag[axis] === score ? null : score;
      try {
        const updated = await updateBag(bag.id, { [axis]: next });
        Object.assign(bag, updated);
      } catch (error) {
        this.error = error.message;
      }
    },

    async search() {
      const query = this.query.trim().toLowerCase();
      if (query.length < MIN_QUERY_LENGTH) {
        this.suggestions = [];
        return;
      }

      const catalog = await this.loadCatalog();
      this.suggestions = catalog
        .filter((coffee) => coffee.name.toLowerCase().includes(query))
        .slice(0, SEARCH_LIMIT);
    },

    pickSuggestion(coffee) {
      this.picked = coffee;
      this.query = coffee.name;
      this.form = {
        ...this.form,
        roaster: coffee.roaster,
        roast: coffee.roast || "",
        price: coffee.price ?? null,
        grams: coffee.grams ?? DEFAULT_WEIGHT_GRAMS,
      };
      this.suggestions = [];
    },

    async save() {
      const note = this.form.note.trim();
      const bag = {
        roaster: this.form.roaster.trim(),
        name: this.query.trim(),
        roast: this.form.roast || null,
        price: this.form.price || null,
        grams: this.form.grams || null,
        date: this.form.date || new Date().toISOString().slice(0, 10),
        black: this.form.black,
        milk: this.form.milk,
        note,
        flavours: this.picked?.flavours ?? deriveFlavours(note),
        process: this.picked?.process ?? [],
      };

      try {
        const saved = await addBag(bag);
        this.bags.unshift(saved);
        this.resetForm();
        this.view = "ledger";
      } catch (error) {
        this.error = error.message;
      }
    },

    resetForm() {
      this.form = blankForm();
      this.query = "";
      this.picked = null;
      this.suggestions = [];
    },

    async loadCatalog() {
      if (!this.catalog) this.catalog = await getCatalog();
      return this.catalog;
    },

    async loadPicks() {
      try {
        const catalog = await this.loadCatalog();
        this.picks = recommend(this.bags, catalog, this.count);
      } catch (error) {
        this.error = error.message;
      }
    },

    setCount() {
      localStorage.setItem(PICK_COUNT_KEY, this.count);
      this.loadPicks();
    },

    exportBags() {
      const blob = new Blob([JSON.stringify(this.bags, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "coffee-bags.json";
      link.click();
      URL.revokeObjectURL(link.href);
    },
  }));
});
