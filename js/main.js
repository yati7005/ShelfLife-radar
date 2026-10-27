/*
 * Page-level motion: word reveals, scroll reveals, nav state, scroll-linked effects.
 * Exposes window.SL with small helpers used by hero.js and story.js.
 */
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  // ---- One rAF-throttled loop for every scroll-linked effect ----
  var tasks = [];
  var queued = false;
  function run() {
    queued = false;
    var vh = window.innerHeight;
    for (var i = 0; i < tasks.length; i++) tasks[i](vh);
  }
  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);

  window.SL = {
    reduced: reduced,
    clamp: clamp,
    onScroll: function (fn) { tasks.push(fn); queue(); }
  };

  // ---- Light / dark ----
  // The script in <head> already chose before the first paint: the choice saved in this browser,
  // else the phone's own setting. The moon/sun button switches; picking what the phone already
  // uses forgets the choice, so the page follows the phone again.
  var THEME_KEY = "shelflife-theme";
  var root = document.documentElement;
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  function savedTheme() {
    try { var t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : null; } catch (e) { return null; }
  }
  function wantedTheme() { return savedTheme() || (darkQuery.matches ? "dark" : "light"); }
  function paintTheme(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#16151C" : "#F5F1E8");
    var label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    if (window.SLi18n) label = SLi18n.t(label);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", label);
      b.title = label;
    });
  }
  paintTheme(wantedTheme());
  // follow the phone when it changes (unless a choice is saved), and other open tabs of the site
  function followTheme() { if (root.getAttribute("data-theme") !== wantedTheme()) paintTheme(wantedTheme()); }
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", followTheme);
  else if (darkQuery.addListener) darkQuery.addListener(followTheme);
  window.addEventListener("storage", function (e) { if (e.key === THEME_KEY || e.key === null) followTheme(); });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try {
      if (next === (darkQuery.matches ? "dark" : "light")) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch (err) {}
    if (reduced || !document.startViewTransition) { paintTheme(next); return; }
    // the new look spreads out in a circle from the button
    var r = btn.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    var vt = document.startViewTransition(function () { paintTheme(next); });
    vt.ready.then(function () {
      root.animate(
        { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + radius + "px at " + x + "px " + y + "px)"] },
        { duration: 700, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(function () {});
  });

  // ---- Offline and "install as an app": a copy of the site (sw.js) and the app's details
  // (manifest.webmanifest). Browsers only allow these on a real web address, not on a page
  // opened as a file, so there it does nothing (and doesn't ask for files it can't read). ----
  if (/^https?:$/.test(location.protocol)) {
    var manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "manifest.webmanifest";
    document.head.appendChild(manifest);
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
    }
  }

  // ---- Split headings into words so they can rise in one after another ----
  function split(el) {
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
            var w = document.createElement("span");
            var inner = document.createElement("span");
            w.className = "w";
            inner.className = "w__i";
            inner.style.setProperty("--wi", n++);
            inner.textContent = part;
            w.appendChild(inner);
            frag.appendChild(w);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          walk(child);
        }
      });
    })(el);
  }
  document.querySelectorAll("[data-split]").forEach(split);

  // Hero plays once the web fonts are in (so the headline doesn't reflow mid-animation),
  // or after 700ms at most; two frames later so the hidden state is painted first.
  var loaded = false;
  var loadedFns = [];
  // Run fn once the entrance animations have started (used by the demo's counters).
  SL.whenLoaded = function (fn) { if (loaded) fn(); else loadedFns.push(fn); };

  function playHero() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.add("is-loaded");
        loaded = true;
        loadedFns.splice(0).forEach(function (fn) { fn(); });
      });
    });
  }
  // Fonts are cached after the first page, so this wait is usually a few milliseconds;
  // the cap keeps a slow font from ever leaving the page blank.
  if (document.fonts && document.fonts.ready && !reduced) {
    Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 350); })]).then(playHero);
  } else {
    playHero();
  }

  // ---- Page transitions between the homepage and the demo ----
  // Exit: a paper sheet wipes up over the page (CSS .is-leaving), then the browser navigates.
  // Entry: the sheet lifts off the new page (CSS html::after). Plain links, so direct visits,
  // refreshes, new tabs and back/forward all behave normally.
  var LEAVE_MS = 380;
  var leaving = false;
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-page-link]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
    e.preventDefault();
    if (leaving) return;                       // a double click doesn't restart the exit
    leaving = true;
    var href = a.href;
    if (reduced) { window.location.href = href; return; }
    document.documentElement.classList.add("is-leaving");
    setTimeout(function () { window.location.href = href; }, LEAVE_MS);
  });
  // Back/forward can restore a page from the browser's cache mid-fade: undo it and play the entrance again.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) followTheme();            // the theme may have been switched on another page meanwhile
    leaving = false;
    document.documentElement.classList.remove("is-leaving");
    if (e.persisted && !reduced && document.body.animate) {
      document.body.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
        { duration: 450, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
  });

  // ---- Scroll reveals: [data-reveal] and split headings get .is-in once ----
  var revealables = document.querySelectorAll("[data-reveal], [data-split]:not([data-hero])");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-in"); });
  }

  // ---- Nav: background once scrolled, highlight the section in view ----
  var nav = document.querySelector("[data-nav]");
  var spyLinks = document.querySelectorAll("[data-spy]");
  SL.onScroll(function (vh) {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 10); // the demo page has no top nav
    var current = null;
    spyLinks.forEach(function (a) {
      var r = document.getElementById(a.getAttribute("data-spy")).getBoundingClientRect();
      if (r.top < vh * 0.5 && r.bottom > vh * 0.5) current = a;
    });
    spyLinks.forEach(function (a) {
      a.classList.toggle("is-active", a === current);
      if (a === current) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  });

  // ---- Pause looping animations while they're off-screen ----
  SL.pauseOffscreen = function (el) {
    if (!el || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (e) {
      el.classList.toggle("is-paused", !e[0].isIntersecting);
    }).observe(el);
  };
})();
