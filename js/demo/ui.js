/*
 * ShelfLife Radar — small interface pieces shared by every app page (Shelf, Calendar,
 * Insights, Settings): safe text, notifications, and the motion helpers.
 * Every animation here does nothing when the user prefers reduced motion.
 */
(function () {
  var SL = window.SL;
  var t = window.SLi18n ? window.SLi18n.t : function (s) { return s; };
  var reduced = SL ? SL.reduced : false;

  // Text the shop typed goes into the page only through this.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // enter(): the children of `box` (or the elements matching sel) rise in one after another.
  function enter(box, sel) {
    if (reduced || !box) return;
    var items = sel ? box.querySelectorAll(sel) : box.children;
    Array.prototype.forEach.call(items, function (el, i) {
      el.style.setProperty("--i", Math.min(i, 12));
      el.classList.remove("is-entering");
      void el.offsetWidth;
      el.classList.add("is-entering");
      el.addEventListener("animationend", function done(ev) {
        if (ev.target !== el) return;
        el.classList.remove("is-entering");
        el.removeEventListener("animationend", done);
      });
    });
  }

  // tween(): numbers glide from their last value to the new one (from 0 the first time);
  // draw(values, moving) writes them.
  var tweens = {};
  function tween(id, target, draw) {
    var rec = tweens[id];
    if (rec && rec.raf) cancelAnimationFrame(rec.raf);
    var from = rec ? (rec.current || rec.values) : target.map(function () { return 0; });
    tweens[id] = rec = { values: target.slice(), current: null, raf: 0 };
    if (reduced || from.length !== target.length || target.every(function (v, i) { return v === from[i]; })) { draw(target, false); return; }
    var t0 = 0, D = 700;
    rec.raf = requestAnimationFrame(function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
      rec.current = target.map(function (v, i) { return from[i] + (v - from[i]) * e; });
      draw(p < 1 ? rec.current : target, p < 1);
      if (p < 1) rec.raf = requestAnimationFrame(frame); else { rec.raf = 0; rec.current = null; }
    });
  }

  // toast(): a short message at the bottom. With undo, it shows an Undo button and a line that
  // shrinks for as long as undo lasts; pointing at it (or tabbing into it) holds it.
  // opts.stale(): return true if undo no longer applies (e.g. all data was replaced since).
  function toast(message, undo, opts) {
    var box = document.querySelector("[data-toasts]");
    if (!box) return;
    var life = undo ? 6000 : 4200;
    var el = document.createElement("div");
    el.className = "toast" + (undo ? " toast--undo" : "");
    el.style.setProperty("--life", life + "ms");
    el.innerHTML = "<span>" + esc(message) + "</span>" + (undo ? '<button type="button" class="toast__undo">' + t("Undo") + "</button>" : "");
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    requestAnimationFrame(function () { el.classList.add("is-in"); });
    var left = life, started = Date.now(), done = false;
    var timer = setTimeout(dismiss, left);
    function hold() { if (done || !timer) return; clearTimeout(timer); timer = 0; left -= Date.now() - started; el.classList.add("is-held"); }
    function release() { if (done || timer) return; started = Date.now(); timer = setTimeout(dismiss, Math.max(left, 1200)); el.classList.remove("is-held"); }
    el.addEventListener("mouseenter", hold);
    el.addEventListener("mouseleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
    function dismiss() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.classList.remove("is-in");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reduced ? 0 : 300);
    }
    if (undo) el.querySelector(".toast__undo").addEventListener("click", function () {
      dismiss();
      if (opts && opts.stale && opts.stale()) { toast(t("That can’t be undone any more — all the data was replaced since."), null); return; }
      undo();
    });
  }

  // showShop(): the shop's own name above the Shelf's headline and in every page's footer.
  // own: the data is the shop's own (not the untouched sample) — then the footer never calls it fictional.
  function showShop(name, own) {
    var top = document.querySelector("[data-shop-name]");
    if (top) { top.textContent = name || ""; top.hidden = !name; }
    var foot = document.querySelector(".colophon p");
    if (!foot) return;
    if (!foot.hasAttribute("data-sample-text")) foot.setAttribute("data-sample-text", foot.textContent);
    foot.textContent = name ? t("{shop} — saved in this browser only. Back it up now and then from Settings.", { shop: name }) :
      own ? t("Saved in this browser only. Back it up now and then from Settings.") : foot.getAttribute("data-sample-text");
  }

  window.SLUI = { esc: esc, enter: enter, tween: tween, toast: toast, showShop: showShop, reduced: reduced };
})();
