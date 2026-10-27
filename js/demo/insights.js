/*
 * ShelfLife Radar — Insights: where the money is, and what to change.
 *
 * Read-only views of the shop's data that answer money questions: what the shelves are worth,
 * how much of that expires soon, where losses come from (category, supplier, month), and —
 * first — a short list of things to do, each shown only when it's true.
 *
 * Charts follow one set of rules: thin bars, rounded at the data end and square at the
 * baseline, hairline axes, one colour per chart (risk charts use the app's risk colours with a
 * legend), a tooltip on hover and keyboard focus, and a table view for every chart.
 * Values are at cost; batches with no cost recorded are counted separately, never guessed.
 */
(function () {
  var Inv = window.SLInventory, Store = window.SLStore, I18n = window.SLi18n, UI = window.SLUI, SL = window.SL;
  var root = document.querySelector("[data-insights]");
  if (!Inv || !Store || !I18n || !UI || !SL || !root) return;
  var t = I18n.t, tn = I18n.tn, esc = UI.esc;
  var reduced = SL.reduced;
  var LOC = I18n.locale;

  var today = new Date();
  var fmtAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  var fmtCompact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
  var fmtDay = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "short" });
  var fmtMonthShort = new Intl.DateTimeFormat(LOC, { month: "short" });
  var fmtMonthLong = new Intl.DateTimeFormat(LOC, { month: "long", year: "numeric" });
  function money(paise) { return fmtAmount.format(Math.round(paise / 100)); }
  function moneyCompact(paise) { return "₹" + fmtCompact.format(Math.round(paise / 100)); }
  function pct(part, whole) { return whole ? Math.round((part / whole) * 100) : 0; }

  // ---------- the numbers ----------
  var data = Store.load(today);
  var productById = {};
  data.products.forEach(function (p) { productById[p.id] = p; });
  var month = Inv.toISO(today).slice(0, 7);

  var batches = data.batches.filter(function (b) { return productById[b.productId]; }).map(function (b) {
    var p = productById[b.productId];
    var days = Inv.daysUntil(b.expires, today);
    return { b: b, p: p, days: days, level: Inv.classify(days), value: Store.valuePaise(b.qty, b.unitCost) };
  });
  function sum(list) { return list.reduce(function (n, x) { return n + (x.value || 0); }, 0); }
  var costed = batches.filter(function (x) { return x.value !== null; });
  var uncosted = batches.length - costed.length;
  var stockValue = sum(costed);
  var thisWeek = batches.filter(function (x) { return x.days >= 0 && x.days <= 7; });
  var atRisk14 = batches.filter(function (x) { return x.days <= 14; });

  // write-offs: the same month rule as the Shelf's ledger (a settled claim counts when it was settled)
  function monthOf(w) { return (w.claim === "received" || w.claim === "refused") && w.settledAt ? w.settledAt.slice(0, 7) : w.at.slice(0, 7); }
  function isLoss(w) { return w.outcome === "waste" || w.claim === "refused"; }
  var wo = data.writeoffs.map(function (w) { return { w: w, value: Store.valuePaise(w.qty, w.unitCost) }; });
  var lostThisMonth = wo.filter(function (x) { return isLoss(x.w) && monthOf(x.w) === month && x.value !== null; }).reduce(function (n, x) { return n + x.value; }, 0);
  var waiting = wo.filter(function (x) { return x.w.claim === "pending" && x.value !== null; }).reduce(function (n, x) { return n + x.value; }, 0);
  // sales recorded on the Shelf this month, at selling price (sales without a price aren't guessed)
  var soldThisMonth = (data.sales || []).filter(function (s) { return s.at.slice(0, 7) === month && s.price !== null; })
    .reduce(function (n, s) { return n + Store.valuePaise(s.qty, s.price); }, 0);
  // what the stock expiring this week would sell for, where a selling price is known
  function salesValue(list) { return list.reduce(function (n, x) { return n + (x.b.price === null || x.b.price === undefined ? 0 : Store.valuePaise(x.b.qty, x.b.price)); }, 0); }

  // ---------- 1. the headline ----------
  (function headline() {
    var heroEl = root.querySelector("[data-ins-hero]");
    var lineEl = root.querySelector("[data-ins-line]");
    UI.tween("ins-hero", [stockValue, sum(thisWeek), lostThisMonth, waiting, soldThisMonth], function (v, moving) {
      heroEl.textContent = money(v[0]);
      var parts = [t("{value} of it expires within 7 days", { value: money(v[1]) })];
      if (soldThisMonth) parts.push(t("{value} sold this month", { value: money(v[4]) }));
      if (lostThisMonth || !waiting) parts.push(t("{value} lost this month", { value: money(v[2]) }));
      if (waiting) parts.push(t("{value} waiting from suppliers", { value: money(v[3]) }));
      lineEl.textContent = parts.join(" · ");
      heroEl.parentNode.setAttribute("aria-busy", String(moving));
    });
    if (uncosted) root.querySelector("[data-ins-note]").textContent =
      tn(uncosted, "{n} batch has no cost recorded, so it isn’t in these amounts.", "{n} batches have no cost recorded, so they aren’t in these amounts.");
  })();

  // ---------- 2. where money is leaking (only what's true) ----------
  // Money patterns only: what to do with a single batch is the Shelf's job, so it isn't repeated here.
  (function advice() {
    var items = [];
    // a supplier who owes money for returns
    var owed = {};
    wo.forEach(function (x) { if (x.w.claim === "pending" && x.value !== null) owed[x.w.supplier || ""] = (owed[x.w.supplier || ""] || 0) + x.value; });
    Object.keys(owed).sort(function (a, b) { return owed[b] - owed[a]; }).slice(0, 2).forEach(function (s) {
      items.push({ tone: "money", text: s ? t("{supplier} owes you {value} for returned stock. Call them about the credit.", { supplier: s, value: money(owed[s]) })
        : t("Suppliers owe you {value} for returned stock (supplier not recorded). Follow up on the credit.", { value: money(owed[s]) }) });
    });
    // the category losing the most money
    var lossByCat = {}, lossTotal = 0, lossCount = 0;
    wo.forEach(function (x) {
      if (!isLoss(x.w) || x.value === null) return;
      var p = productById[x.w.productId];
      var cat = p ? p.category : "Other";
      lossByCat[cat] = (lossByCat[cat] || 0) + x.value; lossTotal += x.value; lossCount++;
    });
    var topCat = Object.keys(lossByCat).sort(function (a, b) { return lossByCat[b] - lossByCat[a]; })[0];
    if (topCat && lossCount >= 2 && lossByCat[topCat] / lossTotal >= 0.4) items.push({ tone: "change", text: t(
      "{category} causes {pct}% of your losses. Order it in smaller batches, more often.", { category: t(topCat), pct: pct(lossByCat[topCat], lossTotal) }) });
    // the supplier whose stock is lost the most
    var lossBySup = {};
    wo.forEach(function (x) { if (isLoss(x.w) && x.value !== null && x.w.supplier) lossBySup[x.w.supplier] = (lossBySup[x.w.supplier] || 0) + x.value; });
    var topSup = Object.keys(lossBySup).sort(function (a, b) { return lossBySup[b] - lossBySup[a]; })[0];
    if (topSup && lossCount >= 2 && lossBySup[topSup] / lossTotal >= 0.5) items.push({ tone: "change", text: t(
      "Stock from {supplier} causes {pct}% of your losses ({value}). Ask them for longer dates, or take smaller deliveries.", { supplier: topSup, pct: pct(lossBySup[topSup], lossTotal), value: money(lossBySup[topSup]) }) });
    // markdowns earn back more than throwing away: say so when this week's stock has selling prices
    var weekSales = salesValue(thisWeek.filter(function (x) { return x.level.id === "high"; }));
    if (weekSales) items.push({ tone: "soon", text: t(
      "Stock worth {sales} in sales expires in 4–7 days. Selling it at 15–20% off brings back about {back}; throwing it away later brings back nothing.", { sales: money(weekSales), back: money(Math.round(weekSales * 0.82)) }) });
    var list = root.querySelector("[data-ins-advice]");
    list.innerHTML = items.length ? items.map(function (it) {
      return '<li class="advice advice--' + it.tone + '"><span class="advice__mark" aria-hidden="true"></span><p>' + esc(it.text) +
        (it.link ? ' <a href="' + it.link.href + '" data-page-link class="advice__go">' + esc(it.link.label) + ' <span aria-hidden="true">→</span></a>' : "") + "</p></li>";
    }).join("") : '<li class="advice advice--ok"><span class="advice__mark" aria-hidden="true"></span><p>' + t("No money leaks to fix right now.") + "</p></li>";
  })();

  // ---------- chart helpers ----------
  var tip = document.querySelector("[data-tip]");
  function showTip(el) {
    var text = el.getAttribute("data-tip-text");
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
    tip.style.left = left + "px";
    tip.style.top = Math.max(r.top - h - 10, 8) + "px";
    tip.classList.add("is-on");
  }
  function hideTip() { tip.classList.remove("is-on"); tip.hidden = true; }
  root.addEventListener("mouseover", function (e) { var b = e.target.closest("[data-tip-text]"); if (b) showTip(b); });
  root.addEventListener("mouseout", function (e) { if (e.target.closest("[data-tip-text]")) hideTip(); });
  root.addEventListener("focusin", function (e) { var b = e.target.closest("[data-tip-text]"); if (b) showTip(b); });
  root.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, { passive: true });
  function niceMax(v) {                               // a clean top for the scale: 1, 2, 2.5, 5 × 10^n
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i] * e) return steps[i] * e;
    return 10 * e;
  }
  function table(head, rows) {
    return '<details class="chart__table"><summary>' + t("Show as a table") + '</summary><table><thead><tr>' +
      head.map(function (h, i) { return "<th" + (i ? ' class="num"' : "") + ">" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (i ? ' class="num"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></details>";
  }

  // ---------- 3. the next 30 days ----------
  (function next30() {
    var el = root.querySelector("[data-chart-30]");
    var days = [];
    for (var i = 0; i < 30; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var key = Inv.toISO(d);
      var list = batches.filter(function (x) { return x.b.expires === key; });
      days.push({ d: d, key: key, list: list, value: sum(list), level: Inv.classify(i) });
    }
    var max = niceMax(Math.max.apply(null, days.map(function (x) { return x.value; })));
    var any = days.some(function (x) { return x.list.length; });
    if (!any) { el.innerHTML = '<p class="chart__empty">' + t("Nothing expires in the next 30 days.") + "</p>"; return; }
    var cols = days.map(function (x, i) {
      var h = x.value ? Math.max(2, (x.value / max) * 100) : 0;
      var label = fmtDay.format(x.d) + " — " + (x.list.length ? tn(x.list.length, "{n} batch", "{n} batches") + ", " + money(x.value) : t("nothing expires"));
      return '<button type="button" class="col col--' + x.level.id + (x.list.length ? "" : " col--empty") + '" style="--h:' + h.toFixed(2) + '%;--i:' + i + '"' +
        ' data-tip-text="' + esc(label) + '" aria-label="' + esc(label) + '"' + (x.list.length ? "" : ' tabindex="-1"') + "><i></i></button>";
    }).join("");
    var ticks = [0, 7, 14, 21, 29].map(function (i) {
      return '<span style="--x:' + ((i + 0.5) / 30 * 100).toFixed(2) + '%">' + esc(i === 0 ? t("Today") : fmtDay.format(days[i].d)) + "</span>";
    }).join("");
    el.innerHTML =
      '<div class="chart30"><div class="chart30__scale"><span>' + esc(moneyCompact(max)) + "</span><span>" + esc(moneyCompact(max / 2)) + "</span><span>₹0</span></div>" +
      '<div class="chart30__plot"><div class="chart30__grid" aria-hidden="true"><i></i><i></i><i></i></div><div class="chart30__cols">' + cols + "</div>" +
      '<div class="chart30__week" aria-hidden="true" style="--w:' + (8 / 30 * 100).toFixed(2) + '%"><span>' + t("Next 7 days") + "</span></div></div>" +
      '<div class="chart30__ticks" aria-hidden="true">' + ticks + "</div></div>" +
      '<p class="legend" aria-hidden="true">' +
        '<span><i class="col-key col-key--critical"></i>' + t("0–3 days") + "</span>" +
        '<span><i class="col-key col-key--high"></i>' + t("4–7 days") + "</span>" +
        '<span><i class="col-key col-key--medium"></i>' + t("8–14 days") + "</span>" +
        '<span><i class="col-key col-key--low"></i>' + t("Later") + "</span></p>" +
      table([t("Day"), t("Batches"), t("Value at cost")], days.filter(function (x) { return x.list.length; }).map(function (x) {
        return [fmtDay.format(x.d), String(x.list.length), money(x.value)];
      }));
  })();

  // ---------- 4. where the money at risk sits (by category) ----------
  (function byCategory() {
    var el = root.querySelector("[data-chart-cat]");
    var byCat = {};
    atRisk14.forEach(function (x) { if (x.value !== null) byCat[x.p.category] = (byCat[x.p.category] || 0) + x.value; });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    if (!cats.length) { el.innerHTML = '<p class="chart__empty">' + t("Nothing with a recorded cost expires in the next 14 days.") + "</p>"; return; }
    var max = byCat[cats[0]];
    el.innerHTML = '<ul class="hbars">' + cats.map(function (c, i) {
      var label = t(c) + " — " + money(byCat[c]);
      return '<li style="--i:' + i + '"><span class="hbars__name">' + esc(t(c)) + "</span>" +
        '<button type="button" class="hbars__track" data-tip-text="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<i style="--w:' + ((byCat[c] / max) * 100).toFixed(2) + '%"></i></button>' +
        '<span class="hbars__value">' + esc(money(byCat[c])) + "</span></li>";
    }).join("") + "</ul>" +
      table([t("Category"), t("At risk (14 days)")], cats.map(function (c) { return [t(c), money(byCat[c])]; }));
  })();

  // ---------- 5. losses, month by month (last 6 months) ----------
  (function losses() {
    var el = root.querySelector("[data-chart-loss]");
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      var key = Inv.toISO(d).slice(0, 7);
      var lost = 0, credited = 0;
      wo.forEach(function (x) {
        if (x.value === null || monthOf(x.w) !== key) return;
        if (isLoss(x.w)) lost += x.value; else if (x.w.claim === "received") credited += x.value;
      });
      months.push({ d: d, key: key, lost: lost, credited: credited });
    }
    if (!months.some(function (m) { return m.lost || m.credited; })) {
      el.innerHTML = '<p class="chart__empty">' + t("No losses recorded yet. They appear here once expired stock is written off on the Shelf.") + "</p>";
      return;
    }
    var max = niceMax(Math.max.apply(null, months.map(function (m) { return m.lost; })) || 1);
    el.innerHTML = '<div class="mcols">' + months.map(function (m, i) {
      var label = fmtMonthLong.format(m.d) + " — " + t("{value} lost", { value: money(m.lost) }) + (m.credited ? " · " + t("{value} credited", { value: money(m.credited) }) : "");
      // the amount sits on the bar's cap
      return '<div class="mcols__col" style="--i:' + i + '">' +
        '<button type="button" class="mcols__bar" data-tip-text="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<span class="mcols__value" aria-hidden="true">' + (m.lost ? esc(moneyCompact(m.lost)) : "") + '</span><i style="--h:' + ((m.lost / max) * 100).toFixed(2) + '%"></i></button>' +
        '<span class="mcols__name">' + esc(fmtMonthShort.format(m.d)) + "</span></div>";
    }).join("") + "</div>" +
      table([t("Month"), t("Lost"), t("Credited")], months.map(function (m) { return [fmtMonthLong.format(m.d), money(m.lost), money(m.credited)]; }));
  })();

  // ---------- 6. suppliers ----------
  (function suppliers() {
    var el = root.querySelector("[data-ins-suppliers]");
    var rows = {};
    function row(name) { return rows[name] = rows[name] || { name: name, batches: 0, stock: 0, risk: 0, lost: 0, waiting: 0 }; }
    batches.forEach(function (x) {
      var r = row(x.b.supplier || "");
      r.batches++;
      if (x.value !== null) { r.stock += x.value; if (x.days <= 14) r.risk += x.value; }
    });
    wo.forEach(function (x) {
      if (x.value === null) return;
      var r = row(x.w.supplier || "");
      if (isLoss(x.w)) r.lost += x.value;
      if (x.w.claim === "pending") r.waiting += x.value;
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return (b.risk + b.lost + b.waiting) - (a.risk + a.lost + a.waiting) || b.stock - a.stock; });
    if (!list.length) { el.innerHTML = '<p class="chart__empty">' + t("No stock on record yet.") + "</p>"; return; }
    el.innerHTML = '<div class="suppliers__wrap"><table class="suppliers"><thead><tr>' +
      "<th>" + t("Supplier") + '</th><th class="num">' + t("Batches") + '</th><th class="num">' + t("Stock at cost") + '</th><th class="num">' + t("Expiring in 14 days") + '</th><th class="num">' + t("Lost") + '</th><th class="num">' + t("Waiting") + "</th></tr></thead><tbody>" +
      list.map(function (r, i) {
        return '<tr style="--i:' + i + '"><th scope="row">' + esc(r.name || t("Not recorded")) + "</th>" +
          '<td class="num">' + r.batches + '</td><td class="num">' + esc(money(r.stock)) + "</td>" +
          '<td class="num' + (r.risk ? " is-risk" : "") + '">' + (r.risk ? esc(money(r.risk)) : "—") + "</td>" +
          '<td class="num">' + (r.lost ? esc(money(r.lost)) : "—") + "</td>" +
          '<td class="num' + (r.waiting ? " is-owed" : "") + '">' + (r.waiting ? esc(money(r.waiting)) : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  })();

  root.querySelector("[data-ins-asof]").textContent = t("Worked out from your stock on {date}.", { date: new Intl.DateTimeFormat(LOC, { day: "numeric", month: "long", year: "numeric" }).format(today) });
})();
