/*
 * ShelfLife Radar — English / हिंदी.
 *
 * Loaded before every other script. The English text is the key: t("Add product") returns the
 * Hindi line when Hindi is on, and the English otherwise — so a missing translation shows
 * English, never a blank. {name} placeholders are filled from params.
 *
 * Fixed text in the page is marked up:  data-t (text), data-t-html (text with inline tags),
 * data-t-attr="placeholder,aria-label" (attributes). Product names, batch numbers and supplier
 * names are what the shop typed and are never translated.
 *
 * The choice is remembered in this browser; switching reloads the page so every part,
 * including the animated headline, is built in the new language.
 */
(function () {
  var KEY = "shelflife-lang";
  var lang = "en";
  try { if (localStorage.getItem(KEY) === "hi") lang = "hi"; } catch (e) {}

  var HI = window.SL_HI || {};      // the dictionary (i18n-hi.js)
  var missing = {};                  // keys asked for in Hindi with no translation (for testing)
  var fmtN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return k in params ? params[k] : m; });
  }
  function t(key, params) {
    var s = key;
    if (lang === "hi") {
      if (Object.prototype.hasOwnProperty.call(HI, key)) s = HI[key];
      else missing[key] = true;
    }
    return fill(s, params);
  }
  // tn(3, "{n} batch", "{n} batches") → "3 batches" / "3 बैच"
  function tn(n, one, many, params) {
    var p = { n: fmtN.format(n) };
    if (params) for (var k in params) p[k] = params[k];
    return t(n === 1 ? one : many, p);
  }
  function norm(s) { return s.replace(/\s+/g, " ").trim(); }

  function applyPage() {
    document.documentElement.lang = lang;
    var sw = document.querySelector("[data-lang-switch]");
    if (sw) {
      sw.textContent = lang === "hi" ? "English" : "हिंदी";
      sw.setAttribute("lang", lang === "hi" ? "en" : "hi");
      sw.setAttribute("aria-label", lang === "hi" ? "Switch to English" : "हिंदी में देखें — switch to Hindi");
      sw.addEventListener("click", function () {
        try { localStorage.setItem(KEY, lang === "hi" ? "en" : "hi"); } catch (e) {}
        location.reload();
      });
    }
    if (lang === "en") return;
    document.querySelectorAll("[data-t]").forEach(function (el) { el.textContent = t(norm(el.textContent)); });
    document.querySelectorAll("[data-t-html]").forEach(function (el) { el.innerHTML = t(norm(el.innerHTML)); });
    document.querySelectorAll("[data-t-attr]").forEach(function (el) {
      el.getAttribute("data-t-attr").split(",").forEach(function (a) {
        a = a.trim();
        if (el.hasAttribute(a)) el.setAttribute(a, t(norm(el.getAttribute(a))));
      });
    });
  }
  applyPage();

  window.SLi18n = {
    lang: lang,
    locale: lang === "hi" ? "hi-IN" : "en-GB",
    t: t, tn: tn, missing: missing
  };
})();
