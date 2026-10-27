/*
 * ShelfLife Radar — Calendar: when stock runs out, day by day.
 *
 * The shelf list says *what* expires; the month shows *when*, so a busy day can be seen
 * coming and planned for (markdowns, staff, the supplier call). Every batch is a dot on its
 * expiry day, coloured by how urgent it is today. Choosing a day lists its batches, each
 * linking straight to that batch on the Shelf. Read-only: it never changes the shop's data.
 */
(function () {
  var Inv = window.SLInventory, Store = window.SLStore, I18n = window.SLi18n, UI = window.SLUI, SL = window.SL;
  var root = document.querySelector("[data-calendar]");
  if (!Inv || !Store || !I18n || !UI || !SL || !root) return;
  var t = I18n.t, tn = I18n.tn, esc = UI.esc;
  var reduced = SL.reduced;
  var LOC = I18n.locale;

  var today = new Date();
  var todayISO = Inv.toISO(today);
  var fmtMonth = new Intl.DateTimeFormat(LOC, { month: "long", year: "numeric" });
  var fmtDay = new Intl.DateTimeFormat(LOC, { weekday: "long", day: "numeric", month: "long" });
  var fmtShortDay = new Intl.DateTimeFormat(LOC, { weekday: "short", day: "numeric", month: "short" });
  var fmtWeekday = new Intl.DateTimeFormat(LOC, { weekday: "short" });
  var fmtAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  function money(paise) { return fmtAmount.format(paise / 100); }

  // ---------- data (read only) ----------
  var data = Store.load(today);
  var productById = {};
  data.products.forEach(function (p) { productById[p.id] = p; });
  var byDay = {};                                     // "YYYY-MM-DD" → [batch info]
  data.batches.forEach(function (b) {
    var p = productById[b.productId];
    if (!p) return;
    var days = Inv.daysUntil(b.expires, today);
    (byDay[b.expires] = byDay[b.expires] || []).push({
      b: b, p: p, days: days, level: Inv.classify(days),
      value: Store.valuePaise(b.qty, b.unitCost)
    });
  });
  var ORDER = { expired: 0, critical: 1, high: 2, medium: 3, low: 4, safe: 5 };
  Object.keys(byDay).forEach(function (k) {
    byDay[k].sort(function (a, c) { return ORDER[a.level.id] - ORDER[c.level.id] || a.p.name.localeCompare(c.p.name); });
  });

  // ---------- state ----------
  var view = { y: today.getFullYear(), m: today.getMonth() };
  var selected = todayISO;

  var $ = function (sel) { return root.querySelector(sel); };
  var titleEl = $("[data-cal-title]"), gridEl = $("[data-cal-grid]"), dayEl = $("[data-cal-day]"), sumEl = $("[data-cal-sum]");
  var headEl = $("[data-cal-weekdays]");

  // weekday names, Monday first, in the page's language
  (function weekdays() {
    var names = [];
    for (var i = 0; i < 7; i++) names.push(fmtWeekday.format(new Date(2024, 0, 1 + i)));   // 1 Jan 2024 was a Monday
    headEl.innerHTML = names.map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("");
  })();

  function iso(y, m, d) { return Inv.toISO(new Date(y, m, d)); }
  function monthItems(y, m) {
    var prefix = iso(y, m, 1).slice(0, 7), out = [];
    Object.keys(byDay).forEach(function (k) { if (k.slice(0, 7) === prefix) out = out.concat(byDay[k]); });
    return out;
  }

  // ---------- the month ----------
  function renderMonth(direction) {
    var first = new Date(view.y, view.m, 1);
    var lead = (first.getDay() + 6) % 7;              // Monday-first: how many days of the previous month show
    var daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    var cells = Math.ceil((lead + daysInMonth) / 7) * 7;
    titleEl.textContent = fmtMonth.format(first);

    var html = "";
    for (var i = 0; i < cells; i++) {
      var d = new Date(view.y, view.m, 1 - lead + i);
      var key = Inv.toISO(d);
      var items = byDay[key] || [];
      var inMonth = d.getMonth() === view.m;
      var cls = ["cal__day"];
      if (!inMonth) cls.push("is-other");
      if (key === todayISO) cls.push("is-today");
      if (key < todayISO) cls.push("is-past");
      if (key === selected) cls.push("is-selected");
      if (items.length) cls.push("has-items", "cal__day--" + items[0].level.id);
      var dots = items.slice(0, 4).map(function (it, j) {
        return '<i class="cal__dot cal__dot--' + it.level.id + '" style="--j:' + j + '"></i>';
      }).join("") + (items.length > 4 ? '<b class="cal__more">+' + (items.length - 4) + "</b>" : "");
      var label = fmtDay.format(d) + (items.length ? ", " + tn(items.length, "{n} batch expires", "{n} batches expire") : "");
      html += '<button type="button" class="' + cls.join(" ") + '" data-day="' + key + '" style="--i:' + (Math.floor(i / 7) + i % 7) + '"' +
        ' aria-label="' + esc(label) + '"' + (key === selected ? ' aria-pressed="true"' : ' aria-pressed="false"') +
        ' tabindex="' + (key === selected ? "0" : "-1") + '">' +
        '<span class="cal__num">' + d.getDate() + "</span>" + (dots ? '<span class="cal__dots">' + dots + "</span>" : "") + "</button>";
    }

    // switching months: the old grid slides away, the new one slides in from the side
    if (direction && !reduced && gridEl.animate) {
      var out = gridEl.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(" + (-28 * direction) + "px)" }], { duration: 160, easing: "ease-in", fill: "forwards" });
      out.onfinish = function () {
        gridEl.innerHTML = html;
        out.cancel();
        gridEl.animate([{ opacity: 0, transform: "translateX(" + (28 * direction) + "px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        cascade(true);
      };
    } else {
      gridEl.innerHTML = html;
      cascade(!direction);
    }
    renderSummary();
  }
  // the days fall into place along the diagonal, then their dots pop in
  function cascade(play) {
    if (reduced || !play) return;
    gridEl.classList.remove("is-cascading");
    void gridEl.offsetWidth;
    gridEl.classList.add("is-cascading");
    setTimeout(function () { gridEl.classList.remove("is-cascading"); }, 1400);
  }

  // ---------- the month in one sentence ----------
  function renderSummary() {
    var items = monthItems(view.y, view.m);
    var value = 0, uncosted = 0;
    items.forEach(function (it) { if (it.value === null) uncosted++; else value += it.value; });
    var busiest = null;
    Object.keys(byDay).forEach(function (k) {
      if (k.slice(0, 7) !== iso(view.y, view.m, 1).slice(0, 7)) return;
      if (!busiest || byDay[k].length > byDay[busiest].length) busiest = k;
    });
    UI.tween("cal-sum", [items.length, value], function (v, moving) {
      var n = Math.round(v[0]);
      var parts = [];
      if (!items.length) parts.push(t("Nothing expires this month."));
      else {
        parts.push(tn(n, "{n} batch expires this month, worth {value} at cost.", "{n} batches expire this month, worth {value} at cost.", { value: money(Math.round(v[1] / 100) * 100) }));
        if (busiest && byDay[busiest].length > 1) parts.push(t("Busiest day: {day} ({batches}).", { day: fmtShortDay.format(Inv.parseISO(busiest)), batches: tn(byDay[busiest].length, "{n} batch", "{n} batches") }));
      }
      sumEl.textContent = parts.join(" ");
      sumEl.setAttribute("aria-busy", String(moving));
    });
  }

  // ---------- the chosen day ----------
  function renderDay() {
    var items = byDay[selected] || [];
    var d = Inv.parseISO(selected);
    var past = selected < todayISO;
    var head = '<h3 class="calday__title">' + esc(fmtDay.format(d)) + "</h3>";
    var note;
    if (!items.length) note = '<p class="calday__note">' + (selected === todayISO ? t("Nothing expires today.") : t("Nothing expires on this day.")) + "</p>";
    else if (past) note = '<p class="calday__note calday__note--past">' + tn(items.length, "{n} batch expired on this day. If it’s still on the shelf, open it and record it as thrown away or returned.", "{n} batches expired on this day. If they’re still on the shelf, open them and record them as thrown away or returned.") + "</p>";
    else note = '<p class="calday__note">' + tn(items.length, "{n} batch expires on this day.", "{n} batches expire on this day.") + "</p>";
    var list = items.map(function (it) {
      var facts = [Store.amount(it.b.qty, it.p.unit)];
      if (it.b.lot) facts.push(t("Batch {lot}", { lot: it.b.lot }));
      if (it.b.supplier) facts.push(it.b.supplier);
      if (it.value !== null) facts.push(money(it.value));
      return '<li class="calday__item calday__item--' + it.level.id + '">' +
        '<span class="calday__mark" aria-hidden="true"></span>' +
        '<span class="calday__what"><b>' + esc(it.p.name) + "</b><span>" + esc(facts.join(" · ")) + "</span></span>" +
        '<span class="calday__level">' + esc(t(it.level.label)) + "</span>" +
        '<a class="calday__go" href="demo.html#batch=' + it.b.id + '" data-page-link>' + t("Open on the shelf") + ' <span aria-hidden="true">→</span></a></li>';
    }).join("");
    dayEl.innerHTML = head + note + (list ? '<ul class="calday__list">' + list + "</ul>" : "");
    UI.enter(dayEl, ":scope > *, .calday__item");
  }

  function select(key, focus) {
    var monthOf = key.slice(0, 7), shown = iso(view.y, view.m, 1).slice(0, 7);
    selected = key;
    if (monthOf !== shown) {
      var d = Inv.parseISO(key);
      var dir = monthOf > shown ? 1 : -1;
      view = { y: d.getFullYear(), m: d.getMonth() };
      renderMonth(dir);
      if (focus) setTimeout(function () { var b = gridEl.querySelector('[data-day="' + key + '"]'); if (b) b.focus(); }, reduced ? 0 : 200);
    } else {
      Array.prototype.forEach.call(gridEl.querySelectorAll(".cal__day"), function (b) {
        var on = b.getAttribute("data-day") === key;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-pressed", String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
    }
    renderDay();
  }

  // ---------- controls ----------
  gridEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-day]");
    if (b) select(b.getAttribute("data-day"), false);
  });
  // arrow keys move a day / a week; Home/End go to the start/end of the week
  gridEl.addEventListener("keydown", function (e) {
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    var d = Inv.parseISO(selected);
    if (step) d.setDate(d.getDate() + step);
    else if (e.key === "Home") d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    else if (e.key === "End") d.setDate(d.getDate() + 6 - (d.getDay() + 6) % 7);
    else return;
    e.preventDefault();
    select(Inv.toISO(d), true);
  });
  $("[data-cal-prev]").addEventListener("click", function () { shiftMonth(-1); });
  $("[data-cal-next]").addEventListener("click", function () { shiftMonth(1); });
  $("[data-cal-today]").addEventListener("click", function () { select(todayISO, true); });
  function shiftMonth(dir) {
    view = { y: view.y, m: view.m + dir };
    var d = new Date(view.y, view.m, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    // keep the chosen day in view: the first day with stock that month, or the 1st
    var keys = Object.keys(byDay).filter(function (k) { return k.slice(0, 7) === Inv.toISO(d).slice(0, 7); }).sort();
    selected = keys[0] || Inv.toISO(d);
    if (Inv.toISO(d).slice(0, 7) === todayISO.slice(0, 7)) selected = todayISO;
    renderMonth(dir);
    renderDay();
  }

  // ---------- the next 7 days, at a glance ----------
  (function week() {
    var weekEl = document.querySelector("[data-cal-week]");
    if (!weekEl) return;
    var html = "";
    for (var i = 0; i < 7; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var key = Inv.toISO(d);
      var items = byDay[key] || [];
      var worst = items[0] ? items[0].level.id : "none";
      html += '<button type="button" class="calweek__day calweek__day--' + worst + '" data-week-day="' + key + '" style="--i:' + i + ';--n:' + Math.min(items.length, 5) + '">' +
        '<span class="calweek__name">' + esc(i === 0 ? t("Today") : i === 1 ? t("Tomorrow") : fmtWeekday.format(d)) + "</span>" +
        '<span class="calweek__bar" aria-hidden="true"><i></i></span>' +
        '<span class="calweek__count">' + (items.length ? tn(items.length, "{n} batch", "{n} batches") : "—") + "</span></button>";
    }
    weekEl.innerHTML = html;
    weekEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-week-day]");
      if (!b) return;
      select(b.getAttribute("data-week-day"), true);
      var cal = document.querySelector("[data-calendar]");
      if (cal.getBoundingClientRect().top < 0 || cal.getBoundingClientRect().top > window.innerHeight * 0.6) cal.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    // the bars grow once the page has introduced itself
    SL.whenLoaded(function () { setTimeout(function () { weekEl.classList.add("is-grown"); }, reduced ? 0 : 500); });
  })();

  renderMonth(0);
  renderDay();
})();
