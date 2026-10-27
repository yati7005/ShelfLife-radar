/*
 * ShelfLife Radar — data layer (no DOM).
 *
 * Model (saved in localStorage under one key, version 3):
 *   products: [{ id, name, category, unit, barcode }]  unit: an id from UNITS; barcode: "" or a GTIN
 *   batches:  [{ id, productId, lot, qty, expires, supplier, unitCost, received }]
 *   statuses: { batchId: { s: "done" | "reviewed", at, rec } }
 *   writeoffs: [{ id, batchId, productId, name, lot, supplier, qty, unitCost, expires,
 *                 outcome: "waste" | "return", claim: null | "pending" | "received" | "refused",
 *                 at, settledAt }]
 *     An expired batch that comes off the shelf leaves the stock and becomes one write-off.
 *     It keeps a copy of the name, lot and cost, so it stays correct if the product is later
 *     edited or deleted — and since the batch is gone from stock, nothing is counted twice.
 * A product's quantity is always the sum of its batches — it is never stored, so the two
 * can't disagree. Risk is never stored either: it is derived from each batch's expiry date.
 *
 * products/batches === null means "the untouched sample", whose dates stay relative to today.
 *
 * Safety:
 *   - Older saved data (version 1/2: one quantity + date per product) is migrated, and the raw
 *     original is copied to a backup key first. Nothing is deleted automatically.
 *   - Unreadable data is also copied to a backup key before the sample is shown.
 *   - Broken records are dropped one by one; everything valid is kept.
 */
(function () {
  var Inv = window.SLInventory;
  if (!Inv) return;
  var t = window.SLi18n ? window.SLi18n.t : function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); };
  var fmtNum = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

  var KEY = "shelflife-radar-demo-v1";
  var BACKUP_PREFIX = "shelflife-radar-backup-";
  var VERSION = 3;
  var CATEGORIES = ["Dairy", "Bakery", "Meat", "Produce", "Beverages", "Deli", "Snacks", "Pantry", "Frozen", "Other"];
  var LIMITS = { name: 60, lot: 24, supplier: 60, shop: 60, qty: 99999, cost: 1000000, pastYears: 5, futureYears: 10 };

  // How a product is counted. Every batch of a product uses the product's unit, so they add up.
  // whole: quantities are whole numbers. size: roughly how much one of it is "worth" when the
  // recommendations judge whether a batch is a lot to sell (12 per dozen, 1/1000 per gram).
  var UNITS = [
    { id: "pcs",   label: "Units / pieces",   one: "unit",   many: "units",   per: "unit",   whole: true,  size: 1 },
    { id: "pack",  label: "Packets",          one: "packet", many: "packets", per: "packet", whole: true,  size: 1 },
    { id: "box",   label: "Boxes",            one: "box",    many: "boxes",   per: "box",    whole: true,  size: 1 },
    { id: "dozen", label: "Dozen",            one: "dozen",  many: "dozen",   per: "dozen",  whole: true,  size: 12 },
    { id: "kg",    label: "Kilograms (kg)",   one: "kg",     many: "kg",      per: "kg",     whole: false, size: 1 },
    { id: "g",     label: "Grams (g)",        one: "g",      many: "g",       per: "g",      whole: true,  size: 0.001 },
    { id: "l",     label: "Litres (L)",       one: "L",      many: "L",       per: "litre",  whole: false, size: 1 },
    { id: "ml",    label: "Millilitres (ml)", one: "ml",     many: "ml",      per: "ml",     whole: true,  size: 0.001 }
  ];
  var UNIT = {};
  UNITS.forEach(function (u) { UNIT[u.id] = u; });
  function unitOf(id) { return UNIT[id] || UNIT.pcs; }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  // A stored quantity is valid for its unit: more than 0, whole if the unit needs it, at most 3 decimals.
  function validQty(n, unitId) {
    return typeof n === "number" && isFinite(n) && n > 0 && n <= LIMITS.qty && round3(n) === n && (!unitOf(unitId).whole || Number.isInteger(n));
  }

  // ---------- small helpers ----------
  function validISO(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = Inv.parseISO(s);
    return !isNaN(d) && Inv.toISO(d) === s;          // rejects 2026-02-31
  }
  function text(v, max) { return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
  function sameText(a, b) { return text(a, 200).toLowerCase() === text(b, 200).toLowerCase(); }
  function money(n) { return Math.round(n * 100) / 100; }

  // Retail barcodes (EAN-8, UPC-A, EAN-13, ITF-14) end in a check digit, so most typos and misreads are caught.
  function validGTIN(code) {
    if (typeof code !== "string" || !/^(\d{8}|\d{12,14})$/.test(code)) return false;
    var sum = 0;
    for (var i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +code[i] * w;
    return (10 - sum % 10) % 10 === +code[code.length - 1];
  }
  function barcodeText(v) { return typeof v === "string" ? v.replace(/[\s-]/g, "") : ""; }
  // Ids end up in the page (data attributes, element ids), so only plain ones are accepted.
  function validId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id); }

  function cleanProduct(p) {
    if (!p || typeof p !== "object" || !validId(p.id)) return null;
    var name = text(p.name, LIMITS.name);
    if (!name) return null;
    var code = barcodeText(p.barcode);
    return { id: p.id, name: name, category: CATEGORIES.indexOf(p.category) !== -1 ? p.category : "Other",
      unit: UNIT[p.unit] ? p.unit : "pcs", barcode: validGTIN(code) ? code : "" };
  }
  // unitId: the unit of the batch's product (whole-number units reject 2.5)
  function cleanBatch(b, unitId) {
    if (!b || typeof b !== "object" || !validId(b.id) || !validId(b.productId)) return null;
    var qty = Number(b.qty);
    if (!validQty(qty, unitId) || !validISO(b.expires)) return null;
    var cost = amountOrNull(b.unitCost);       // unknown, not invented
    var price = amountOrNull(b.price);
    return {
      id: b.id, productId: b.productId,
      lot: text(b.lot, LIMITS.lot), qty: qty, expires: b.expires,
      supplier: text(b.supplier, LIMITS.supplier),
      unitCost: cost, price: price,
      received: validISO(b.received) ? b.received : ""
    };
  }
  // a stored rupee amount, or null when it's missing or makes no sense
  function amountOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= LIMITS.cost ? money(n) : null;
  }
  // a sale: part (or all) of a batch sold. A copy of the name and prices, like a write-off.
  function cleanSale(s) {
    if (!s || typeof s !== "object" || !validId(s.id)) return null;
    var name = text(s.name, LIMITS.name);
    var qty = Number(s.qty);
    var unit = UNIT[s.unit] ? s.unit : "pcs";
    if (!name || !validQty(qty, unit) || !validISO(s.at)) return null;
    return {
      id: s.id, batchId: validId(s.batchId) ? s.batchId : "", productId: validId(s.productId) ? s.productId : "",
      name: name, lot: text(s.lot, LIMITS.lot), expires: validISO(s.expires) ? s.expires : "", qty: qty, unit: unit,
      unitCost: amountOrNull(s.unitCost), price: amountOrNull(s.price), at: s.at
    };
  }

  var CLAIMS = { pending: 1, received: 1, refused: 1 };
  function cleanWriteoff(w) {
    if (!w || typeof w !== "object" || !validId(w.id)) return null;
    var name = text(w.name, LIMITS.name);
    var qty = Number(w.qty);
    var unit = UNIT[w.unit] ? w.unit : "pcs";
    if (!name || !validQty(qty, unit) || !validISO(w.at)) return null;
    if (w.outcome !== "waste" && w.outcome !== "return") return null;
    var claim = w.outcome === "return" ? (CLAIMS[w.claim] ? w.claim : "pending") : null;
    var cost = amountOrNull(w.unitCost);
    return {
      id: w.id, batchId: validId(w.batchId) ? w.batchId : "", productId: validId(w.productId) ? w.productId : "",
      name: name, lot: text(w.lot, LIMITS.lot), supplier: text(w.supplier, LIMITS.supplier),
      qty: qty, unit: unit, unitCost: cost, expires: validISO(w.expires) ? w.expires : "",
      outcome: w.outcome, claim: claim, at: w.at,
      settledAt: claim && claim !== "pending" && validISO(w.settledAt) ? w.settledAt : ""
    };
  }
  // Value in paise (whole numbers), so sums never pick up floating-point dust. null = cost unknown.
  function valuePaise(qty, unitCost) { return unitCost === null ? null : Math.round(qty * unitCost * 100); }

  // Copies are kept in this browser; the 10 newest stay, so repeated resets can't fill the storage.
  var KEEP_COPIES = 10;
  function keepBackup(raw) {
    var key = BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
    try { localStorage.setItem(key, raw); } catch (e) { return null; }
    var all = listBackups();
    try { all.slice(0, Math.max(0, all.length - KEEP_COPIES)).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    return key;
  }
  function listBackups() {
    var keys = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(BACKUP_PREFIX) === 0) keys.push(k); } } catch (e) {}
    return keys.sort();
  }

  function sample(today) { return Inv.sampleInventory(today); }

  // ---------- cleaning (shared by load and restore) ----------
  // Turns parsed saved data (or a backup file) into usable data, record by record. Changes nothing.
  // Returns { products|null, batches|null, statuses, writeoffs, sales, shop, customized, dropped, migratedFrom }
  function cleanData(d) {
    var out = { products: null, batches: null, statuses: {}, writeoffs: [], sales: [], shop: "", customized: false, dropped: 0, migratedFrom: 0 };
    out.statuses = d.statuses && typeof d.statuses === "object" && !Array.isArray(d.statuses) ? d.statuses : {};
    out.shop = text(d.shop, LIMITS.shop);
    out.own = d.own === true;                    // a shop of its own (started empty), not the demo's sample
    var products = null, batches = null;
    var dropped = 0, seenW = {}, seenS = {};
    if (Array.isArray(d.writeoffs)) {
      out.writeoffs = d.writeoffs.map(cleanWriteoff).filter(function (w) {
        if (!w || seenW[w.id]) { dropped++; return false; }
        seenW[w.id] = true; return true;
      });
    }
    if (Array.isArray(d.sales)) {
      out.sales = d.sales.map(cleanSale).filter(function (s) {
        if (!s || seenS[s.id]) { dropped++; return false; }
        seenS[s.id] = true; return true;
      });
    }

    if (d.version === VERSION) {
      // products/batches null = the untouched sample; anything else that isn't a list is damage, not "sample"
      if (Array.isArray(d.products)) {
        products = d.products;
        if (Array.isArray(d.batches)) batches = d.batches;
        else { batches = []; if (d.batches !== null && d.batches !== undefined) dropped++; }
      } else if (d.products !== null && d.products !== undefined) dropped++;
    } else if (Array.isArray(d.products)) {
      // version 1/2: one quantity + expiry per product → one product + one batch (same id)
      out.migratedFrom = d.version || 1;
      products = []; batches = [];
      d.products.forEach(function (p) {
        if (!p || typeof p !== "object") return;
        products.push({ id: p.id, name: p.name, category: p.category, unit: "pcs" });
        batches.push({ id: p.id, productId: p.id, lot: p.batch || "", qty: p.qty, expires: p.expires, supplier: "", unitCost: null, received: "" });
      });
    }

    if (products) {
      var seenP = {}, seenB = {}, lostP = {};
      out.products = products.map(function (raw) {
        var p = cleanProduct(raw);
        if (!p && raw && typeof raw.id === "string") lostP[raw.id] = true;
        return p;
      }).filter(function (p) {
        if (!p || seenP[p.id]) { dropped++; return false; }
        seenP[p.id] = true; return true;
      });
      var seenCode = {};                     // a barcode belongs to one product; a repeat is cleared, the product kept
      out.products.forEach(function (p) { if (p.barcode) { if (seenCode[p.barcode]) p.barcode = ""; else seenCode[p.barcode] = true; } });
      var unitOfProduct = {};
      out.products.forEach(function (p) { unitOfProduct[p.id] = p.unit; });
      out.batches = batches.map(function (raw) {
        var b = cleanBatch(raw, raw && unitOfProduct[raw.productId]);
        // a batch whose product was already counted as damaged isn't counted again
        if (b && !seenP[b.productId] && lostP[b.productId]) { b.counted = true; }
        return b;
      }).filter(function (b) {
        if (!b || seenB[b.id] || !seenP[b.productId]) { if (!(b && b.counted)) dropped++; return false; }
        seenB[b.id] = true; return true;
      });
      out.customized = true;
    }
    out.dropped = dropped;
    return out;
  }
  // statuses only for batches that exist, and only in a known shape: { s, at: a time, rec: a
  // recommendation key (a "done" mark always belongs to one) or null }. Statuses saved before
  // recommendations existed have no rec at all; app.js adopts those.
  function keepKnownStatuses(out) {
    var batchIds = {}, kept = {};
    out.batches.forEach(function (b) { batchIds[b.id] = true; });
    Object.keys(out.statuses).forEach(function (id) {
      var st = out.statuses[id];
      if (!batchIds[id] || !st || typeof st !== "object" || (st.s !== "done" && st.s !== "reviewed")) return;
      if (typeof st.at !== "number" || !isFinite(st.at) || isNaN(new Date(st.at))) return;
      var hasRec = "rec" in st;
      if (hasRec && st.rec !== null && typeof st.rec !== "string") return;
      if (hasRec && st.s === "done" && !st.rec) return;
      kept[id] = hasRec ? { s: st.s, at: st.at, rec: st.rec } : { s: st.s, at: st.at };
    });
    out.statuses = kept;
  }

  // ---------- load ----------
  function load(today) {
    var out = { products: null, batches: null, statuses: {}, writeoffs: [], sales: [], shop: "", customized: false, notices: [] };
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { out.notices.push({ type: "no-storage" }); }

    var d = null;
    if (raw) {
      try { d = JSON.parse(raw); } catch (e) { d = undefined; }
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        out.notices.push({ type: "unreadable", backup: keepBackup(raw) });
        d = null;
      }
    }

    if (d) {
      var c = cleanData(d);
      out.products = c.products; out.batches = c.batches; out.statuses = c.statuses;
      out.writeoffs = c.writeoffs; out.sales = c.sales; out.shop = c.shop; out.own = c.own; out.customized = c.customized;
      // keep the original before anything is saved over it; notice.backup is the copy's key, or null if it failed
      var copy = c.migratedFrom || c.dropped ? keepBackup(raw) : null;
      if (c.migratedFrom) out.notices.push({ type: "migrated", from: c.migratedFrom, backup: copy });
      if (c.dropped) out.notices.push({ type: "repaired", dropped: c.dropped, backup: copy });
    }

    if (!out.products) {
      var s = sample(today);
      out.products = s.products; out.batches = s.batches;
    }
    keepKnownStatuses(out);
    return out;
  }

  // ---------- backup files ----------
  // A backup is everything in one JSON file, so the shop can keep it safe or move it to another device.
  var BACKUP_KIND = "shelflife-radar-backup";
  function backupFile(data) {
    return JSON.stringify({
      kind: BACKUP_KIND, version: VERSION, savedAt: new Date().toISOString(),
      shop: data.shop || "", own: !!data.own, products: data.products, batches: data.batches, statuses: data.statuses,
      writeoffs: data.writeoffs, sales: data.sales || []
    }, null, 1);
  }
  // Checks a backup file and returns { data, dropped, savedAt } or { fatal }. Changes nothing.
  function readBackup(text) {
    var d;
    try { d = JSON.parse(String(text).replace(/^﻿/, "")); } catch (e) { d = null; }
    if (!d || typeof d !== "object" || d.kind !== BACKUP_KIND) return { fatal: t("This isn’t a ShelfLife Radar backup file. Choose the .json file made by “Download backup”.") };
    if (typeof d.version !== "number" || d.version > VERSION) return { fatal: t("This backup was made by a newer version of the app, so it can’t be read here.") };
    var c = cleanData(d);
    if (!c.products) return { fatal: t("This backup file has no stock in it.") };
    var data = { products: c.products, batches: c.batches, statuses: c.statuses, writeoffs: c.writeoffs, sales: c.sales, shop: c.shop, own: c.own, customized: true, notices: [] };
    keepKnownStatuses(data);
    var when = typeof d.savedAt === "string" ? new Date(d.savedAt) : null;
    // older backups have no shop name: restoring one keeps the current name rather than wiping it
    return { data: data, dropped: c.dropped, savedAt: when && !isNaN(when) ? when : null, hasShop: typeof d.shop === "string" };
  }
  // Before a restore replaces what's saved, a copy of it is kept (in this browser).
  function keepCurrent() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    return raw ? keepBackup(raw) : true;
  }

  // ---------- save ----------
  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: VERSION,
        savedAt: new Date().toISOString(),
        shop: data.shop || "",
        own: !!data.own,
        statuses: data.statuses,
        writeoffs: data.writeoffs,
        sales: data.sales || [],
        products: data.customized ? data.products : null,
        batches: data.customized ? data.batches : null
      }));
      return true;
    } catch (e) { return false; }        // e.g. storage full or blocked; the caller tells the user
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  // A shop of one's own, with nothing in it yet.
  function empty(shop) {
    return { products: [], batches: [], statuses: {}, writeoffs: [], sales: [], shop: text(shop, LIMITS.shop), own: true, customized: true, notices: [] };
  }

  function newId(prefix, taken) {
    var id;
    do { id = prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); } while (taken[id]);
    return id;
  }

  // ---------- validation ----------
  // Every message says what to do, not just what is wrong. Messages go through t() (English or Hindi).
  function validateProduct(raw, ctx) {
    var e = {};
    var name = text(raw.name, 200);
    if (!name) e.name = t("Enter the product’s name.");
    else if (name.length > LIMITS.name) e.name = t("Keep the name under {n} characters.", { n: LIMITS.name });
    else if (ctx.products.some(function (p) { return p.id !== ctx.excludeId && sameText(p.name, name); })) {
      e.name = t("There’s already a product called “{name}”. Open it and add a batch instead, or use a different name.", { name: name });
    }
    if (CATEGORIES.indexOf(raw.category) === -1) e.category = t("Choose a category.");
    var code = barcodeText(raw.barcode);
    if (code) {
      if (!/^\d+$/.test(code)) e.barcode = t("A barcode is only digits — check the number under the bars.");
      else if (!/^(\d{8}|\d{12,14})$/.test(code)) e.barcode = t("Product barcodes have 8, 12, 13 or 14 digits. This one has {n}.", { n: code.length });
      else if (!validGTIN(code)) e.barcode = t("This barcode’s last digit doesn’t match the others — it was probably mistyped or misread. Check it, or scan again.");
      else {
        var owner = ctx.products.filter(function (p) { return p.id !== ctx.excludeId && p.barcode === code; })[0];
        if (owner) e.barcode = t("This barcode already belongs to “{name}”.", { name: owner.name });
      }
    }
    var unit = raw.unit || "pcs";
    if (!UNIT[unit]) e.unit = t("Choose how this product is counted.");
    else if (UNIT[unit].whole && ctx.batches) {
      // switching to a whole-number unit can't leave a batch holding 2.5
      var part = ctx.batches.filter(function (b) { return b.productId === ctx.excludeId && !Number.isInteger(b.qty); })[0];
      if (part) e.unit = t("A batch of this product holds {qty}, which isn’t a whole number. Change that batch’s quantity first.", { qty: fmtNum.format(part.qty) });
    }
    return Object.keys(e).length ? { errors: e } : { values: { name: name, category: raw.category, unit: unit, barcode: code } };
  }
  function findProductByBarcode(products, code) {
    code = barcodeText(code);
    return code ? products.filter(function (p) { return p.barcode === code; })[0] || null : null;
  }

  // Duplicate batches of the same product: same lot number, or (with no lot number) the same expiry date.
  function findDuplicateBatch(batches, productId, lot, expires, excludeId) {
    return batches.filter(function (b) {
      if (b.productId !== productId || b.id === excludeId) return false;
      return lot ? sameText(b.lot, lot) : !b.lot && b.expires === expires;
    })[0] || null;
  }
  function findProductByName(products, name) {
    return products.filter(function (p) { return sameText(p.name, name); })[0] || null;
  }

  // raw: { lot, qty, qtyBad, expires, expiresBad, supplier, cost, costBad, received, receivedBad }
  // ctx: { batches, productId, excludeId, today, unit }
  function validateBatch(raw, ctx) {
    var e = {};
    var today = ctx.today;
    var u = unitOf(ctx.unit);
    var min = new Date(today.getFullYear() - LIMITS.pastYears, today.getMonth(), today.getDate());
    var max = new Date(today.getFullYear() + LIMITS.futureYears, today.getMonth(), today.getDate());
    var lot = text(raw.lot, 200);
    var qtyRaw = String(raw.qty || "").trim().replace(",", ".");
    var costRaw = String(raw.cost || "").trim().replace(",", ".");

    if (lot.length > LIMITS.lot) e.lot = t("Keep the batch number under {n} characters.", { n: LIMITS.lot });

    var qtyShape = u.whole ? /^\d+$/ : /^\d+(\.\d{1,3})?$/;
    if (raw.qtyBad) e.qty = u.whole ? t("Use a whole number, like 12.") : t("Use a number, like 2.5.");
    else if (qtyRaw === "") e.qty = t("Enter how much is in this batch.");
    else if (!qtyShape.test(qtyRaw)) e.qty = u.whole ? t("Use a whole number of {unit}, like 12 — no decimals or minus signs.", { unit: t(u.many) }) : t("Use a number with up to three decimals, like 2.5 — no minus signs.");
    else if (+qtyRaw <= 0) e.qty = t("A batch can’t be empty. To remove it, delete the batch instead.");
    else if (+qtyRaw > LIMITS.qty) e.qty = t("That’s more than {amount} — check the number.", { amount: amount(LIMITS.qty, u.id) });

    if (raw.expiresBad) e.expires = t("That date isn’t complete — check the day, month and year.");
    else if (!raw.expires) e.expires = t("Choose the expiry date printed on this batch.");
    else if (!validISO(raw.expires)) e.expires = t("That isn’t a real date — check the day and month.");
    else if (Inv.parseISO(raw.expires) < min) e.expires = t("That’s more than {n} years ago — check the year.", { n: LIMITS.pastYears });
    else if (Inv.parseISO(raw.expires) > max) e.expires = t("That’s more than {n} years away — check the year.", { n: LIMITS.futureYears });

    var supplier = text(raw.supplier, 200);
    if (supplier.length > LIMITS.supplier) e.supplier = t("Keep the supplier name under {n} characters.", { n: LIMITS.supplier });

    var cost = null;
    if (raw.costBad) e.cost = t("Use a number, like 42 or 42.50.");
    else if (costRaw !== "") {
      if (!/^\d+(\.\d{1,2})?$/.test(costRaw)) e.cost = t("Use a number with up to two decimals, like 42.50 — no currency symbols.");
      else if (+costRaw > LIMITS.cost) e.cost = t("That cost looks too high — check the number.");
      else cost = money(+costRaw);
    }

    var priceRaw = String(raw.price || "").trim().replace(",", ".");
    var price = null;
    if (raw.priceBad) e.price = t("Use a number, like 42 or 42.50.");
    else if (priceRaw !== "") {
      if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) e.price = t("Use a number with up to two decimals, like 42.50 — no currency symbols.");
      else if (+priceRaw > LIMITS.cost) e.price = t("That price looks too high — check the number.");
      else price = money(+priceRaw);
    }

    var received = "";
    if (raw.receivedBad) e.received = t("That date isn’t complete — check the day, month and year.");
    else if (raw.received) {
      if (!validISO(raw.received)) e.received = t("That isn’t a real date — check the day and month.");
      else if (Inv.parseISO(raw.received) > new Date(today.getFullYear(), today.getMonth(), today.getDate())) e.received = t("A delivery can’t be received in the future.");
      else if (Inv.parseISO(raw.received) < min) e.received = t("That’s more than {n} years ago — check the year.", { n: LIMITS.pastYears });
      else if (!e.expires && raw.received > raw.expires) e.received = t("This is after the expiry date — check both dates.");
      else received = raw.received;
    }

    if (!e.lot && !e.expires) {
      if (findDuplicateBatch(ctx.batches, ctx.productId, lot, raw.expires, ctx.excludeId)) {
        if (lot) e.lot = t("Batch “{lot}” is already recorded for this product. Edit that batch instead.", { lot: lot });
        else e.expires = t("There’s already a batch with this expiry date and no batch number. Edit that batch, or give this one a batch number.");
      }
    }

    if (Object.keys(e).length) return { errors: e };
    return { values: { lot: lot, qty: round3(+qtyRaw), expires: raw.expires, supplier: supplier, unitCost: cost, price: price, received: received } };
  }

  // How much of a batch was sold: more than 0, no more than is there, whole if the unit needs it.
  // Returns { qty } or { error }.
  function validateSale(raw, batch, unitId) {
    var u = unitOf(unitId);
    var s = String(raw === undefined || raw === null ? "" : raw).trim().replace(",", ".");
    if (s === "") return { error: t("Enter how much was sold.") };
    if (!(u.whole ? /^\d+$/ : /^\d+(\.\d{1,3})?$/).test(s)) return { error: u.whole ? t("Use a whole number, like 3.") : t("Use a number, like 1.5.") };
    var n = round3(+s);
    if (n <= 0) return { error: t("Enter more than 0.") };
    if (n > batch.qty) return { error: t("Only {amount} left in this batch.", { amount: amount(batch.qty, unitId) }) };
    return { qty: n };
  }

  // "18 units", "2.5 kg", "1 dozen" — in the page's language
  function amount(qty, unitId) {
    var u = unitOf(unitId);
    return fmtNum.format(qty) + " " + t(qty === 1 ? u.one : u.many);
  }

  window.SLStore = {
    KEY: KEY, VERSION: VERSION, CATEGORIES: CATEGORIES, LIMITS: LIMITS,
    UNITS: UNITS, unitOf: unitOf, amount: amount, round3: round3,
    load: load, save: save, clear: clear, sample: sample, newId: newId, listBackups: listBackups,
    backupFile: backupFile, readBackup: readBackup, keepCurrent: keepCurrent, empty: empty, validateSale: validateSale, validQty: validQty,
    validISO: validISO, validateProduct: validateProduct, validateBatch: validateBatch,
    valuePaise: valuePaise, findDuplicateBatch: findDuplicateBatch, findProductByName: findProductByName,
    validGTIN: validGTIN, findProductByBarcode: findProductByBarcode
  };
})();
