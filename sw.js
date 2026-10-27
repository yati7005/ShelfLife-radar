/*
 * ShelfLife Radar — offline support (service worker).
 *
 * Keeps a copy of every file the site needs, so it opens without internet once it has been
 * visited online. Online, the site's own files come fresh from the network (so an update shows
 * straight away) and the copy is refreshed; offline, or if the network hangs, the copy is used.
 * Fonts never change, so they come from the copy first.
 * Shop data is not here: it lives in the browser's storage (localStorage).
 *
 * Only runs on a real web address (https:// or localhost), never when opened as a file.
 * When the list of files changes, bump VERSION so old copies are cleared.
 */
var VERSION = "shelflife-v8";
var FONTS = "shelflife-fonts-v2";
var FILES = [
  "./", "index.html", "demo.html", "insights.html", "settings.html", "manifest.webmanifest",
  "css/styles.css", "css/home.css", "css/demo.css", "css/app.css",
  "js/main.js", "js/home.js",
  "js/demo/i18n-hi.js", "js/demo/i18n.js", "js/demo/inventory.js", "js/demo/store.js",
  "js/demo/csv.js", "js/demo/scan.js", "js/demo/ui.js", "js/demo/shell.js",
  "js/demo/app.js", "js/demo/insights.js", "js/demo/settings.js",
  "assets/favicon.svg", "assets/icon-192.png", "assets/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("shelflife-") === 0 && k !== VERSION && k !== FONTS; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Answer from the saved copy if there is one, and refresh it from the network in the background.
// ignoreSearch: our own files ignore "?…"; font stylesheets must match exactly, because each page
// asks for a different set of fonts in its query string.
function fromCacheThenRefresh(req, cacheName, fallback, ignoreSearch) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req, { ignoreSearch: ignoreSearch }).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit || (fallback ? cache.match(fallback) : undefined); });
      return hit || fresh;
    });
  });
}

// Our own files: fresh from the network when it answers within a few seconds, else the saved copy.
function fromNetworkThenCache(req, fallback) {
  return caches.open(VERSION).then(function (cache) {
    function saved() {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (fallback ? cache.match(fallback) : undefined); });
    }
    var net = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    var slow = new Promise(function (resolve) { setTimeout(resolve, 4000); }).then(saved);
    return Promise.race([net, slow]).then(function (res) { return res || net; }).catch(saved);
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // an address with no saved copy, opened offline, gets the demo page
    e.respondWith(fromNetworkThenCache(req, req.mode === "navigate" ? "demo.html" : null));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(fromCacheThenRefresh(req, FONTS, null, false));
  }
});
