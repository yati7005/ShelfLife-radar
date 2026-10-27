/*
 * ShelfLife Radar — the frame shared by the app pages: the tab bar (Shelf · Calendar ·
 * Insights · Settings) and the "Install app" button.
 *
 * The tab bar is built here so every page gets the same one. Its underline slides from the
 * tab you came from to the one you're on (the last tab is remembered for this browser tab).
 * On phones it sits at the bottom of the screen, under the thumb.
 */
(function () {
  var SL = window.SL, I18n = window.SLi18n, Store = window.SLStore, UI = window.SLUI;
  var nav = document.querySelector("[data-apptabs]");
  if (!SL || !I18n || !nav) return;
  var t = I18n.t;
  var reduced = SL.reduced;

  var ICON = {
    shelf: '<path d="M3 16.5h14M3 9.5h14" /><rect x="5" y="4" width="3.4" height="5.5" rx=".4" /><rect x="10.2" y="6" width="4" height="3.5" rx=".4" /><rect x="5.4" y="11.6" width="4.8" height="4.9" rx=".4" /><rect x="12" y="12.6" width="3" height="3.9" rx=".4" />',
    calendar: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8.5h14M7 2.5v4M13 2.5v4" /><circle cx="7.5" cy="12.5" r=".9" class="fill" /><circle cx="12.5" cy="12.5" r=".9" class="fill" />',
    insights: '<path d="M3.5 16.5h13M6.2 16.5v-5M10 16.5V6M13.8 16.5V9" />',
    settings: '<path d="M4 6h12M4 14h12" /><circle cx="8" cy="6" r="2" class="knob" /><circle cx="12.5" cy="14" r="2" class="knob" />'
  };
  var TABS = [
    { id: "shelf", href: "demo.html", label: "Shelf" },
    { id: "calendar", href: "calendar.html", label: "Calendar" },
    { id: "insights", href: "insights.html", label: "Insights" },
    { id: "settings", href: "settings.html", label: "Settings" }
  ];
  var current = nav.getAttribute("data-apptabs");
  nav.innerHTML = '<div class="apptabs__inner">' + TABS.map(function (tab) {
    return '<a class="apptab" href="' + tab.href + '" data-page-link data-tab="' + tab.id + '"' + (tab.id === current ? ' aria-current="page"' : "") + ">" +
      '<svg viewBox="0 0 20 20" aria-hidden="true">' + ICON[tab.id] + "</svg><span>" + t(tab.label) + "</span>" +
      (tab.id === "settings" ? '<i class="apptab__dot" data-backup-due hidden></i>' : "") + "</a>";
  }).join("") + '<span class="apptabs__bar" aria-hidden="true"></span></div>';

  var bar = nav.querySelector(".apptabs__bar");
  var KEY = "shelflife-tab";
  function tabEl(id) { return nav.querySelector('[data-tab="' + id + '"]'); }
  function place(el, instant) {
    if (!el) return;
    if (instant) bar.classList.add("no-anim");
    bar.style.width = el.offsetWidth + "px";
    bar.style.transform = "translateX(" + el.offsetLeft + "px)";
    if (instant) { void bar.offsetWidth; bar.classList.remove("no-anim"); }
  }
  // arrive: start under the tab we came from, then slide to this one
  var from = null;
  try { from = sessionStorage.getItem(KEY); } catch (e) {}
  place(tabEl(from && from !== current && !reduced ? from : current), true);
  SL.whenLoaded(function () { place(tabEl(current)); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(tabEl(current), true); });
  window.addEventListener("resize", function () { place(tabEl(current), true); });
  // leave: remember this tab, and send the underline toward the one clicked
  nav.addEventListener("click", function (e) {
    var a = e.target.closest("[data-tab]");
    if (!a) return;
    try { sessionStorage.setItem(KEY, current); } catch (err) {}
    if (a.getAttribute("data-tab") !== current) place(a);
  });

  // A small dot on Settings when the shop's data hasn't been backed up for a week (or ever).
  (function backupDue() {
    var dot = nav.querySelector("[data-backup-due]");
    var raw = null, last = null;
    try { raw = localStorage.getItem(Store ? Store.KEY : "shelflife-radar-demo-v1"); last = localStorage.getItem("shelflife-last-backup"); } catch (e) { return; }
    var customized = false;
    try { customized = !!(raw && JSON.parse(raw).products); } catch (e) {}
    var days = last ? (Date.now() - new Date(last).getTime()) / 864e5 : Infinity;
    var due = customized && !(days < 7);
    dot.hidden = !due;
    if (due) dot.parentNode.setAttribute("aria-label", t("Settings — a backup is due"));
  })();

  // The shop's own name, if it has one (read straight from what's saved, without loading everything).
  (function shopName() {
    var name = "", own = false;
    try {
      var saved = JSON.parse(localStorage.getItem(Store ? Store.KEY : "shelflife-radar-demo-v1") || "null");
      name = saved && typeof saved.shop === "string" ? saved.shop.slice(0, 60) : "";
      own = !!(saved && saved.own === true);              // set when a shop of its own was started (store.js empty())
    } catch (e) {}
    if (UI && (name || own)) UI.showShop(name, own);
  })();

  // Sections on the app pages draw their headings in as they scroll into view (styles in demo.css).
  var blocks = document.querySelectorAll(".pageblock:not(.is-in)");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    Array.prototype.forEach.call(blocks, function (b) { io.observe(b); });
  } else {
    Array.prototype.forEach.call(blocks, function (b) { b.classList.add("is-in"); });
  }

  // ---------- Install as an app (only where the browser offers it) ----------
  var installBtn = document.querySelector("[data-install]");
  var installPrompt = null;
  if (installBtn) {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();                  // show our own button instead of the browser's banner
      installPrompt = e;
      installBtn.hidden = false;
    });
    installBtn.addEventListener("click", function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.then(function () { installPrompt = null; installBtn.hidden = true; });
    });
    window.addEventListener("appinstalled", function () {
      installBtn.hidden = true;
      if (UI) UI.toast(t("Installed — open ShelfLife Radar from your home screen."), null);
    });
  }
})();
