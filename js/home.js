/*
 * Homepage hero scene: "Time leaves a trace".
 *
 * A shelf of abstract products, each with a printed best-before tag.
 *   1. On load the shelf is stocked, one product after another.
 *   2. Scrolling moves "today" forward a week. Tags count down; products whose
 *      date passes are struck through, fade and lean — overlooked.
 *   3. A single line passes over the shelf and puts what is left in order:
 *      expired stock comes off, the rest lines up by date, soonest marked first.
 * Large screens: the hero stays in place while you scroll through it.
 * Small/short screens and reduced motion: the scene plays as it passes through view.
 * Purely illustrative — it uses no inventory data and shows no statistics.
 */
(function () {
  var SL = window.SL;
  var scene = document.querySelector("[data-scene]");
  if (!SL || !scene) return;

  var shelf = scene.querySelector("[data-scene-shelf]");
  var dateEl = scene.querySelector("[data-scene-date]");
  var caption = scene.querySelector("[data-scene-caption]");
  var track = document.querySelector("[data-hero-track]");
  var reduced = SL.reduced;
  var stickyMQ = window.matchMedia("(min-width: 900px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)");

  var DAYS = 7;          // how far "today" moves
  var ORDER_AT = 0.7;    // scroll progress at which the shelf is put in order

  var today = new Date();
  function addDays(n) { var d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d.setDate(d.getDate() + n); return d; }
  var fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

  // Abstract silhouettes (viewBox = w × h). `band` adds a paper label strip.
  var SHAPES = {
    bottle: { w: 44, h: 96, d: "M14 0h16v10c0 4 14 10 14 24v58a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V34C0 20 14 14 14 10z", band: [6, 50, 32, 20] },
    carton: { w: 46, h: 88, d: "M10 0h26v4H10zM0 22 10 6h26l10 16v66H0z", band: [5, 40, 36, 24] },
    jar: { w: 58, h: 62, d: "M6 0h46v10H6zM2 12h54a2 2 0 0 1 2 2v42a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V14a2 2 0 0 1 2-2z", band: [6, 26, 46, 20] },
    can: { w: 40, h: 64, d: "M0 6a20 6 0 0 1 40 0v52a20 6 0 0 1-40 0z", band: [0, 22, 40, 18] },
    loaf: { w: 82, h: 46, d: "M0 46V24C0 8 18 0 41 0s41 8 41 24v22z" },
    oil: { w: 30, h: 112, d: "M11 0h8v8l-1 2v14c6 6 12 12 12 22v62a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V46c0-10 6-16 12-22V10l-1-2z", band: [4, 62, 22, 22] },
    box: { w: 56, h: 100, d: "M0 0h56v100H0z", band: [6, 30, 44, 28] },
    tub: { w: 60, h: 44, d: "M0 0h60v6H0zM2 7h56l-5 37H7z", band: [8, 18, 44, 12] },
    pouch: { w: 48, h: 70, d: "M4 8C4 3 8 0 12 0h24c4 0 8 3 8 8l4 62H0z", band: [8, 32, 32, 16] }
  };

  // The shelf as it is found: a little disordered. `off` = days until its printed date.
  var ITEMS = [
    { shape: "jar", off: 34, tilt: -2 },
    { shape: "loaf", off: 2, tilt: 1 },
    { shape: "can", off: 120, tilt: 0 },
    { shape: "carton", off: 8, tilt: -3 },
    { shape: "oil", off: 60, tilt: 2 },
    { shape: "tub", off: 5, tilt: 0 },
    { shape: "box", off: 24, tilt: 1.5 },
    { shape: "bottle", off: 3, tilt: -1 },
    { shape: "pouch", off: 13, tilt: 3 }
  ];

  // ---------- Build ----------
  ITEMS.forEach(function (it, i) {
    var s = SHAPES[it.shape];
    var el = document.createElement("div");
    el.className = "item";
    el.style.setProperty("--w", s.w);
    el.style.setProperty("--h", s.h);
    el.style.setProperty("--tilt", it.tilt + "deg");
    el.style.setProperty("--i", i);
    el.innerHTML =
      '<svg class="item__shape" viewBox="0 0 ' + s.w + " " + s.h + '"><path d="' + s.d + '"/>' +
      (s.band ? '<rect class="item__band" x="' + s.band[0] + '" y="' + s.band[1] + '" width="' + s.band[2] + '" height="' + s.band[3] + '" rx="1"/>' : "") +
      "</svg>" +
      '<span class="tag"><span class="tag__date">' + fmt.format(addDays(it.off)).toUpperCase() + '</span><span class="tag__left"></span></span>';
    shelf.insertBefore(el, shelf.querySelector(".scene__plank"));
    it.el = el;
    it.left = el.querySelector(".tag__left");
  });

  function slotLeft(slot, count) { return 6 + ((slot + 0.5) * 88) / count; }   // % across the shelf

  // ---------- State for a given progress p (0…1) ----------
  var lastPhase = null;
  var lastDay = -1;
  var lastOrdered = null;

  function apply(p) {
    var day = Math.round(Math.min(p / ORDER_AT, 1) * DAYS);
    var ordered = p >= ORDER_AT;
    // scrolling calls this every frame; only touch the page when the day or the order changes
    if (day === lastDay && ordered === lastOrdered) return;
    lastOrdered = ordered;

    if (day !== lastDay) {
      dateEl.textContent = fmt.format(addDays(day));
      if (lastDay !== -1 && !reduced) { dateEl.classList.remove("is-tick"); void dateEl.offsetWidth; dateEl.classList.add("is-tick"); }
      lastDay = day;
    }

    var remaining = ITEMS.filter(function (it) { return it.off - day >= 0; })
      .sort(function (a, b) { return a.off - b.off; });

    ITEMS.forEach(function (it, i) {
      var left = it.off - day;
      var expired = left < 0;
      it.left.textContent = expired ? "expired" : left === 0 ? "today" : left === 1 ? "1 day" : left + " days";
      it.el.classList.toggle("is-expired", expired);
      it.el.classList.toggle("is-near", !expired && left <= 2);
      it.el.classList.toggle("is-gone", ordered && expired);
      it.el.classList.toggle("is-first", ordered && remaining[0] === it);
      it.el.classList.toggle("is-ordered", ordered);
      var slot = ordered && !expired ? remaining.indexOf(it) : i;
      var count = ordered && !expired ? remaining.length : ITEMS.length;
      it.el.style.left = slotLeft(slot, count) + "%";
    });

    var phase = ordered ? "ordered" : day > 0 ? "passing" : "still";
    if (phase !== lastPhase) {
      caption.textContent = {
        still: stickyMQ.matches ? "Scroll, and let a week go by." : "Keep scrolling, and let a week go by.",
        passing: "A week goes by. Nobody checks the back of the shelf.",
        ordered: "Same shelf, in order — what needs you first, first."
      }[phase];
      caption.classList.remove("is-new"); void caption.offsetWidth; caption.classList.add("is-new");
      // the line that puts things in order passes once each time the shelf is sorted
      if (phase === "ordered" && !reduced) { shelf.classList.remove("is-scanning"); void shelf.offsetWidth; shelf.classList.add("is-scanning"); }
      scene.setAttribute("data-phase", phase);
      lastPhase = phase;
    }
  }

  // ---------- Progress from scroll ----------
  function progress(vh) {
    if (reduced) return 1;
    if (stickyMQ.matches) {
      var r = track.getBoundingClientRect();
      return SL.clamp(-r.top / Math.max(r.height - vh, 1), 0, 1);
    }
    // Not pinned: time passes while the shelf travels from three-quarters down the view to near
    // the top, so it starts at "today" on load and is sorted while still in full view.
    var shelfY = shelf.getBoundingClientRect().top + window.scrollY;
    var startY = Math.max(0, shelfY - vh * 0.78);       // never before the top of the page
    return SL.clamp((window.scrollY - startY) / (vh * 0.6), 0, 1);
  }

  apply(0);
  SL.onScroll(function (vh) { apply(progress(vh)); });
  stickyMQ.addEventListener("change", function () { lastPhase = null; lastDay = -1; lastOrdered = null; apply(progress(window.innerHeight)); });

  // Stock the shelf once the page has introduced itself.
  SL.whenLoaded(function () { scene.classList.add("is-stocked"); });
})();

/* ---------- Inside the app: four pictures that come alive as they scroll in ---------- */
(function () {
  var SL = window.SL;
  var features = document.querySelectorAll("[data-feature]");
  if (!SL || !features.length) return;
  var reduced = SL.reduced;

  // the mini calendar: five weeks, with a few days carrying expiry dots and today circled
  var cal = document.querySelector("[data-art-cal]");
  if (cal) {
    var DOTS = { 3: ["expired"], 9: ["critical"], 10: ["critical", "high"], 12: ["high"], 17: ["medium", "medium", "high"], 22: ["low"], 26: ["low", "medium"], 31: ["low"] };
    var html = "";
    ["M", "T", "W", "T", "F", "S", "S"].forEach(function (d) { html += '<span class="art-cal__wd">' + d + "</span>"; });
    for (var i = 0; i < 35; i++) {
      var dots = (DOTS[i] || []).map(function (k, j) { return '<i class="art-cal__dot art-cal__dot--' + k + '" style="--j:' + j + '"></i>'; }).join("");
      html += '<span class="art-cal__day' + (i === 8 ? " is-today" : "") + (i < 2 || i > 32 ? " is-other" : "") + '" style="--d:' + (Math.floor(i / 7) + i % 7) + '">' +
        "<b>" + ((i + 29) % 31 + 1) + "</b>" + (dots ? "<span>" + dots + "</span>" : "") + "</span>";
    }
    cal.innerHTML = html;
  }

  // numbers count up from zero when their picture arrives
  var fmt = new Intl.NumberFormat("en-IN");
  function countUp(el) {
    var to = +el.getAttribute("data-count-to");
    if (reduced || !to) { el.textContent = "₹" + fmt.format(to); return; }
    var t0 = 0;
    requestAnimationFrame(function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / 1100), e = 1 - Math.pow(1 - p, 3);
      el.textContent = "₹" + fmt.format(Math.round(to * e));
      if (p < 1) requestAnimationFrame(frame);
    });
  }

  function arrive(f) {
    f.classList.add("is-in");
    Array.prototype.forEach.call(f.querySelectorAll("[data-count-to]"), function (el) { setTimeout(function () { countUp(el); }, reduced ? 0 : 450); });
  }
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { arrive(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.3, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(features, function (f) { io.observe(f); });
  } else {
    Array.prototype.forEach.call(features, arrive);
  }
})();
