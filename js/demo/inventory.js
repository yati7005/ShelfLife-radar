/*
 * Expiry-risk logic and fictional sample inventory for the demo.
 * Pure data + functions (no DOM), so a real data source can replace it later.
 *
 * Sample expiry dates are set relative to today, so the demo always shows a
 * realistic mix of risk levels whatever day it is opened.
 */
(function () {
  var DAY_MS = 86400000;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = startOfDay(d); x.setDate(x.getDate() + n); return x; }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }

  // Whole days from today (local midnight) to the expiry date. Negative = already expired.
  // Math.round absorbs the one-hour difference on daylight-saving change days.
  function daysUntil(iso, today) {
    return Math.round((parseISO(iso) - startOfDay(today || new Date())) / DAY_MS);
  }

  // Ordered from most to least urgent. The first matching rule wins.
  var LEVELS = [
    { id: "expired",  label: "Expired",  range: "Past its expiry date",  max: -1 },
    { id: "critical", label: "Critical", range: "0–3 days left",          max: 3 },
    { id: "high",     label: "High",     range: "4–7 days left",          max: 7 },
    { id: "medium",   label: "Medium",   range: "8–14 days left",         max: 14 },
    { id: "low",      label: "Low",      range: "15–30 days left",        max: 30 },
    { id: "safe",     label: "Safe",     range: "More than 30 days left", max: Infinity }
  ];

  function classify(days) {
    for (var i = 0; i < LEVELS.length; i++) if (days <= LEVELS[i].max) return LEVELS[i];
    return LEVELS[LEVELS.length - 1];
  }

  // ---------- Smart action recommendations ----------
  // One recommendation per batch, chosen from its risk level, days left, quantity, category and lot.
  // `p` = { qty, category, batch: lot number, amount: "18 units" / "2.5 kg", size: qty in comparable
  // terms (a dozen counts 12, a gram 1/1000) }. `key` identifies the recommendation: a completion is stored
  // against it, so when the recommendation changes (an edit, or time passing) the old
  // completion no longer applies. Returns null when no action is needed.
  // Expired stock is only ever taken off sale — never discounted or sold.
  var PERISHABLE = { Dairy: 1, Bakery: 1, Meat: 1, Produce: 1, Deli: 1 };
  var LOTS = 15;          // "a lot of units" for one product line
  var OVERSTOCK = 30;     // enough that the next delivery should be looked at

  // English text is the key for the Hindi translation (i18n.js); sentences stay whole so they translate well.
  var t = window.SLi18n ? window.SLi18n.t : function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); };
  function rec(key, title, text, done, doneState) { return { key: key, title: t(title), text: text, done: t(done), doneState: t(doneState) }; }

  function recommend(p, days) {
    var level = classify(days).id;
    var perishable = !!PERISHABLE[p.category];
    var v = { amount: p.amount || p.qty + (p.qty === 1 ? " unit" : " units"), days: days, lot: p.batch };
    var size = p.size === undefined ? p.qty : p.size;

    if (level === "expired") {
      // Larger lots or a known batch are worth raising with the supplier; small lots are written off.
      if (size >= LOTS || p.batch) {
        return rec("expired-remove-supplier", "Remove from sale and contact the supplier",
          p.batch ? t("Take all {amount} off the shelf now — expired stock must not be sold. Then ask the supplier about a return or credit (batch {lot}).", v)
                  : t("Take all {amount} off the shelf now — expired stock must not be sold. Then ask the supplier about a return or credit.", v),
          "Mark as removed and supplier contacted", "Removed; supplier contacted");
      }
      return rec("expired-remove", "Remove from sale",
        t("Take all {amount} off the shelf now and record it as waste. Expired stock must not be sold.", v),
        "Mark as removed from sale", "Removed from sale");
    }

    if (level === "critical") {
      if (days === 0) {
        return rec("critical-last-day", "Last day of sale",
          t("Mark it down by 50% today. Anything still on the shelf at closing comes off sale tonight."),
          "Mark last-day markdown done", "Last-day markdown done");
      }
      if (size >= LOTS) {
        return rec("critical-markdown", "Mark down and move to the front",
          t("Discount all {amount} by 30–50% and move it to the front of the shelf today.", v),
          "Mark discount applied", "Discount applied");
      }
      return rec("critical-front", "Move to the front",
        t("Put all {amount} at the front, at eye level. If any is still there tomorrow, mark it down by 30%.", v),
        "Mark moved to the front", "Moved to the front");
    }

    if (level === "high") {
      if (size >= LOTS && p.batch) {
        return rec("high-supplier", "Ask the supplier about this batch",
          t("{amount} is a lot to sell in {days} days. Ask the supplier whether batch {lot} can be returned or swapped now, while it still can.", v),
          "Mark supplier contacted", "Supplier contacted");
      }
      if (size >= LOTS) {
        return rec("high-markdown-plan", "Plan a markdown this week",
          t("{amount} is a lot to sell in {days} days. Plan a 15–20% markdown for later this week.", v),
          "Mark markdown planned", "Markdown planned");
      }
      return rec("high-rotate", "Prioritise stock rotation",
        t("Move it to the front and make sure no older stock is hiding behind it."),
        "Mark rotation done", "Rotation done");
    }

    if (level === "medium") {
      if (size >= OVERSTOCK) {
        return rec("medium-check-stock", "Check stock before reordering",
          t("{amount} with about two weeks left. Check how fast it sells before the next order, and hold the reorder if it’s slow.", v),
          "Mark stock checked", "Stock checked");
      }
      if (perishable) {
        return rec("medium-rotate", "Prioritise stock rotation",
          t("Keep older batches in front (first in, first out) so this one sells before newer deliveries."),
          "Mark rotation checked", "Rotation checked");
      }
      return null;   // shelf-stable with two weeks left: nothing to do yet
    }

    return null;      // low / safe: no action needed
  }

  // Why no action is needed (shown instead of a recommendation).
  function noActionReason(p, days) {
    var level = classify(days).id;
    if (level === "medium") return t("Shelf-stable stock with about two weeks left sells through normally. Look again next week.");
    if (level === "low") return t("It has {days} days left. Nothing to do yet — it will get a recommendation as its date gets closer.", { days: days });
    return t("It has more than a month left. Nothing to do.");
  }

  // Fictional products and their batches. Offsets are days from today, so the sample
  // always shows a realistic mix. Some batches deliberately have no cost or supplier,
  // because real records are often incomplete. `cost` = purchase cost per unit (INR).
  // Sample barcodes use the 200–299 prefix, which GS1 reserves for in-store codes, so they can't
  // collide with a real product's barcode. Loose and in-house items have none, as in a real shop.
  var SAMPLE_PRODUCTS = [
    { id: "milk",      name: "Fresh Milk 1L",         category: "Dairy",     barcode: "2000000000015" },
    { id: "croissant", name: "Butter Croissants 4pk", category: "Bakery",    barcode: "" },
    { id: "sourdough", name: "Sourdough Loaf",        category: "Bakery",    barcode: "" },
    { id: "yogurt",    name: "Greek Yogurt 500g",     category: "Dairy",     barcode: "2000000000022" },
    { id: "chicken",   name: "Chicken Breast 500g",   category: "Meat",      barcode: "" },
    { id: "juice",     name: "Orange Juice 1L",       category: "Beverages", barcode: "2000000000039" },
    { id: "spinach",   name: "Baby Spinach 200g",     category: "Produce",   barcode: "" },
    { id: "cheddar",   name: "Cheddar Cheese 400g",   category: "Dairy",     barcode: "" },
    { id: "hummus",    name: "Hummus 250g",           category: "Deli",      barcode: "" },
    { id: "chips",     name: "Tortilla Chips 200g",   category: "Snacks",    barcode: "2000000000046" },
    { id: "granola",   name: "Granola Bars 6pk",      category: "Snacks",    barcode: "" },
    { id: "rice",      name: "Basmati Rice (loose)",  category: "Pantry",    barcode: "", unit: "kg" }
  ];
  // Single-batch products reuse the product id as the batch id (keeps older saved statuses attached).
  var SAMPLE_BATCHES = [
    { id: "milk",       productId: "milk",      lot: "M-2210",  qty: 18, offset: -1,  supplier: "Gokul Dairy",          cost: 54,  received: -6 },
    { id: "croissant",  productId: "croissant", lot: "",        qty: 7,  offset: -3,  supplier: "Daily Bake House",     cost: 120, received: -5 },
    { id: "sourdough",  productId: "sourdough", lot: "",        qty: 12, offset: 0,   supplier: "Daily Bake House",     cost: 90,  received: -2 },
    { id: "yogurt",     productId: "yogurt",    lot: "Y-102",   qty: 24, offset: 2,   supplier: "Gokul Dairy",          cost: 110, received: -12 },
    { id: "yogurt-b2",  productId: "yogurt",    lot: "Y-118",   qty: 30, offset: 12,  supplier: "Gokul Dairy",          cost: 110, received: -2 },
    { id: "chicken",    productId: "chicken",   lot: "",        qty: 9,  offset: 3,   supplier: "City Meats",           cost: 260, received: -1 },
    { id: "juice",      productId: "juice",     lot: "",        qty: 16, offset: 5,   supplier: "",                     cost: 125, received: -20 },
    { id: "spinach",    productId: "spinach",   lot: "SP-31",   qty: 20, offset: 7,   supplier: "Fresh Fields Produce", cost: 45,  received: -3 },
    { id: "cheddar",    productId: "cheddar",   lot: "",        qty: 14, offset: 10,  supplier: "Gokul Dairy",          cost: 380, received: -30 },
    { id: "hummus",     productId: "hummus",    lot: "",        qty: 10, offset: 14,  supplier: "",                     cost: null, received: null },
    { id: "chips",      productId: "chips",     lot: "",        qty: 36, offset: 22,  supplier: "",                     cost: 60,  received: -40 },
    { id: "granola",    productId: "granola",   lot: "",        qty: 30, offset: 95,  supplier: "",                     cost: null, received: null },
    { id: "rice",       productId: "rice",      lot: "BR-0907", qty: 37.5, offset: 240, supplier: "",                   cost: 104, received: -60 }
  ];

  // Selling price per unit (₹) for the sample. Two batches have none, as real records often don't.
  var SAMPLE_PRICE = { milk: 66, croissant: 160, sourdough: 130, yogurt: 140, "yogurt-b2": 140, chicken: 320, juice: 160,
    cheddar: 480, hummus: 199, chips: 85, rice: 130 };

  function sampleInventory(today) {
    var t = today || new Date();
    return {
      products: SAMPLE_PRODUCTS.map(function (p) { return { id: p.id, name: p.name, category: p.category, unit: p.unit || "pcs", barcode: p.barcode }; }),
      batches: SAMPLE_BATCHES.map(function (b) {
        return { id: b.id, productId: b.productId, lot: b.lot, qty: b.qty, expires: toISO(addDays(t, b.offset)),
          supplier: b.supplier, unitCost: b.cost, price: SAMPLE_PRICE[b.id] === undefined ? null : SAMPLE_PRICE[b.id],
          received: b.received === null ? "" : toISO(addDays(t, b.received)) };
      })
    };
  }

  window.SLInventory = {
    LEVELS: LEVELS,
    recommend: recommend,
    noActionReason: noActionReason,
    classify: classify,
    daysUntil: daysUntil,
    parseISO: parseISO,
    toISO: toISO,
    sampleInventory: sampleInventory
  };
})();
