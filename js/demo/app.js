/*
 * The Shelf — ShelfLife Radar demo (interface).
 *
 *   Opening   – identity: the headline and a date stamp that rolls forward to today.
 *   Inventory – action: search, one risk filter, one count line, and one row per *batch*,
 *               grouped past due → coming soon → on the horizon (+ products with no stock).
 *   Details   – on demand: a batch row expands to explain its status and recommendation,
 *               and to manage the batch, its product and the product's other batches.
 *
 * Data lives in store.js (model, validation, persistence); risk rules and recommendations
 * in inventory.js. Quantities per product are always the sum of their batches, in the
 * product's unit. All text goes through t() / tn() (i18n.js), so it can be shown in Hindi.
 */
(function () {
  var Inv = window.SLInventory;
  var Store = window.SLStore;
  var SL = window.SL;
  var I18n = window.SLi18n;
  var UI = window.SLUI;
  var Scan = window.SLScan;
  var root = document.querySelector("[data-demo]");
  if (!Inv || !Store || !SL || !I18n || !UI || !root) return;
  var t = I18n.t, tn = I18n.tn;

  var reduced = SL.reduced;
  var EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
  var today = new Date();
  function addDays(n) { var d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d.setDate(d.getDate() + n); return d; }
  var LOC = I18n.locale;
  var fmtShort = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "short" });
  var fmtFull = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "long", year: "numeric" });
  var fmtTime = new Intl.DateTimeFormat(LOC, { hour: "2-digit", minute: "2-digit" });
  var fmtMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
  var fmtAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  var fmtMonth = new Intl.DateTimeFormat(LOC, { month: "long" });
  function money(paise) { return fmtAmount.format(paise / 100); }
  function day(iso) { return fmtShort.format(Inv.parseISO(iso)); }

  var GROUPS = [
    { id: "expired", title: t("Past due"), note: t("Must not be sold"), levels: ["expired"] },
    { id: "soon", title: t("Coming soon"), note: fmtShort.format(today) + " – " + fmtShort.format(addDays(7)), levels: ["critical", "high"] },
    { id: "later", title: t("On the horizon"), note: t("From {date}", { date: fmtShort.format(addDays(8)) }), levels: ["medium", "low", "safe"] },
    { id: "nostock", title: t("No stock"), note: t("Products with no batches on record"), levels: [] }
  ];
  function levelLabel(l) { return t(l.label); }
  var FILTERS = [{ id: "all", label: t("All") }].concat(Inv.LEVELS.map(function (l) { return { id: l.id, label: levelLabel(l) }; }));
  var MEANING = {
    expired: t("The expiry date has passed. It must not be sold and needs immediate review."),
    critical: t("Expires within three days (0–3 days left)."),
    high: t("Expires in four to seven days."),
    medium: t("Expires in eight to fourteen days."),
    low: t("Expires in fifteen to thirty days."),
    safe: t("More than thirty days remain.")
  };

  // ---------- Data ----------
  var data = Store.load(today);         // { products, batches, statuses, writeoffs, customized, notices }
  var dataGen = 0;                      // goes up when all data is replaced (restore, reset), so older undos stop
  if (!data.sales) data.sales = [];
  var productById = {}, batchById = {}, batchesOf = {};
  function reindex() {
    productById = {}; batchById = {}; batchesOf = {};
    data.products.forEach(function (p) { productById[p.id] = p; batchesOf[p.id] = []; });
    data.batches.forEach(function (b) { batchById[b.id] = b; if (batchesOf[b.productId]) batchesOf[b.productId].push(b); });
    // a product's batches, soonest expiry first
    Object.keys(batchesOf).forEach(function (pid) { batchesOf[pid].sort(function (a, b) { return a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : 0; }); });
  }
  reindex();
  // Statuses saved before recommendations existed are adopted by the current recommendation.
  Object.keys(data.statuses).forEach(function (id) {
    var s = data.statuses[id];
    if ("rec" in s) return;
    var rec = recFor(batchById[id]);
    if (s.s === "done" && !rec) delete data.statuses[id];
    else s.rec = rec ? rec.key : null;
  });

  function persist() {
    if (!Store.save(data)) toast(t("Couldn’t save — this browser’s storage is full or blocked. Changes will be lost when you leave."), null);
  }
  function takenIds() {
    var ids = {};
    data.products.forEach(function (p) { ids[p.id] = true; });
    data.batches.forEach(function (b) { ids[b.id] = true; });
    data.writeoffs.forEach(function (w) { ids[w.id] = true; });
    data.sales.forEach(function (s) { ids[s.id] = true; });
    return ids;
  }

  var state = { filter: "all", query: "", openId: null, mode: null };   // mode: { row, kind }

  var $ = function (sel) { return document.querySelector(sel); };
  var groupsEl = $("[data-groups]");
  var emptyEl = $("[data-empty]");
  var filtersEl = $("[data-filters]");
  var searchEl = $("[data-search]");
  var pop = $("[data-pop]");
  var addBtn = $("[data-add]");
  var adder = $("[data-adder]");
  var adderBody = $("[data-adder-body]");

  // ---------- Helpers ----------
  var esc = UI.esc, enter = UI.enter, tween = UI.tween;
  function countdown(days) {
    if (days < 0) return tn(-days, "{n} day overdue", "{n} days overdue");
    if (days === 0) return t("Expires today");
    if (days === 1) return t("Tomorrow");
    if (days > 60) return t("In about {n} months", { n: Math.round(days / 30) });
    return t("In {n} days", { n: days });
  }
  function unitOf(p) { return Store.unitOf(p ? p.unit : "pcs"); }
  function amount(qty, p) { return Store.amount(qty, p ? p.unit : "pcs"); }
  function perUnit(unitId) { return t("per {unit}", { unit: t(Store.unitOf(unitId).per) }); }
  function recFor(b) {
    if (!b) return null;
    var p = productById[b.productId];
    return Inv.recommend({ qty: b.qty, category: p ? p.category : "Other", batch: b.lot,
      amount: amount(b.qty, p), size: b.qty * unitOf(p).size }, Inv.daysUntil(b.expires, today));
  }
  function lotLabel(b) { return b.lot ? t("Batch {lot}", { lot: b.lot }) : t("No batch number"); }
  function productQty(pid) { return Store.round3((batchesOf[pid] || []).reduce(function (n, b) { return n + b.qty; }, 0)); }

  // Everything about a batch row is derived here: risk from its date, the recommendation from
  // its risk + details, and its status — which only counts if it belongs to *this* recommendation.
  function info(b) {
    var p = productById[b.productId];
    var days = Inv.daysUntil(b.expires, today);
    var rec = recFor(b);
    var st = data.statuses[b.id];
    // a "done" mark needs a recommendation to belong to; without one it no longer applies
    var current = st && st.rec === (rec ? rec.key : null) && (st.s !== "done" || !!rec);
    return { key: b.id, b: b, p: p, days: days, level: Inv.classify(days), rec: rec,
      status: current ? st.s : "open", at: current ? st.at : null, stale: !!st && !current };
  }
  function allInfo() { return data.batches.map(info); }
  function noStockProducts() { return data.products.filter(function (p) { return !batchesOf[p.id].length; }); }

  function matchesQuery(p, b) {
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var digits = q.replace(/[\s-]/g, "");
    return p.name.toLowerCase().indexOf(q) !== -1 || (p.barcode && /^\d+$/.test(digits) && p.barcode.indexOf(digits) !== -1) || (b && ((b.lot && b.lot.toLowerCase().indexOf(q) !== -1) || (b.supplier && b.supplier.toLowerCase().indexOf(q) !== -1)));
  }
  function matches(it) { return matchesQuery(it.p, it.b) && (state.filter === "all" || it.level.id === state.filter); }

  function plain(it) {
    var d = it.days;
    switch (it.level.id) {
      case "expired": return tn(-d, "Do not sell. This batch’s date passed {n} day ago, so it needs to come off the shelf today.", "Do not sell. This batch’s date passed {n} days ago, so it needs to come off the shelf today.");
      case "critical": return d === 0 ? t("This batch expires today. With three days or fewer left, it needs action now.") :
        tn(d, "This batch expires in {n} day. With three days or fewer left, it needs action now.", "This batch expires in {n} days. With three days or fewer left, it needs action now.");
      case "high": return t("This batch expires in {n} days. Act this week, while it can still sell at a small markdown.", { n: d });
      case "medium": return t("This batch expires in {n} days. No action yet — just keep older batches at the front.", { n: d });
      case "low": return t("This batch expires in {n} days. Nothing to do yet.", { n: d });
      default: return t("This batch has more than a month left. Nothing to do.");
    }
  }
  // ---------- Motion helpers (every one does nothing when the user prefers reduced motion) ----------
  // enter() and tween() are shared with the other pages (ui.js).
  // leave(): a row fades, then folds shut; commit() makes the real change afterwards.
  // If it's the last row of its group, the whole group folds away with it.
  function leave(li, commit) {
    if (!li || li.getAttribute("data-leaving")) return;
    if (reduced || !li.animate) { commit(); return; }
    li.setAttribute("data-leaving", "1");
    var group = li.closest(".group");
    var visible = Array.prototype.filter.call(group.querySelectorAll("[data-entry]"), function (x) { return !x.hidden; });
    var el = visible.length === 1 ? group : li;
    var h = el.offsetHeight;
    el.style.overflow = "hidden";
    li.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(36px)" }], { duration: 220, easing: "ease-in", fill: "forwards" });
    var fold = el.animate([
      { height: h + "px", marginTop: getComputedStyle(el).marginTop },
      { height: h + "px", offset: 0.4 },
      { height: "0px", marginTop: "0px", paddingTop: "0px", paddingBottom: "0px" }
    ], { duration: 520, easing: EASE });
    fold.onfinish = function () {
      commit();
      // the row is normally gone now; if it's still on the page, put it back as it was
      el.getAnimations().concat(li.getAnimations()).forEach(function (a) { a.cancel(); });
      el.style.overflow = "";
      li.removeAttribute("data-leaving");
    };
  }
  // revealPanel(): bring an opened panel into view below the sticky search bar.
  function revealPanel(body) {
    var ctl = document.querySelector(".controls");
    body.style.scrollMarginTop = ((ctl ? ctl.offsetHeight : 0) + 16) + "px";
    body.style.scrollMarginBottom = "24px";
    setTimeout(function () { body.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); }, reduced ? 0 : 420);
  }

  var INFO_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.25" /><path d="M10 9v5M10 6.2v.1" /></svg>';
  var SCAN_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6V3.5h2.5M15 3.5h2.5V6M17.5 14v2.5H15M5 16.5H2.5V14M6 7v6M8.5 7v6M11 7v6M14 7v6" /></svg>';
  var CHECK = '<svg class="entry__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>';

  // ---------- Opening: the date stamp ----------
  (function stamp() {
    var el = $("[data-stamp]");
    var days = [];
    for (var i = -6; i <= 0; i++) days.push(addDays(i));
    $("[data-roll]").innerHTML = days.map(function (d) {
      return "<span>" + d.getDate() + " " + d.toLocaleString(LOC, { month: "short" }).toUpperCase() + "</span>";
    }).join("");
    $("[data-year]").textContent = today.getFullYear();
    el.style.setProperty("--steps", days.length - 1);
    el.setAttribute("aria-label", t("Checked against today, {date}", { date: fmtFull.format(today) }));
    SL.whenLoaded(function () { el.classList.add("is-on"); });
    // on wide screens the stamp drifts a little slower than the page as you scroll
    var wide = window.matchMedia("(min-width: 641px)");
    if (!reduced) SL.onScroll(function () { el.style.setProperty("--sy", wide.matches ? Math.min(window.scrollY, 600) * 0.12 + "px" : "0px"); });
  })();

  // ---------- Filter tabs ----------
  filtersEl.innerHTML = FILTERS.map(function (f) {
    return '<button type="button" class="tab" data-filter="' + f.id + '" aria-pressed="false">' + f.label + "</button>";
  }).join("") + '<span class="tabs__bar no-anim" aria-hidden="true"></span>';
  var tabsBar = filtersEl.querySelector(".tabs__bar");
  // phones: the strip's edge fade goes once it's scrolled to the end, so the last tab isn't hidden
  function tabsEnd() { filtersEl.classList.toggle("is-end", filtersEl.scrollLeft + filtersEl.clientWidth >= filtersEl.scrollWidth - 2); }
  filtersEl.addEventListener("scroll", tabsEnd, { passive: true });
  window.addEventListener("resize", tabsEnd);
  function renderFilters() {
    tabsEnd();
    filtersEl.querySelectorAll("[data-filter]").forEach(function (b) {
      var on = b.getAttribute("data-filter") === state.filter;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    placeBar();
  }
  function placeBar() {
    var a = filtersEl.querySelector(".is-active");
    if (!a) return;
    tabsBar.style.width = a.offsetWidth + "px";
    tabsBar.style.transform = "translateX(" + a.offsetLeft + "px)";
  }
  window.addEventListener("resize", function () { tabsBar.classList.add("no-anim"); placeBar(); requestAnimationFrame(function () { tabsBar.classList.remove("no-anim"); }); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeBar);

  // ---------- Forms (product and/or batch fields) ----------
  // opts: { product: {name, category, unit, barcode} | true | false, batch: {...} | true | false,
  //         unit: the unit of the batch's product (when the form has no product fields), submit }
  function formHTML(prefix, opts) {
    var p = typeof opts.product === "object" ? opts.product : {};
    var b = typeof opts.batch === "object" ? opts.batch : {};
    var L = Store.LIMITS;
    var u = Store.unitOf(opts.product ? p.unit : opts.unit);
    function field(name, label, control, hint) {
      var id = prefix + "-" + name;
      return '<div class="pform__field pform__field--' + name + '">' +
        '<label for="' + id + '">' + label + (hint ? ' <span class="pform__hint">' + hint + "</span>" : "") + "</label>" +
        control.replace("%A%", 'id="' + id + '" aria-describedby="' + id + '-msg"') +
        '<p class="pform__msg" id="' + id + '-msg"></p></div>';
    }
    var optional = t("optional");
    var html = '<form class="pform" data-form="' + prefix + '" novalidate>';
    if (opts.product) {
      var cats = '<option value="">' + t("Choose…") + "</option>" + Store.CATEGORIES.map(function (c) {
        return '<option value="' + c + '"' + (p.category === c ? " selected" : "") + ">" + t(c) + "</option>";
      }).join("");
      var units = Store.UNITS.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === u.id ? " selected" : "") + ">" + t(x.label) + "</option>";
      }).join("");
      html += field("name", t("Product name"), '<input %A% name="name" type="text" maxlength="' + L.name + '" autocomplete="off" required value="' + esc(p.name || "") + '">') +
        field("category", t("Category"), '<select %A% name="category" required>' + cats + "</select>") +
        field("unit", t("Counted in"), '<select %A% name="unit">' + units + "</select>") +
        field("barcode", t("Barcode"), '<span class="pform__with"><input %A% name="barcode" type="text" inputmode="numeric" maxlength="20" autocomplete="off" value="' + esc(p.barcode || "") + '">' +
          (Scan && Scan.available() ? '<button type="button" class="info" data-scan-field aria-label="' + t("Scan the barcode with the camera") + '">' + SCAN_ICON + "</button>" : "") + "</span>", optional);
    }
    if (opts.batch) {
      var minD = Inv.toISO(new Date(today.getFullYear() - L.pastYears, today.getMonth(), today.getDate()));
      var maxD = Inv.toISO(new Date(today.getFullYear() + L.futureYears, today.getMonth(), today.getDate()));
      if (opts.product) html += '<p class="pform__section">' + t("First batch") + "</p>";
      html += field("qty", t("Quantity"), '<input %A% name="qty" type="number" ' + qtyAttrs(u) + ' max="' + L.qty + '" required value="' + (b.qty || "") + '">',
          '<span data-unit-many>' + t(u.many) + "</span>") +
        field("expires", t("Expiry date"), '<input %A% name="expires" type="date" min="' + minD + '" max="' + maxD + '" required value="' + (b.expires || "") + '">') +
        field("lot", t("Batch number"), '<input %A% name="lot" type="text" maxlength="' + L.lot + '" autocomplete="off" value="' + esc(b.lot || "") + '">', optional) +
        field("supplier", t("Supplier"), '<input %A% name="supplier" type="text" maxlength="' + L.supplier + '" autocomplete="off" value="' + esc(b.supplier || "") + '">', optional) +
        field("cost", '<span data-unit-cost>' + t("Cost per {unit}", { unit: t(u.per) }) + "</span>", '<input %A% name="cost" type="text" inputmode="decimal" autocomplete="off" placeholder="₹" value="' + (b.unitCost === null || b.unitCost === undefined ? "" : b.unitCost) + '">', t("optional, ₹")) +
        field("price", '<span data-unit-price>' + t("Selling price per {unit}", { unit: t(u.per) }) + "</span>", '<input %A% name="price" type="text" inputmode="decimal" autocomplete="off" placeholder="₹" value="' + (b.price === null || b.price === undefined ? "" : b.price) + '">', t("optional, ₹")) +
        field("received", t("Date received"), '<input %A% name="received" type="date" min="' + minD + '" max="' + Inv.toISO(today) + '" value="' + (b.received || "") + '">', optional) +
        // Many packs print only "Mfd. on" + "Best before N months from manufacture": work the date out
        '<div class="pform__mfg" data-mfg>' +
          '<button type="button" class="detail__link" data-mfg-toggle aria-expanded="false" aria-controls="' + prefix + '-mfg">' + t("Pack shows only a manufacture date?") + "</button>" +
          '<div class="pform__mfg-body" id="' + prefix + '-mfg" hidden>' +
            "<label>" + t("Manufactured on") + ' <input type="date" data-mfg-made min="' + minD + '" max="' + Inv.toISO(today) + '"></label>' +
            '<span class="pform__mfg-life"><label>' + t("Best before") + ' <input type="number" inputmode="numeric" min="1" max="3650" step="1" data-mfg-n></label>' +
            '<label><span class="sr-only">' + t("Months or days") + '</span><select data-mfg-unit><option value="months">' + t("months") + '</option><option value="days">' + t("days") + "</option></select></label></span>" +
            '<p class="pform__mfg-msg" aria-live="polite" data-mfg-msg>' + t("The expiry date is filled in for you.") + "</p>" +
          "</div></div>";
    }
    return html + '<div class="pform__actions">' +
      '<button type="submit" class="btn btn--primary btn--sm">' + opts.submit + "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-form-cancel>' + t("Cancel") + "</button></div></form>";
  }
  // Whole-number units step by 1; kg and litres take decimals like 2.5
  function qtyAttrs(u) { return u.whole ? 'inputmode="numeric" min="1" step="1"' : 'inputmode="decimal" min="0.001" step="any"'; }

  // Changing a new product's unit updates the batch fields next to it.
  document.addEventListener("change", function (e) {
    if (!e.target.matches || !e.target.matches('.pform select[name="unit"]')) return;
    var form = e.target.form;
    var u = Store.unitOf(e.target.value);
    var many = form.querySelector("[data-unit-many]");
    if (many) many.textContent = t(u.many);
    var cost = form.querySelector("[data-unit-cost]");
    if (cost) cost.textContent = t("Cost per {unit}", { unit: t(u.per) });
    var price = form.querySelector("[data-unit-price]");
    if (price) price.textContent = t("Selling price per {unit}", { unit: t(u.per) });
    var q = form.elements.qty;
    if (q) {
      q.setAttribute("inputmode", u.whole ? "numeric" : "decimal");
      q.setAttribute("min", u.whole ? "1" : "0.001");
      q.setAttribute("step", u.whole ? "1" : "any");
    }
  });

  function readForm(form) {
    var f = form.elements;
    function v(n) { return f[n] ? f[n].value : ""; }
    function bad(n) { return !!(f[n] && f[n].validity && f[n].validity.badInput); }
    return { name: v("name"), category: v("category"), unit: v("unit"), barcode: v("barcode"), lot: v("lot"), qty: v("qty"), qtyBad: bad("qty"),
      expires: v("expires"), expiresBad: bad("expires"), supplier: v("supplier"), cost: v("cost"), price: v("price"),
      received: v("received"), receivedBad: bad("received") };
  }

  function showErrors(form, errors) {
    var first = null;
    Array.prototype.forEach.call(form.querySelectorAll(".pform__field"), function (fieldEl) {
      var input = fieldEl.querySelector("input, select");
      var msg = fieldEl.querySelector(".pform__msg");
      var bad = !!errors[input.name];
      input.setAttribute("aria-invalid", String(bad));
      msg.textContent = errors[input.name] || "";
      fieldEl.classList.toggle("is-invalid", bad);
      if (bad && !first) first = input;
    });
    if (first) first.focus();
  }
  function clearFieldError(e) {
    var input = e.target;
    if (!input.form || !input.form.matches(".pform") || input.getAttribute("aria-invalid") !== "true") return;
    input.setAttribute("aria-invalid", "false");
    input.closest(".pform__field").classList.remove("is-invalid");
    input.form.querySelector("#" + input.id + "-msg").textContent = "";
  }
  document.addEventListener("input", clearFieldError);
  document.addEventListener("change", clearFieldError);
  // the "Sold some?" box: Enter records the amount typed; typing clears an old message
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !e.target.matches || !e.target.matches("[data-sell-input]")) return;
    e.preventDefault();
    var li = e.target.closest("[data-entry]");
    if (li) sell(li.getAttribute("data-entry"), e.target.value);
  });
  document.addEventListener("input", function (e) {
    if (!e.target.matches || !e.target.matches("[data-sell-input]")) return;
    var msg = e.target.closest("[data-sell-box]").querySelector("[data-sell-msg]");
    if (msg) msg.textContent = "";
  });

  // ---------- Expiry from a manufacture date ("Best before 6 months from manufacture") ----------
  function addMonthsISO(iso, n) {
    var d = Inv.parseISO(iso);
    var x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));   // 31 Aug + 6 months → 28 Feb
    return Inv.toISO(x);
  }
  function addDaysISO(iso, n) { var d = Inv.parseISO(iso); d.setDate(d.getDate() + n); return Inv.toISO(d); }
  function updateMfg(box) {
    var form = box.closest("form");
    var made = box.querySelector("[data-mfg-made]");
    var n = box.querySelector("[data-mfg-n]").value.trim();
    var unit = box.querySelector("[data-mfg-unit]").value;
    var msg = box.querySelector("[data-mfg-msg]");
    var max = unit === "months" ? 120 : 3650;
    var problem = null;
    if (made.validity.badInput) problem = t("That manufacture date isn’t complete.");
    else if (!made.value || !n) { msg.textContent = t("The expiry date is filled in for you."); msg.classList.remove("is-problem"); return; }
    else if (!Store.validISO(made.value)) problem = t("That isn’t a real date.");
    else if (made.value > Inv.toISO(today)) problem = t("The manufacture date can’t be in the future.");
    else if (!/^\d+$/.test(n) || +n < 1 || +n > max) problem = unit === "months" ? t("Use a whole number of months, from 1 to 120.") : t("Use a whole number of days, from 1 to 3650.");
    msg.classList.toggle("is-problem", !!problem);
    if (problem) { msg.textContent = problem; return; }
    var iso = unit === "months" ? addMonthsISO(made.value, +n) : addDaysISO(made.value, +n);
    form.elements.expires.value = iso;
    form.elements.expires.dispatchEvent(new Event("input", { bubbles: true }));      // clears an earlier error
    var date = fmtFull.format(Inv.parseISO(iso));
    msg.textContent = iso < Inv.toISO(today) ? t("Expiry date set to {date} — already past.", { date: date }) : t("Expiry date set to {date}.", { date: date });
  }
  function onMfgInput(e) {
    var box = e.target.closest && e.target.closest("[data-mfg]");
    if (box && e.target.matches("input, select")) updateMfg(box);
  }
  document.addEventListener("input", onMfgInput);
  document.addEventListener("change", onMfgInput);
  document.addEventListener("click", function (e) {
    var toggle = e.target.closest("[data-mfg-toggle]");
    if (toggle) {
      var body = document.getElementById(toggle.getAttribute("aria-controls"));
      var open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) body.querySelector("input").focus({ preventScroll: true });
      return;
    }
    var s = e.target.closest("[data-scan-field]");
    if (s && Scan) {
      var input = s.parentNode.querySelector("input");
      Scan.open(function (code) {
        input.value = code;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus({ preventScroll: true });
      }, s);
    }
  });
  function merge(a, b) { var o = {}; [a, b].forEach(function (x) { if (x) Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return o; }

  // ---------- Add a new product (with its first batch) ----------
  function openAdder(prefill) {
    closePop();
    if (state.openId) closeDetail();
    adderBody.innerHTML = '<h3 class="adder__title" id="adder-title">' + t("Add a product") + "</h3>" + formHTML("add", { product: prefill || true, batch: true, submit: t("Add product") });
    adder.removeAttribute("inert");
    adder.classList.add("is-open");
    addBtn.setAttribute("aria-expanded", "true");
    enter(adderBody, ":scope > :not(form), :scope > form > *");
    adderBody.querySelector("input").focus({ preventScroll: true });
    revealPanel(adderBody);
  }
  function closeAdder(focusButton) {
    if (!adder.classList.contains("is-open")) return;
    adder.classList.remove("is-open");
    adder.setAttribute("inert", "");
    addBtn.setAttribute("aria-expanded", "false");
    if (focusButton) addBtn.focus({ preventScroll: true });
  }
  addBtn.addEventListener("click", function () { if (adder.classList.contains("is-open")) closeAdder(true); else openAdder(); });

  // ---------- Barcodes: a scan (USB scanner, camera, or typed + Enter) opens the product ----------
  function barcodeIn(s) {
    var code = String(s || "").replace(/[\s-]/g, "");
    return Store.validGTIN(code) ? code : null;
  }
  function openByBarcode(code) {
    clearTimeout(searchTimer);           // a search still waiting to run would redraw the row we open
    closePop();
    closeAdder(false);
    var p = Store.findProductByBarcode(data.products, code);
    if (!p) {
      // unknown: show it in the search, where the empty state offers to add it
      if (state.openId) closeDetail();
      state.query = code; state.filter = "all"; searchEl.value = code;
      applyChange();
      var add = emptyEl.querySelector("[data-empty-add-code]");
      if (add) add.focus({ preventScroll: true });
      return;
    }
    state.query = ""; state.filter = "all"; searchEl.value = "";
    render();
    var key = batchesOf[p.id].length ? batchesOf[p.id][0].id : "nostock-" + p.id;
    goToRow(key);
    // a scan usually means a delivery: put the keyboard on "Add a batch"
    var addLink = rowEls[key].querySelector('[data-mode="add-batch"]');
    if (addLink) addLink.focus({ preventScroll: true });
    confirmRow(key);
    toast(batchesOf[p.id].length ? t("Scanned {name} — {amount} in stock", { name: p.name, amount: amount(productQty(p.id), p) }) :
      t("Scanned {name} — no stock on record", { name: p.name }), null);
  }
  searchEl.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var code = barcodeIn(searchEl.value);
    if (code) { e.preventDefault(); openByBarcode(code); }
  });
  // A USB scanner types the digits very fast and presses Enter. Caught anywhere outside a text field.
  var scanKeys = "", scanLast = 0;
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) { scanKeys = ""; return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var now = Date.now();
    if (now - scanLast > 80) scanKeys = "";          // people type slower than this; scanners don't
    scanLast = now;
    if (/^\d$/.test(e.key)) scanKeys += e.key;
    else if (e.key === "Enter" && scanKeys.length >= 8) {
      var code = barcodeIn(scanKeys);
      scanKeys = "";
      if (code) { e.preventDefault(); openByBarcode(code); }
    } else scanKeys = "";
  });
  var scanSearchBtn = $("[data-scan-search]");
  if (Scan && Scan.available()) {
    scanSearchBtn.hidden = false;
    scanSearchBtn.addEventListener("click", function () { Scan.open(openByBarcode, scanSearchBtn); });
  }
  adder.addEventListener("click", function (e) { if (e.target.closest("[data-form-cancel]")) closeAdder(true); });
  adder.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = readForm(e.target);
    var rp = Store.validateProduct(raw, { products: data.products });
    var rb = Store.validateBatch(raw, { batches: data.batches, productId: null, today: today, unit: raw.unit });
    if (rp.errors || rb.errors) { showErrors(e.target, merge(rp.errors, rb.errors)); return; }
    var taken = takenIds();
    var p = { id: Store.newId("p", taken), name: rp.values.name, category: rp.values.category, unit: rp.values.unit, barcode: rp.values.barcode };
    taken[p.id] = true;
    var b = merge({ id: Store.newId("b", taken), productId: p.id }, rb.values);
    data.products.push(p);
    data.batches.push(b);
    data.customized = true;
    reindex();
    persist();
    closeAdder(false);
    showRowIfHidden(info(b));
    render();
    revealRow(b.id, 460);
    toast(t("Added {name} — {level}", { name: p.name, level: levelLabel(info(b).level).toLowerCase() }), null);
  });

  // Import, export, backup, restore and reset live on the Settings page (settings.js).
  var Csv = window.SLCsv;
  function csvName(kind) { return "shelflife-" + kind + "-" + Inv.toISO(today) + ".csv"; }

  // ---------- Groups and rows ----------
  var groupEls = {};
  var rowEls = {};

  groupsEl.innerHTML = GROUPS.map(function (g) {
    return '<section class="group group--' + g.id + '" data-group="' + g.id + '" aria-labelledby="g-' + g.id + '">' +
      '<header class="group__head"><h3 class="group__title" id="g-' + g.id + '">' + g.title + '</h3><p class="group__note">' + g.note + "</p></header>" +
      '<ol class="entries" data-entries></ol></section>';
  }).join("");
  GROUPS.forEach(function (g) { groupEls[g.id] = groupsEl.querySelector('[data-group="' + g.id + '"]'); });

  function buildRow(key) {
    var li = document.createElement("li");
    li.setAttribute("data-entry", key);
    li.innerHTML =
      '<div class="entry__row">' +
        '<div class="entry__what">' +
          '<button type="button" class="entry__name" aria-expanded="false" aria-controls="d-' + key + '"><span class="entry__name-text"></span>' + CHECK + "</button>" +
          '<span class="entry__cat"></span><span class="entry__note"></span>' +
        "</div>" +
        '<div class="entry__when"><span class="entry__date"></span><span class="entry__count"></span><span class="entry__fuse" aria-hidden="true"><i></i></span></div>' +
        '<div class="entry__qty"></div>' +
        '<div class="entry__status"></div>' +
        '<button type="button" class="info entry__info" aria-expanded="false" aria-controls="d-' + key + '">' + INFO_ICON + "</button>" +
      "</div>" +
      '<div class="entry__drawer" id="d-' + key + '" role="region" inert><div class="entry__drawer-inner"><div class="detail" data-detail></div></div></div>';
    return li;
  }

  // The product block inside an open row: its batches (soonest expiry first) and product actions.
  function stockHTML(p, currentBatchId) {
    var list = batchesOf[p.id];
    var total = productQty(p.id);
    var items = list.map(function (b, i) {
      var bits = [amount(b.qty, p), t("expires {date}", { date: day(b.expires) })];
      if (b.supplier) bits.push(b.supplier);
      bits.push(b.unitCost === null ? t("cost not recorded") : fmtMoney.format(b.unitCost) + " " + perUnit(p.unit));
      if (b.price !== null && b.price !== undefined) bits.push(t("sells at {price}", { price: fmtMoney.format(b.price) }));
      if (b.received) bits.push(t("received {date}", { date: day(b.received) }));
      var me = b.id === currentBatchId;
      return '<li class="stock__item' + (me ? " is-this" : "") + '" style="--si:' + Math.min(i, 8) + '">' +
        (me ? '<span class="stock__lot">' + esc(lotLabel(b)) + " <em>" + t("this batch") + "</em></span>"
            : '<button type="button" class="stock__lot stock__go" data-go="' + b.id + '">' + esc(lotLabel(b)) + "</button>") +
        '<span class="stock__facts">' + esc(bits.join(" · ")) + "</span></li>";
    }).join("");
    var facts = [t(p.category)];
    if (p.barcode) facts.push(t("barcode {code}", { code: p.barcode }));
    facts.push(list.length ? t("{amount} in {batches}", { amount: amount(total, p), batches: tn(list.length, "{n} batch", "{n} batches") }) : t("no stock on record"));
    return '<section class="stock" aria-label="' + esc(t("{name} stock", { name: p.name })) + '">' +
      '<div class="stock__head"><p><b>' + esc(p.name) + "</b> · " + esc(facts.join(" · ")) + "</p>" +
        '<span class="detail__manage"><button type="button" class="detail__link" data-mode="edit-product">' + t("Edit product") + "</button>" +
        '<button type="button" class="detail__link" data-mode="delete-product">' + t("Delete product") + "</button></span></div>" +
      (items ? '<ol class="stock__list">' + items + "</ol>" : "") +
      '<button type="button" class="detail__link stock__add" data-mode="add-batch">' + t("Add a batch") + "</button></section>";
  }

  function confirmHTML(id, title, body, yes) {
    return '<div class="confirm" role="alertdialog" aria-labelledby="c-' + id + '" aria-describedby="cd-' + id + '">' +
      '<p class="confirm__title" id="c-' + id + '">' + title + "</p>" +
      '<p class="confirm__text" id="cd-' + id + '">' + body + "</p>" +
      '<div class="detail__actions"><button type="button" class="btn btn--ink btn--sm" data-confirm-yes>' + yes + "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-confirm-no>' + t("Keep it") + "</button></div></div>";
  }

  // What an open row shows, depending on its mode.
  function detailHTML(row) {
    var mode = state.mode && state.mode.row === row.key ? state.mode.kind : null;
    var p = row.p;
    var name = esc(p.name);
    if (mode === "edit-product") return '<h4 class="detail__title">' + t("Edit product") + "</h4>" + formHTML("ep-" + row.key, { product: p, submit: t("Save product") });
    if (mode === "add-batch") return '<h4 class="detail__title">' + t("Add a batch of {name}", { name: name }) + "</h4>" + formHTML("ab-" + row.key, { batch: true, unit: p.unit, submit: t("Add batch") });
    if (mode === "delete-product") {
      var n = batchesOf[p.id].length;
      return confirmHTML(row.key, t("Delete {name}?", { name: name }),
        n ? t("Its {batches} ({amount}) and their review statuses will be removed too.", { batches: tn(n, "{n} batch", "{n} batches"), amount: esc(amount(productQty(p.id), p)) }) : t("It has no stock on record."),
        t("Delete product"));
    }
    if (!row.b) {   // a product with no batches
      return '<p class="detail__plain">' + t("There’s no stock of {name} on record.", { name: name }) + "</p>" +
        '<p class="detail__next"><span>' + t("Next step") + "</span>" + t("Add a batch when a delivery arrives, or delete the product if you no longer stock it.") + "</p>" +
        '<div class="detail__actions"><button type="button" class="btn btn--primary btn--sm" data-mode="add-batch">' + t("Add a batch") + "</button>" +
        '<span class="detail__manage"><button type="button" class="detail__link" data-mode="edit-product">' + t("Edit product") + "</button>" +
        '<button type="button" class="detail__link" data-mode="delete-product">' + t("Delete product") + "</button>" +
        '<button type="button" class="detail__link" data-close>' + t("Close") + "</button></span></div>";
    }
    var b = row.b;
    var lot = esc(b.lot);
    if (mode === "edit-batch") {
      return '<h4 class="detail__title">' + (b.lot ? t("Edit batch {lot} of {name}", { lot: lot, name: name }) : t("Edit this batch of {name}", { name: name })) + "</h4>" +
        formHTML("eb-" + row.key, { batch: b, unit: p.unit, submit: t("Save batch") });
    }
    if (mode === "delete-batch") {
      var only = batchesOf[p.id].length === 1;
      return confirmHTML(row.key, b.lot ? t("Delete batch {lot} of {name}?", { lot: lot, name: name }) : t("Delete this batch of {name}?", { name: name }),
        t("Its {amount} and review status will be removed.", { amount: esc(amount(b.qty, p)) }) + " " +
        (only ? t("It’s the only batch, so the product will stay listed under No stock.") : t("The product and its other batches stay.")),
        t("Delete batch"));
    }
    var rec = row.rec;
    var buttons = "";
    var expired = row.level.id === "expired";
    if (expired) {
      // expired stock leaves the shelf one of two ways; either is recorded under Written off
      buttons += '<button type="button" class="btn btn--primary btn--sm" data-writeoff="waste">' + t("Thrown away") + "</button>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-writeoff="return">' + t("Returned to supplier") + "</button>";
    } else {
      if (rec && row.status !== "done") buttons += '<button type="button" class="btn btn--primary btn--sm" data-act="done">' + rec.done + "</button>";
      if (row.status === "open") buttons += '<button type="button" class="btn btn--ghost btn--sm" data-act="reviewed">' + t("Mark as reviewed") + "</button>";
    }
    if (row.status !== "open") buttons += '<button type="button" class="btn btn--ghost btn--sm" data-act="open">' + t("Reopen") + "</button>";
    var next = rec ?
      '<p class="detail__next"><span>' + (row.status === "done" ? t("Done: {title}", { title: esc(rec.title) }) : t("Recommended: {title}", { title: esc(rec.title) })) + "</span>" + esc(rec.text) + "</p>" :
      '<p class="detail__next"><span>' + t("No action needed") + "</span>" + esc(Inv.noActionReason(p, row.days)) + "</p>";
    var time = row.status === "open" ? "" : fmtTime.format(new Date(row.at));
    return (
      '<p class="detail__plain">' + plain(row) + "</p>" + next + priceGuideHTML(b, p, rec) +
      (row.status === "open" ? "" : '<p class="detail__status">' + (row.status === "done" ?
        t("{state} at {time}", { state: esc(rec.doneState), time: time }) : t("Reviewed at {time}", { time: time })) + "</p>") +
      (expired ? '<p class="detail__hint">' + (b.unitCost === null ?
        t("Once it’s off the shelf, record what happened to it. The batch leaves the list and is added under Written off (no cost recorded).") :
        t("Once it’s off the shelf, record what happened to it. The batch leaves the list and its value ({value}) is added under Written off.", { value: money(Store.valuePaise(b.qty, b.unitCost)) })) + "</p>" : "") +
      (expired ? "" : sellHTML(row)) +
      '<div class="detail__actions">' + buttons +
        '<span class="detail__manage"><button type="button" class="detail__link" data-mode="edit-batch">' + t("Edit batch") + "</button>" +
        '<button type="button" class="detail__link" data-mode="delete-batch">' + t("Delete batch") + "</button>" +
        '<button type="button" class="detail__link" data-close>' + t("Close") + "</button></span></div>" +
      stockHTML(p, b.id)
    );
  }

  // ---------- Price guide: what a suggested markdown means in rupees ----------
  // Only for recommendations that name a discount, and only when the batch has a selling price.
  var MARKDOWNS = { "critical-last-day": [50], "critical-markdown": [30, 50], "critical-front": [30], "high-markdown-plan": [15, 20] };
  function priceGuideHTML(b, p, rec) {
    var cuts = rec && MARKDOWNS[rec.key];
    if (!cuts || b.price === null || b.price === undefined) return "";
    var hasCost = b.unitCost !== null && b.unitCost !== undefined;
    var below = false;
    var rows = cuts.map(function (pct) {
      var at = Math.round(b.price * (100 - pct) / 100);           // shops price in whole rupees
      var vs = "";
      if (hasCost) {
        var diff = Math.round((at - b.unitCost) * 100) / 100;
        if (diff < 0) below = true;
        vs = diff >= 0 ? '<span class="pricing__vs">' + t("{value} over cost", { value: fmtMoney.format(diff) }) + "</span>"
          : '<span class="pricing__vs is-below">' + t("{value} under cost", { value: fmtMoney.format(-diff) }) + "</span>";
      }
      return "<li><b>" + t("{pct}% off", { pct: pct }) + "</b><span class=\"pricing__at\">" + t("{price} {per}", { price: fmtAmount.format(at), per: perUnit(p.unit) }) + "</span>" + vs + "</li>";
    }).join("");
    return '<div class="pricing"><p class="pricing__title">' + t("Price guide") + ' <span>' + t("now {price} {per}", { price: fmtMoney.format(b.price), per: perUnit(p.unit) }) + "</span></p>" +
      '<ul class="pricing__list">' + rows + "</ul>" +
      (below ? '<p class="pricing__note">' + t("Selling under cost still loses less than throwing it away — that loses the whole {cost} {per}.", { cost: fmtMoney.format(b.unitCost), per: perUnit(p.unit) }) + "</p>" : "") +
      "</div>";
  }

  // ---------- Selling: keep the shelf's numbers true ----------
  function sellHTML(row) {
    var u = unitOf(row.p);
    var quick = u.whole ? [1, 5] : [0.5, 1];
    var chips = quick.filter(function (n) { return n < row.b.qty; }).map(function (n) {
      return '<button type="button" class="chip" data-sell="' + n + '">' + esc(amount(n, row.p)) + "</button>";
    }).join("");
    var id = "sell-" + row.key;
    return '<div class="sell" data-sell-box><span class="sell__label">' + t("Sold some?") + "</span>" + chips +
      '<span class="sell__other"><label class="sr-only" for="' + id + '">' + t("How much was sold") + "</label>" +
      '<input id="' + id + '" type="text" inputmode="' + (u.whole ? "numeric" : "decimal") + '" autocomplete="off" placeholder="' + t("Other") + '" data-sell-input>' +
      '<button type="button" class="chip" data-sell-other>' + t("Record") + "</button></span>" +
      '<button type="button" class="chip chip--all" data-sell="all">' + t("All of it") + "</button>" +
      '<p class="sell__msg" role="alert" data-sell-msg></p></div>';
  }
  function sell(key, raw) {
    var b = batchById[key];
    if (!b) return;
    var row = info(b);
    var li = rowEls[key];
    if (!li || li.getAttribute("data-leaving")) return;          // the row is already folding away: its change wins
    if (row.level.id === "expired") return;                      // expired stock is never sold
    var v = Store.validateSale(raw === "all" ? b.qty : raw, b, row.p.unit);
    if (v.error) {
      var msg = li.querySelector("[data-sell-msg]");
      msg.textContent = v.error;
      li.querySelector("[data-sell-input]").focus();
      return;
    }
    var soldOut = v.qty === b.qty;
    var nextKey = soldOut ? nextVisibleKey(key) : null;          // where keyboard focus goes once the row is gone
    var commit = function () {
      if (data.batches.indexOf(b) === -1) return;                // gone meanwhile
      var qty = soldOut ? b.qty : v.qty;                         // never more than is actually left
      var sale = { id: Store.newId("s", takenIds()), batchId: b.id, productId: b.productId, name: row.p.name, lot: b.lot, expires: b.expires,
        qty: qty, unit: row.p.unit, unitCost: b.unitCost, price: b.price === undefined ? null : b.price, at: Inv.toISO(today) };
      var index = data.batches.indexOf(b), status = data.statuses[b.id] || null;
      data.sales.push(sale);
      if (soldOut) { data.batches.splice(index, 1); delete data.statuses[b.id]; state.openId = null; state.mode = null; }
      else b.qty = Store.round3(b.qty - qty);
      data.customized = true;
      reindex();
      persist();
      render();
      if (soldOut) {
        var target = nextKey && rowEls[nextKey] ? rowEls[nextKey].querySelector(".entry__name") : addBtn;
        target.focus({ preventScroll: true });
      } else { confirmRow(key); var f = rowEls[key] && rowEls[key].querySelector("[data-sell]"); if (f) f.focus({ preventScroll: true }); }
      var who = row.p.name + (b.lot ? " (" + b.lot + ")" : "");
      var gone = function () { toast(t("That batch is gone now, so the sale stays."), null); };
      var changed = function () { toast(t("This product’s unit or amount changed since the sale, so the sale stays."), null); };
      toast(soldOut ? t("Sold out: {who}", { who: who }) :
        t("Sold {amount} of {who} — {left} left", { amount: amount(qty, row.p), who: who, left: amount(b.qty, row.p) }), function () {
        var i = data.sales.indexOf(sale);
        if (i === -1) return;
        var p = productById[b.productId];
        if (soldOut) {
          if (batchById[b.id] || !p) { gone(); return; }
          if (Store.findDuplicateBatch(data.batches, b.productId, b.lot, b.expires)) { toast(t("That batch is already back on the list, so the sale stays."), null); return; }
          if (!Store.validQty(b.qty, p.unit)) { changed(); return; }
          data.batches.splice(Math.min(index, data.batches.length), 0, b);
          if (status) data.statuses[b.id] = status;
        } else {
          if (!batchById[b.id] || !p) { gone(); return; }
          var back = Store.round3(b.qty + qty);                    // add back just this sale, whatever happened since
          if (!Store.validQty(back, p.unit)) { changed(); return; }
          b.qty = back;
          if (status && !data.statuses[b.id]) data.statuses[b.id] = status;   // a Done/Reviewed mark the sale made stale comes back
        }
        data.sales.splice(i, 1);
        reindex();
        persist();
        render();
        revealRow(b.id);
      });
    };
    if (soldOut) leave(li, commit); else commit();
  }

  function updateRow(li, row) {
    var keep =["is-in", "is-open", "is-confirm", "is-arrived"].filter(function (c) { return li.classList.contains(c); });
    var p = row.p, b = row.b;
    li.className = ["entry", b ? "entry--" + row.level.id : "entry--nostock", row.status === "done" ? "is-done" : "", row.status === "reviewed" ? "is-reviewed" : ""].concat(keep).filter(Boolean).join(" ");
    li.querySelector(".entry__name-text").textContent = p.name;
    var n = batchesOf[p.id].length;
    var cat = [t(p.category)];
    if (b && b.lot) cat.push(t("Batch {lot}", { lot: b.lot }));
    if (b && n > 1) cat.push(t("1 of {n} batches", { n: n }));
    li.querySelector(".entry__cat").textContent = cat.join(" · ");
    li.querySelector(".entry__info").setAttribute("aria-label", b ? t("Why this batch of {name} has its status", { name: p.name }) : t("Stock details for {name}", { name: p.name }));
    li.querySelector(".entry__drawer").setAttribute("aria-label", b ? t("{name} batch details", { name: p.name }) : t("{name} details", { name: p.name }));
    li.querySelector(".entry__date").textContent = b ? day(b.expires) : "—";
    li.querySelector(".entry__count").textContent = b ? countdown(row.days) : t("No batches");
    // the fuse: how much of a month is left (full = 30 days or more, empty = expired)
    li.querySelector(".entry__fuse").style.setProperty("--left", b ? Math.max(0, Math.min(row.days, 30)) / 30 : 0);
    var qty = b ? b.qty : 0;
    var words = Store.amount(qty, p.unit);
    var at = words.indexOf(" ");
    li.querySelector(".entry__qty").innerHTML = esc(words.slice(0, at)) + " <span>" + esc(words.slice(at + 1)) + "</span>";
    li.querySelector(".entry__status").innerHTML = '<span class="mark" aria-hidden="true"></span>' + (b ? levelLabel(row.level) : t("No stock"));
    li.querySelector(".entry__note").textContent = row.status === "done" ? row.rec.doneState : row.status === "reviewed" ? t("Reviewed") : "";
    var detail = li.querySelector("[data-detail]");
    if (state.mode && state.mode.row === row.key && detail.querySelector("form")) return;   // never rebuild a form mid-typing
    var html = detailHTML(row);
    if (detail.innerHTML !== html) detail.innerHTML = html;
  }

  function sortByDays(a, b) { return a.days - b.days || a.p.name.localeCompare(b.p.name) || (a.b.lot || "").localeCompare(b.b.lot || ""); }
  function noStockRow(p) { return { key: "nostock-" + p.id, p: p, b: null, status: "open", rec: null }; }
  function rowFor(key) {
    if (batchById[key]) return info(batchById[key]);
    var pid = key.indexOf("nostock-") === 0 ? key.slice(8) : null;
    return pid && productById[pid] && !batchesOf[pid].length ? noStockRow(productById[pid]) : null;
  }

  function render() {
    var items = allInfo();
    // a completion that belonged to an earlier recommendation no longer applies
    var stale = items.filter(function (it) { return it.stale; });
    if (stale.length) { stale.forEach(function (it) { delete data.statuses[it.b.id]; }); items = allInfo(); persist(); }

    var live = {};
    var shown = 0;
    GROUPS.forEach(function (g) {
      var list = groupEls[g.id].querySelector("[data-entries]");
      var rows = g.id === "nostock" ? noStockProducts().map(noStockRow).sort(function (a, b) { return a.p.name.localeCompare(b.p.name); })
        : items.filter(function (it) { return g.levels.indexOf(it.level.id) !== -1; }).sort(sortByDays);
      var visible = 0;
      rows.forEach(function (row) {
        var li = rowEls[row.key] || (rowEls[row.key] = buildRow(row.key));
        live[row.key] = true;
        updateRow(li, row);
        li.hidden = row.b ? !matches(row) : !(state.filter === "all" && matchesQuery(row.p, null));
        if (!li.hidden) visible++;
        list.appendChild(li);
      });
      groupEls[g.id].hidden = visible === 0;
      shown += visible;
    });
    // rows for deleted batches/products leave the page
    Object.keys(rowEls).forEach(function (key) {
      if (!live[key]) { if (rowEls[key].parentNode) rowEls[key].parentNode.removeChild(rowEls[key]); delete rowEls[key]; if (state.openId === key) state.openId = null; }
    });

    var batches = items.length, products = data.products.length;
    var batchesShown = items.filter(function (it) { return !rowEls[it.key].hidden; }).length;
    var pending = items.filter(function (it) { return it.rec && it.status !== "done"; }).length;
    var countLine = $("[data-count]").parentNode;
    // the numbers count to their new values (the wording follows the final numbers)
    tween("count", [batches, products, batchesShown, pending], function (v, moving) {
      var nb = Math.round(v[0]), np = Math.round(v[1]), ns = Math.round(v[2]), na = Math.round(v[3]);
      var countText;
      if (!products) countText = t("No products");
      else if (!batches) countText = tn(np, "{n} product, no stock on record", "{n} products, no stock on record");
      else countText = batchesShown === batches ?
        t("{batches} of {products}", { batches: tn(nb, "{n} batch", "{n} batches"), products: tn(np, "{n} product", "{n} products") }) :
        t("Showing {shown} of {batches}", { shown: ns, batches: tn(nb, "{n} batch", "{n} batches") });
      $("[data-count]").textContent = countText;
      $("[data-count-tail]").textContent = batches ? ", " + t("soonest first") + " · " + (pending ? tn(na, "{n} action to do", "{n} actions to do") : t("nothing needs action right now")) : "";
      countLine.setAttribute("aria-busy", String(moving));    // screen readers wait for the final numbers
    });
    $("[data-count-tail]").hidden = !batches;

    var unknownCode = barcodeIn(state.query);
    if (unknownCode && Store.findProductByBarcode(data.products, unknownCode)) unknownCode = null;
    if (shown === 0 && unknownCode) {
      emptyEl.removeAttribute("data-shown");             // so the empty-shop guide is rebuilt once the search is cleared
      emptyEl.innerHTML = "<p>" + t("No product has barcode {code} yet.", { code: unknownCode }) + "</p>" +
        '<button type="button" class="textlink" data-empty-add-code="' + unknownCode + '">' + t("Add it as a new product") + "</button>" +
        '<p class="empty__hint">' + t("To link it to a product you already have instead, open that product and choose Edit product.") + "</p>";
    } else if (shown === 0 && products) {
      emptyEl.innerHTML = "<p>" + t("Nothing on the shelf matches.") + '</p><button type="button" class="textlink" data-clear>' + t("Show everything") + "</button>";
    } else if (shown === 0) {
      // an empty shop: three steps to get going
      var guide = "<p>" + t("Your shelf is empty. Three steps to get going:") + "</p>" +
        '<ol class="steps">' +
          "<li><b>" + t("Add your first product") + "</b><span>" + t("With the batch you have now: how many, and the expiry date printed on it.") + '</span><button type="button" class="btn btn--primary btn--sm" data-empty-add>' + t("Add a product") + "</button></li>" +
          "<li><b>" + t("Put in each delivery as a batch") + "</b><span>" + t("Or bring your whole stock list in from a spreadsheet.") + '</span><a class="textlink" href="settings.html" data-page-link>' + t("Import a spreadsheet") + "</a></li>" +
          "<li><b>" + t("Check the Shelf each morning") + "</b><span>" + t("The most urgent batches are always at the top. Back up once a week from Settings.") + "</span></li>" +
        "</ol>";
      if (emptyEl.getAttribute("data-shown") !== "guide") { emptyEl.innerHTML = guide; emptyEl.setAttribute("data-shown", "guide"); enter(emptyEl.querySelector(".steps")); }
    }
    if (shown > 0 || products) emptyEl.removeAttribute("data-shown");
    emptyEl.hidden = shown > 0;
    renderFilters();
    if (state.openId && rowEls[state.openId] && rowEls[state.openId].hidden) setOpen(state.openId, false, true);
    renderLedger();
    observeReveals();
  }

  // ---------- Scroll reveals ----------
  var io = ("IntersectionObserver" in window && !reduced) ? new IntersectionObserver(function (entries) {
    var batch = 0;
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.style.setProperty("--rd", Math.min(batch++, 6) * 60 + "ms");
      e.target.classList.add("is-in");
      io.unobserve(e.target);
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }) : null;
  function observeReveals() {
    groupsEl.querySelectorAll(".group:not(.is-in), .entry:not(.is-in)").forEach(function (el) {
      if (io) io.observe(el); else el.classList.add("is-in");
    });
  }

  // Make sure a row that was just created or changed is visible (clear a search/filter hiding it).
  function showRowIfHidden(row) {
    if (row && row.b && !matches(row)) { state.query = ""; state.filter = "all"; searchEl.value = ""; }
  }
  // Bring a row into view, mark it, and put keyboard focus on it.
  function revealRow(key, after) {
    var li = rowEls[key];
    if (!li) return;
    li.classList.add("is-in");
    li.querySelector(".entry__name").focus({ preventScroll: true });
    // it arrives with a violet glow
    li.classList.remove("is-arrived");
    void li.offsetWidth;
    li.classList.add("is-arrived");
    setTimeout(function () { li.classList.remove("is-arrived"); }, 1500);
    setTimeout(function () {
      var r = li.getBoundingClientRect();
      if (r.top < 90 || r.bottom > window.innerHeight - 24) {
        window.scrollTo({ top: r.top + window.scrollY - window.innerHeight * 0.35, behavior: reduced ? "auto" : "smooth" });
      }
      confirmRow(key);
    }, reduced ? 0 : after || 0);
  }

  // ---------- Details: expand in place ----------
  function setOpen(key, open, instant) {
    var li = rowEls[key];
    if (!li) return;
    if (instant) li.classList.add("no-anim");
    li.classList.toggle("is-open", open);
    li.querySelectorAll(".entry__name, .entry__info").forEach(function (b) { b.setAttribute("aria-expanded", String(open)); });
    var drawer = li.querySelector(".entry__drawer");
    if (open) drawer.removeAttribute("inert"); else drawer.setAttribute("inert", "");
    if (instant) { void li.offsetHeight; li.classList.remove("no-anim"); }
    if (!open) {
      if (state.openId === key) state.openId = null;
      if (state.mode && state.mode.row === key) {      // leaving abandons a half-finished form or confirmation
        state.mode = null;
        var row = rowFor(key);
        if (row) li.querySelector("[data-detail]").innerHTML = detailHTML(row);
      }
    }
  }
  function openDetail(key) {
    closePop();
    closeAdder(false);
    var li = rowEls[key];
    var prev = state.openId;
    if (prev && prev !== key && rowEls[prev]) {
      var above = rowEls[prev].compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING;
      var before = li.getBoundingClientRect().top;
      setOpen(prev, false, !!above);
      if (above) window.scrollBy(0, li.getBoundingClientRect().top - before);
    }
    state.openId = key;
    setOpen(key, true);
    setTimeout(function () {
      var r = li.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 16) window.scrollBy({ top: Math.min(r.bottom - window.innerHeight + 24, r.top - 120), behavior: reduced ? "auto" : "smooth" });
    }, reduced ? 0 : 420);
  }
  function closeDetail(focusName) {
    var key = state.openId;
    if (!key) return;
    setOpen(key, false);
    if (focusName && rowEls[key]) rowEls[key].querySelector(".entry__name").focus({ preventScroll: true });
  }
  // Switch an open row between view / forms / confirmations, then focus the right control.
  function setMode(key, kind, focusSel) {
    state.mode = kind ? { row: key, kind: kind } : null;
    var row = rowFor(key);
    if (!row) return;
    var li = rowEls[key];
    var inner = li.querySelector(".entry__drawer-inner");
    var detail = li.querySelector("[data-detail]");
    var h0 = inner.offsetHeight;
    detail.innerHTML = detailHTML(row);
    // the drawer grows or shrinks to the new content, which rises in piece by piece
    if (!reduced && inner.animate && li.classList.contains("is-open")) {
      var h1 = inner.offsetHeight;
      inner.getAnimations().forEach(function (a) { a.cancel(); });
      if (h0 !== h1) inner.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 380, easing: EASE });
      var form = detail.querySelector("form");
      if (form) { enter(detail, ":scope > :not(form)"); enter(form, ":scope > *"); } else enter(detail);
    }
    var f = li.querySelector(focusSel || (kind ? "input, select, [data-confirm-no]" : "[data-mode]"));
    if (f) f.focus({ preventScroll: true });
  }
  function goToRow(key) {
    var li = rowEls[key];
    if (!li) return;
    if (li.hidden) { state.query = ""; state.filter = "all"; searchEl.value = ""; render(); }
    openDetail(key);
    var r = li.getBoundingClientRect();
    window.scrollTo({ top: r.top + window.scrollY - 120, behavior: reduced ? "auto" : "smooth" });
    li.querySelector(".entry__name").focus({ preventScroll: true });
  }

  groupsEl.addEventListener("click", function (e) {
    var li = e.target.closest("[data-entry]");
    if (!li) return;
    var key = li.getAttribute("data-entry");
    if (e.target.closest("[data-close]")) { closeDetail(true); return; }
    var act = e.target.closest("[data-act]");
    if (act) { setStatus(key, act.getAttribute("data-act")); return; }
    var mode = e.target.closest("[data-mode]");
    if (mode) { setMode(key, mode.getAttribute("data-mode")); return; }
    if (e.target.closest("[data-form-cancel]") || e.target.closest("[data-confirm-no]")) {
      var was = state.mode ? state.mode.kind : null;
      setMode(key, null, was ? '[data-mode="' + was + '"]' : null);
      return;
    }
    // deleting or writing off: the row folds away first, then the change is made
    if (e.target.closest("[data-confirm-yes]")) { leave(li, function () { confirmDelete(key); }); return; }
    var go = e.target.closest("[data-go]");
    if (go) { goToRow(go.getAttribute("data-go")); return; }
    var sold = e.target.closest("[data-sell]");
    if (sold) { sell(key, sold.getAttribute("data-sell")); return; }
    if (e.target.closest("[data-sell-other]")) { sell(key, li.querySelector("[data-sell-input]").value); return; }
    var wo = e.target.closest("[data-writeoff]");
    if (wo) { var outcome = wo.getAttribute("data-writeoff"); leave(li, function () { writeOff(key, outcome); }); return; }
    if (e.target.closest(".entry__drawer")) return;
    if (state.openId === key) closeDetail(); else openDetail(key);
  });

  // ---------- Form submissions inside a row: edit product, add batch, edit batch ----------
  groupsEl.addEventListener("submit", function (e) {
    e.preventDefault();
    var li = e.target.closest("[data-entry]");
    if (!li || !state.mode) return;
    var key = li.getAttribute("data-entry");
    var row = rowFor(key);
    if (!row) return;
    var raw = readForm(e.target);
    var kind = state.mode.kind;
    var p = row.p;

    if (kind === "edit-product") {
      var rp = Store.validateProduct(raw, { products: data.products, batches: data.batches, excludeId: p.id });
      if (rp.errors) { showErrors(e.target, rp.errors); return; }
      p.name = rp.values.name;
      p.category = rp.values.category;
      p.unit = rp.values.unit;
      p.barcode = rp.values.barcode;
      data.customized = true;
      state.mode = null;
      persist();
      render();
      revealRow(key, 80);
      toast(t("Saved {name}", { name: p.name }), null);
      return;
    }

    if (kind === "add-batch") {
      var ra = Store.validateBatch(raw, { batches: data.batches, productId: p.id, today: today, unit: p.unit });
      if (ra.errors) { showErrors(e.target, ra.errors); return; }
      var nb = merge({ id: Store.newId("b", takenIds()), productId: p.id }, ra.values);
      data.batches.push(nb);
      data.customized = true;
      state.mode = null;
      reindex();
      persist();
      if (state.openId === key) setOpen(key, false, true);
      showRowIfHidden(info(nb));
      render();
      revealRow(nb.id, 80);
      toast(nb.lot ? t("Added batch {lot} to {name}", { lot: nb.lot, name: p.name }) : t("Added a batch to {name}", { name: p.name }), null);
      return;
    }

    if (kind === "edit-batch") {
      var b = row.b;
      var re = Store.validateBatch(raw, { batches: data.batches, productId: p.id, excludeId: b.id, today: today, unit: p.unit });
      if (re.errors) { showErrors(e.target, re.errors); return; }
      var dateChanged = b.expires !== re.values.expires;
      Object.keys(re.values).forEach(function (k) { b[k] = re.values[k]; });
      if (dateChanged) delete data.statuses[b.id];       // a new date is a new situation
      data.customized = true;
      state.mode = null;
      reindex();
      persist();
      showRowIfHidden(info(b));
      render();
      revealRow(b.id, 80);
      var saved = b.lot ? t("Saved batch {lot} of {name}", { lot: b.lot, name: p.name }) : t("Saved the batch of {name}", { name: p.name });
      toast(dateChanged ? t("{saved} — now {level}", { saved: saved, level: levelLabel(info(b).level).toLowerCase() }) : saved, null);
    }
  });

  // ---------- Deletes (confirmed; undo restores exactly what was removed) ----------
  function confirmDelete(key) {
    var row = rowFor(key);
    if (!row || !state.mode) return;
    var kind = state.mode.kind;
    var li = rowEls[key];
    var next = li.nextElementSibling;
    while (next && next.hidden) next = next.nextElementSibling;
    var nextKey = next ? next.getAttribute("data-entry") : null;
    var removedBatches, removedProduct = null, removedStatuses = {}, label;

    if (kind === "delete-batch") {
      removedBatches = [row.b];
      label = row.b.lot ? t("Deleted batch {lot} of {name}", { lot: row.b.lot, name: row.p.name }) : t("Deleted a batch of {name}", { name: row.p.name });
    } else if (kind === "delete-product") {
      removedProduct = row.p;
      removedBatches = batchesOf[row.p.id].slice();
      label = t("Deleted {name}", { name: row.p.name });
    } else return;

    var batchIndex = {};
    removedBatches.forEach(function (b) {
      batchIndex[b.id] = data.batches.indexOf(b);
      if (data.statuses[b.id]) { removedStatuses[b.id] = data.statuses[b.id]; delete data.statuses[b.id]; }
    });
    var productIndex = removedProduct ? data.products.indexOf(removedProduct) : -1;
    data.batches = data.batches.filter(function (b) { return removedBatches.indexOf(b) === -1; });
    if (removedProduct) data.products = data.products.filter(function (p) { return p !== removedProduct; });
    data.customized = true;
    state.mode = null;
    state.openId = null;
    reindex();
    persist();
    render();
    var target = nextKey && rowEls[nextKey] ? rowEls[nextKey].querySelector(".entry__name") : addBtn;
    target.focus({ preventScroll: true });

    toast(label, function () {
      if (removedProduct && !productById[removedProduct.id]) {
        // a product with the same name (or barcode) added since would make a duplicate
        if (Store.findProductByName(data.products, removedProduct.name) || Store.findProductByBarcode(data.products, removedProduct.barcode)) {
          toast(t("{name} can’t come back — a product with the same name or barcode was added since.", { name: removedProduct.name }), null);
          return;
        }
        data.products.splice(Math.min(productIndex, data.products.length), 0, removedProduct);
        reindex();
      }
      var skipped = 0;
      removedBatches.forEach(function (b) {
        if (batchById[b.id] || !productById[b.productId]) return;
        // the same batch may have been added again since (by hand or by import)
        if (Store.findDuplicateBatch(data.batches, b.productId, b.lot, b.expires)) { skipped++; return; }
        data.batches.splice(Math.min(batchIndex[b.id], data.batches.length), 0, b);
        if (removedStatuses[b.id]) data.statuses[b.id] = removedStatuses[b.id];
      });
      reindex();
      persist();
      render();
      if (skipped) toast(tn(skipped, "{n} batch was already back on the list, so it wasn’t added twice.", "{n} batches were already back on the list, so they weren’t added twice."), null);
      if (removedBatches[0] && rowEls[removedBatches[0].id]) revealRow(removedBatches[0].id);
      else if (removedProduct && rowEls["nostock-" + removedProduct.id]) revealRow("nostock-" + removedProduct.id);
    });
  }

  // ---------- Write-offs: expired stock that has left the shelf ----------
  function nextVisibleKey(key) {
    // the next row on the page, even if it's in the next group
    var rows = Array.prototype.filter.call(groupsEl.querySelectorAll("[data-entry]"), function (li) { return !li.hidden && !li.closest(".group").hidden; });
    var i = rows.indexOf(rowEls[key]);
    var next = rows[i + 1] || rows[i - 1];
    return next ? next.getAttribute("data-entry") : null;
  }
  function writeOff(key, outcome) {
    var b = batchById[key];
    if (!b) return;
    var row = info(b);
    if (row.level.id !== "expired") return;          // only expired stock is written off here
    var nextKey = nextVisibleKey(key);
    var w = {
      id: Store.newId("w", takenIds()), batchId: b.id, productId: b.productId,
      name: row.p.name, lot: b.lot, supplier: b.supplier, qty: b.qty, unit: row.p.unit, unitCost: b.unitCost, expires: b.expires,
      outcome: outcome === "return" ? "return" : "waste", claim: outcome === "return" ? "pending" : null,
      at: Inv.toISO(today), settledAt: ""
    };
    var index = data.batches.indexOf(b);
    var status = data.statuses[b.id] || null;
    data.batches.splice(index, 1);
    delete data.statuses[b.id];
    data.writeoffs.push(w);
    data.customized = true;
    state.mode = null;
    state.openId = null;
    reindex();
    persist();
    render();
    var target = nextKey && rowEls[nextKey] ? rowEls[nextKey].querySelector(".entry__name") : addBtn;
    target.focus({ preventScroll: true });

    var v = Store.valuePaise(w.qty, w.unitCost);
    var what = { amount: Store.amount(w.qty, w.unit), name: w.name };
    var msg = w.outcome === "waste" ? t("Thrown away: {amount} of {name}", what) : t("Returned: {amount} of {name}", what);
    if (v !== null) msg += " — " + (w.outcome === "waste" ? t("{value} lost", { value: money(v) }) : t("{value} to claim", { value: money(v) }));
    if (w.outcome === "return" && w.supplier) msg += " " + t("from {supplier}", { supplier: w.supplier });
    toast(msg, function () {
      var i = data.writeoffs.indexOf(w);
      if (i === -1 || batchById[b.id] || !productById[b.productId]) return;   // product deleted meanwhile: keep the record
      if (Store.findDuplicateBatch(data.batches, b.productId, b.lot, b.expires)) {
        toast(t("That batch is already back on the list, so the write-off stays."), null);
        return;
      }
      data.writeoffs.splice(i, 1);
      data.batches.splice(Math.min(index, data.batches.length), 0, b);
      if (status) data.statuses[b.id] = status;
      reindex();
      persist();
      render();
      revealRow(b.id);
    });
  }

  // The supplier's answer to a return: credited, or refused (then the value counts as lost).
  function settleClaim(id, claim) {
    var w = data.writeoffs.filter(function (x) { return x.id === id; })[0];
    if (!w || w.outcome !== "return") return;
    var prev = { claim: w.claim, settledAt: w.settledAt };
    w.claim = claim;
    w.settledAt = claim === "pending" ? "" : Inv.toISO(today);
    persist();
    renderLedger();
    var v = Store.valuePaise(w.qty, w.unitCost);
    var p = { name: w.name, value: v === null ? "" : " (" + money(v) + ")" };
    toast(claim === "received" ? t("Credit received for {name}{value}", p) :
      claim === "refused" ? t("Refused — {name}{value} counted as lost", p) : t("{name} — waiting on the supplier again", p),
      function () { w.claim = prev.claim; w.settledAt = prev.settledAt; persist(); renderLedger(); });
    var li = ledgerList.querySelector('[data-w="' + id + '"]');
    var f = li && li.querySelector("button");
    if (f) f.focus({ preventScroll: true });
  }

  var ledgerList = $("[data-ledger-list]");
  function renderLedger() {
    var month = Inv.toISO(today).slice(0, 7);
    var monthName = fmtMonth.format(today);
    var lost = 0, waiting = 0, credited = 0, uncosted = 0;
    // a record belongs to the month it was thrown away, or — for a settled return — the month the supplier answered
    function monthOf(w) { return (w.claim === "received" || w.claim === "refused") && w.settledAt ? w.settledAt.slice(0, 7) : w.at.slice(0, 7); }
    var shown = data.writeoffs.filter(function (w) { return w.claim === "pending" || monthOf(w) === month; });
    shown.forEach(function (w) {
      var v = Store.valuePaise(w.qty, w.unitCost);
      if (v === null) { uncosted++; return; }
      if (w.claim === "pending") waiting += v;
      else if (w.claim === "received") credited += v;
      else lost += v;                                    // thrown away, or a refused return
    });

    $("[data-ledger-note]").textContent = monthName + " " + today.getFullYear();
    var sumEl = $("[data-ledger-sum]");
    if (!shown.length) {
      tween("ledger", [0, 0, 0], function () {});
      sumEl.textContent = t("Nothing written off in {month}. When an expired batch comes off the shelf, record it from its details and it’s counted here.", { month: monthName });
    } else {
      // the rupee amounts count to their new values; while moving they show whole rupees
      tween("ledger", [lost, waiting, credited], function (v, moving) {
        function amt(p) { return money(moving ? Math.round(p / 100) * 100 : p); }
        var parts = [];
        if (lost || (!waiting && !credited)) parts.push(t("{value} lost in {month}", { value: amt(v[0]), month: monthName }));
        if (waiting) parts.push(t("{value} waiting from suppliers", { value: amt(v[1]) }));
        if (credited) parts.push(t("{value} credited", { value: amt(v[2]) }));
        sumEl.textContent = parts.join(" · ");
        sumEl.setAttribute("aria-busy", String(moving));
      });
    }
    var noteEl = $("[data-ledger-more]");
    noteEl.textContent = uncosted ? tn(uncosted, "{n} write-off has no cost recorded, so it isn’t in these totals.", "{n} write-offs have no cost recorded, so they aren’t in these totals.") : "";
    noteEl.hidden = !uncosted;
    $("[data-ledger-export-wrap]").hidden = !Csv || !data.writeoffs.length;

    // claims still open come first (oldest first), then this month's records (newest first)
    shown.sort(function (a, b) {
      var pa = a.claim === "pending", pb = b.claim === "pending";
      if (pa !== pb) return pa ? -1 : 1;
      return pa ? (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) : (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
    });
    // remember each line's state, so only the lines that changed animate in afterwards
    var before = {};
    Array.prototype.forEach.call(ledgerList.querySelectorAll("[data-w]"), function (li) { before[li.getAttribute("data-w")] = li.className; });
    var firstDraw = !renderLedger.drawn;
    renderLedger.drawn = true;
    ledgerList.innerHTML = shown.map(function (w) {
      var v = Store.valuePaise(w.qty, w.unitCost);
      var on = day(w.at);
      var facts = [Store.amount(w.qty, w.unit)];
      if (w.expires) facts.push(t("expired {date}", { date: day(w.expires) }));
      var where, actions = "";
      if (w.outcome === "waste") where = t("Thrown away {date}", { date: on });
      else if (w.claim === "pending") {
        where = w.supplier ? t("Returned {date} · waiting on {supplier}", { date: on, supplier: w.supplier }) : t("Returned {date} · waiting on the supplier", { date: on });
        actions = '<span class="ledger__acts"><button type="button" class="btn btn--ghost btn--sm" data-claim="received">' + t("Credit received") + "</button>" +
          '<button type="button" class="detail__link" data-claim="refused">' + t("Supplier refused") + "</button></span>";
      } else if (w.claim === "received") {
        var when = day(w.settledAt || w.at);
        where = w.supplier ? t("Credited {date} by {supplier}", { date: when, supplier: w.supplier }) : t("Credited {date}", { date: when });
      } else {
        where = w.supplier ? t("Return refused by {supplier} · counted as lost", { supplier: w.supplier }) : t("Return refused · counted as lost");
      }
      if (w.claim === "received" || w.claim === "refused") {
        actions = '<span class="ledger__acts"><button type="button" class="detail__link" data-claim="pending">' + t("Reopen claim") + "</button></span>";
      }
      return '<li class="ledger__item ledger__item--' + (w.claim || w.outcome) + '" data-w="' + w.id + '">' +
        '<p class="ledger__what"><b>' + esc(w.name) + "</b>" + (w.lot ? " · " + esc(t("Batch {lot}", { lot: w.lot })) : "") + "</p>" +
        '<p class="ledger__facts">' + esc(facts.join(" · ")) + " · " + esc(where) + "</p>" +
        '<p class="ledger__value">' + (v === null ? '<span class="ledger__nocost">' + t("No cost") + "</span>" : money(v)) + "</p>" +
        actions + "</li>";
    }).join("");
    if (!firstDraw) {
      var changed = Array.prototype.filter.call(ledgerList.querySelectorAll("[data-w]"), function (li) { return before[li.getAttribute("data-w")] !== li.className; });
      changed.forEach(function (li) { li.classList.add("is-new-line"); });
      enter(ledgerList, ".is-new-line");
    }
  }
  $("[data-ledger-export]").addEventListener("click", function () {
    var name = csvName("write-offs");
    Csv.download(name, Csv.writeoffsCSV(data));
    toast(t("Downloaded {file} — {count}", { file: name, count: tn(data.writeoffs.length, "{n} write-off", "{n} write-offs") }), null);
  });
  ledgerList.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-claim]");
    var li = e.target.closest("[data-w]");
    if (btn && li) settleClaim(li.getAttribute("data-w"), btn.getAttribute("data-claim"));
  });

  // ---------- ⓘ popovers (about + risk levels) ----------
  var popTrigger = null;
  var popTimer = null;
  function popContent(kind) {
    if (kind === "about") {
      return { title: t("About this demo"), body:
        "<p>" + t("ShelfLife Radar compares each batch’s expiry date with today’s date, sorts the shelf by urgency and suggests what to do next.") + "</p>" +
        "<p>" + t("A product can have several batches with different dates; each one is listed and handled on its own. The store and its stock are fictional; changes are saved only in this browser.") + "</p>" };
    }
    return { title: t("Risk levels"), body: '<ul class="pop__levels">' + Inv.LEVELS.map(function (l) {
      return '<li><span class="risk risk--' + l.id + '">' + levelLabel(l) + "</span><span>" + MEANING[l.id] + "</span></li>";
    }).join("") + "</ul>" };
  }
  function openPop(trigger) {
    if (popTrigger === trigger) { closePop(); return; }
    if (popTrigger) popTrigger.setAttribute("aria-expanded", "false");
    var c = popContent(trigger.getAttribute("data-info"));
    pop.innerHTML = '<p class="pop__title" id="pop-title">' + c.title + "</p>" + c.body;
    clearTimeout(popTimer);
    pop.hidden = false;
    pop.classList.remove("is-on");
    popTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    placePop();
    void pop.offsetWidth;
    pop.classList.add("is-on");
  }
  function placePop() {
    if (!popTrigger) return;
    var r = popTrigger.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight, m = 12;
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, m), window.innerWidth - w - m);
    var below = r.bottom + 10 + h < window.innerHeight - m || r.top - 10 - h < m;
    pop.style.left = left + "px";
    pop.style.top = (below ? r.bottom + 10 : r.top - 10 - h) + "px";
    pop.classList.toggle("is-above", !below);
    pop.style.setProperty("--ox", Math.min(Math.max(r.left + r.width / 2 - left, 14), w - 14) + "px");
  }
  function closePop(restoreFocus) {
    if (!popTrigger) return;
    var trig = popTrigger;
    popTrigger = null;
    trig.setAttribute("aria-expanded", "false");
    pop.classList.remove("is-on");
    popTimer = setTimeout(function () { pop.hidden = true; }, reduced ? 0 : 200);
    if (restoreFocus) trig.focus({ preventScroll: true });
  }
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-info]");
    if (trigger) { openPop(trigger); return; }
    if (popTrigger && !pop.contains(e.target)) closePop();
  });
  document.addEventListener("focusin", function (e) {
    if (popTrigger && e.target !== popTrigger && !pop.contains(e.target)) closePop();
  });
  window.addEventListener("scroll", function () { if (popTrigger) placePop(); }, { passive: true });
  window.addEventListener("resize", function () { closePop(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (popTrigger) { e.preventDefault(); closePop(true); return; }
    if (adder.classList.contains("is-open") && adder.contains(document.activeElement)) { e.preventDefault(); closeAdder(true); return; }
    // inside a form or confirmation, Escape steps back to the row's details first
    if (state.mode && state.openId === state.mode.row) { e.preventDefault(); var was = state.mode.kind; setMode(state.mode.row, null, '[data-mode="' + was + '"]'); return; }
    if (state.openId) { e.preventDefault(); closeDetail(true); }
  });

  // ---------- Review / complete (per batch, against its current recommendation) ----------
  function setStatus(key, next) {
    var b = batchById[key];
    if (!b) return;
    var row = info(b);
    var rec = row.rec;
    if (next === "done" && !rec) return;
    var prev = data.statuses[key] || null;
    if (next === "open") delete data.statuses[key];
    else data.statuses[key] = { s: next, at: Date.now(), rec: rec ? rec.key : null };
    persist();
    render();
    if (next !== "open") confirmRow(key);
    var who = row.p.name + (b.lot ? " (" + b.lot + ")" : "");
    var msg = next === "done" ? who + " — " + rec.doneState.toLowerCase() : next === "reviewed" ? t("{who} — reviewed", { who: who }) : t("{who} — reopened", { who: who });
    toast(msg, function () {
      if (!batchById[key]) return;
      if (prev) data.statuses[key] = prev; else delete data.statuses[key];
      persist();
      render();
    });
    var btn = rowEls[key].querySelector(".detail__actions button");
    if (btn && state.openId === key) btn.focus({ preventScroll: true });
  }

  function confirmRow(key) {
    var li = rowEls[key];
    if (!li) return;
    li.classList.remove("is-confirm");
    void li.offsetWidth;
    li.classList.add("is-confirm");
    setTimeout(function () { li.classList.remove("is-confirm"); }, 1200);
  }

  // notifications (ui.js); an undo stops applying once all the data has been replaced (restore, reset)
  function toast(message, undo) {
    var gen = dataGen;
    UI.toast(message, undo, { stale: function () { return gen !== dataGen; } });
  }

  // ---------- Search / filter ----------
  function applyChange() {
    var before = {}, groupWasHidden = {};
    Object.keys(rowEls).forEach(function (k) { before[k] = rowEls[k].hidden; });
    GROUPS.forEach(function (g) { groupWasHidden[g.id] = groupEls[g.id].hidden; });
    var emptyWasHidden = emptyEl.hidden;
    render();
    if (reduced || !groupsEl.animate) return;
    // only what newly appears moves: rows cascade in, a returning section's heading slides back
    GROUPS.forEach(function (g) {
      var el = groupEls[g.id];
      if (groupWasHidden[g.id] && !el.hidden) el.querySelector(".group__head").animate(
        [{ opacity: 0, transform: "translateX(-18px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: EASE });
    });
    var k = 0;
    Object.keys(rowEls).forEach(function (key) {
      var li = rowEls[key];
      if (!li.hidden && li.classList.contains("is-in") && before[key] !== false) {
        li.getAnimations().forEach(function (a) { a.cancel(); });
        li.animate([{ opacity: 0, transform: "translateY(14px) scale(0.985)" }, { opacity: 1, transform: "none" }],
          { duration: 460, delay: Math.min(k++, 8) * 45, easing: EASE, fill: "backwards" });
      }
    });
    if (emptyWasHidden && !emptyEl.hidden) enter(emptyEl);
  }
  filtersEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b || b.getAttribute("data-filter") === state.filter) return;
    state.filter = b.getAttribute("data-filter");
    renderFilters();
    applyChange();
    b.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  });
  var searchTimer = null;
  searchEl.addEventListener("input", function () {
    state.query = searchEl.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyChange, 90);
  });
  emptyEl.addEventListener("click", function (e) {
    if (e.target.closest("[data-clear]")) {
      state.query = ""; state.filter = "all"; searchEl.value = "";
      renderFilters();
      applyChange();
      searchEl.focus();
    }
    if (e.target.closest("[data-empty-add]")) openAdder();
    var codeBtn = e.target.closest("[data-empty-add-code]");
    if (codeBtn) openAdder({ barcode: codeBtn.getAttribute("data-empty-add-code") });
  });

  render();
  requestAnimationFrame(function () { requestAnimationFrame(function () { tabsBar.classList.remove("no-anim"); }); });

  // ---------- First visit: this is a sample shop; start your own when ready ----------
  var welcomeEl = $("[data-welcome]");
  var WELCOMED = "shelflife-welcomed";
  function rememberWelcomed() { try { localStorage.setItem(WELCOMED, "1"); } catch (e) {} }
  function firstVisit() {
    try { return localStorage.getItem(Store.KEY) === null && !localStorage.getItem(WELCOMED); } catch (e) { return false; }
  }
  function showWelcome() {
    welcomeEl.innerHTML = '<div class="welcome__inner">' +
      '<p class="welcome__kicker">' + t("Welcome") + "</p>" +
      '<h2 class="welcome__title" id="welcome-title">' + t("This is Corner Market, a sample shop.") + "</h2>" +
      '<p class="welcome__text">' + t("Try anything — open a batch, record a sale, throw something away. When you’re ready, start your own shop: it begins empty, and you add your stock.") + "</p>" +
      '<form class="welcome__form" data-welcome-form novalidate>' +
        '<label for="shop-name">' + t("Your shop’s name") + ' <span class="pform__hint">' + t("optional") + "</span></label>" +
        '<input id="shop-name" type="text" maxlength="' + Store.LIMITS.shop + '" autocomplete="organization" placeholder="' + esc(t("e.g. Sharma General Store")) + '">' +
        '<div class="welcome__actions"><button type="submit" class="btn btn--primary btn--sm">' + t("Start my own shop") + "</button>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-welcome-close>' + t("Keep exploring the sample") + "</button></div>" +
      "</form></div>";
    welcomeEl.hidden = false;
    enter(welcomeEl.querySelector(".welcome__inner"));
  }
  function closeWelcome() {
    rememberWelcomed();
    if (reduced || !welcomeEl.animate) { welcomeEl.hidden = true; return; }
    var h = welcomeEl.offsetHeight;
    welcomeEl.style.overflow = "hidden";
    welcomeEl.animate([{ opacity: 1, height: h + "px" }, { opacity: 0, height: h + "px", offset: 0.35 }, { opacity: 0, height: "0px", marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }],
      { duration: 520, easing: EASE }).onfinish = function () { welcomeEl.hidden = true; welcomeEl.style.overflow = ""; };
  }
  welcomeEl.addEventListener("click", function (e) { if (e.target.closest("[data-welcome-close]")) closeWelcome(); });
  welcomeEl.addEventListener("submit", function (e) {
    e.preventDefault();
    startOwnShop(e.target.querySelector("input").value);
  });
  // An empty shop of one's own. The sample (or whatever was saved) is kept as a copy, and undo puts it back.
  function startOwnShop(name) {
    if (!Store.keepCurrent()) { toast(t("Couldn’t keep a copy of the current data, so nothing was replaced. Download a backup of it first."), null); return; }
    var previous = data;
    data = Store.empty(name);
    dataGen++;
    closePop(); closeDetail(); closeAdder(false);
    state = { filter: "all", query: "", openId: null, mode: null };
    searchEl.value = "";
    reindex();
    persist();
    applyChange();
    UI.showShop(data.shop, data.own);
    if (!welcomeEl.hidden) closeWelcome(); else rememberWelcomed();
    var mine = dataGen;
    UI.toast(data.shop ? t("{shop} is ready. Add your first product.", { shop: data.shop }) : t("Your shop is ready. Add your first product."), function () {
      data = previous;
      dataGen++;
      reindex();
      persist();
      applyChange();
      UI.showShop(data.shop || "", data.own);
    }, { stale: function () { return mine !== dataGen; } });
    setTimeout(function () { var b = emptyEl.querySelector("[data-empty-add]"); if (b) b.focus({ preventScroll: true }); }, reduced ? 0 : 500);
  }
  if (firstVisit()) showWelcome();

  // The Calendar and Insights pages link straight to a batch: demo.html#batch=<id> opens it.
  var linked = /^#batch=([A-Za-z0-9_-]{1,64})$/.exec(location.hash);
  if (linked) {
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);   // a reload shouldn't reopen it
    if (rowEls[linked[1]]) setTimeout(function () { goToRow(linked[1]); confirmRow(linked[1]); }, reduced ? 0 : 750);
  }

  // Every date on the page is worked out from `today`. If the app stays open past midnight,
  // start again with the new date — but never in the middle of a form, panel or scan.
  function checkDay() {
    if (Inv.toISO(new Date()) === Inv.toISO(today)) return;
    var busy = state.mode || adder.classList.contains("is-open") || document.querySelector(".scan");
    if (!busy) location.reload();
  }
  setInterval(checkDay, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkDay(); });

  // Tell the user what happened to their saved data, if anything unusual did.
  var copyFailed = data.notices.some(function (n) { return (n.type === "migrated" || n.type === "repaired") && !n.backup; });
  data.notices.forEach(function (n) {
    if (n.type === "migrated") toast(n.backup ? t("Your saved inventory was upgraded to batches. A copy of the old data was kept in this browser.") :
      t("Your saved inventory was upgraded to batches, but a copy of the old data couldn’t be kept. It stays as it was until you change something — download a backup first."), null);
    if (n.type === "unreadable") toast(n.backup ? t("Saved data couldn’t be read, so the sample is shown. A copy was kept in this browser.") :
      t("Saved data couldn’t be read, so the sample is shown. Keeping a copy failed."), null);
    if (n.type === "repaired") toast(tn(n.dropped, "{n} damaged record was skipped while loading.", "{n} damaged records were skipped while loading.") +
      (n.backup ? " " + t("The original was kept in this browser.") : ""), null);
    if (n.type === "no-storage") toast(t("This browser isn’t allowing saved data, so changes won’t be kept."), null);
  });
  // save once in the clean format, so the same repair (and backup) doesn't repeat on every load —
  // but never over the original when its copy couldn't be kept
  if (!copyFailed && data.notices.some(function (n) { return n.type === "migrated" || n.type === "repaired"; })) persist();
})();
