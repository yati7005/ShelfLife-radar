/*
 * ShelfLife Radar — camera barcode scanning.
 *
 * Uses the browser's own BarcodeDetector (Chrome on Android, ChromeOS and macOS) — no library,
 * nothing sent anywhere. The camera only works on a secure page (https:// or localhost), so on
 * other browsers, or when the page is opened as a file, available() is false and the scan
 * buttons stay hidden. A USB barcode scanner works everywhere, because it types like a keyboard.
 */
(function () {
  var Store = window.SLStore;
  if (!Store) return;
  var t = window.SLi18n ? window.SLi18n.t : function (s) { return s; };

  var WANTED = ["ean_13", "ean_8", "upc_a", "itf"];     // retail product codes (UPC-E isn't a full GTIN)

  function available() {
    return "BarcodeDetector" in window && window.isSecureContext &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  var current = null;      // the open scanner, if any

  // onCode(code) is called once with a valid barcode; the scanner closes itself first.
  function open(onCode, trigger) {
    if (current || !available()) return;
    var el = document.createElement("div");
    el.className = "scan";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "scan-title");
    el.innerHTML =
      '<div class="scan__panel">' +
        '<p class="scan__title" id="scan-title">' + t("Scan a barcode") + "</p>" +
        '<div class="scan__view"><video playsinline muted></video><span class="scan__frame" aria-hidden="true"></span></div>' +
        '<p class="scan__msg" aria-live="polite">' + t("Starting the camera…") + "</p>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-scan-close>' + t("Cancel") + "</button>" +
      "</div>";
    document.body.appendChild(el);
    var video = el.querySelector("video");
    var msg = el.querySelector(".scan__msg");
    var closeBtn = el.querySelector("[data-scan-close]");
    var stream = null, timer = null, closed = false;
    current = { close: close };

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });     // always release the camera
      document.removeEventListener("keydown", onKey, true);
      el.parentNode.removeChild(el);
      current = null;
      if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      if (e.key === "Tab") { e.preventDefault(); closeBtn.focus(); }      // the only control in the dialog
    }
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", close);
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    closeBtn.focus({ preventScroll: true });

    var formats = BarcodeDetector.getSupportedFormats ? BarcodeDetector.getSupportedFormats() : Promise.resolve(WANTED);
    formats.then(function (supported) {
      var use = WANTED.filter(function (f) { return supported.indexOf(f) !== -1; });
      if (!use.length) throw { name: "NoFormats" };
      var detector = new BarcodeDetector({ formats: use });
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (s) {
        stream = s;
        if (closed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }   // cancelled while starting
        video.srcObject = s;
        return video.play().then(function () {
          msg.textContent = t("Hold the barcode inside the frame.");
          tick(detector);
        });
      });
    }).catch(function (err) {
      if (closed) return;
      var n = err && err.name;
      msg.textContent = t(
        n === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in the browser’s settings, or type the barcode into the search box." :
        n === "NotFoundError" || n === "OverconstrainedError" ? "No camera was found on this device. Type the barcode into the search box instead." :
        n === "NotReadableError" ? "The camera is being used by another app. Close it and try again." :
        n === "NoFormats" ? "This browser can’t read product barcodes. Type the barcode into the search box instead." :
        "The camera couldn’t be started. Type the barcode into the search box instead.");
      msg.classList.add("is-problem");
    });

    var misses = 0;
    function tick(detector) {
      if (closed) return;
      detector.detect(video).then(function (found) {
        if (closed) return;
        var code = null;
        (found || []).some(function (f) { var c = String(f.rawValue || "").trim(); if (Store.validGTIN(c)) { code = c; return true; } return false; });
        if (code) {
          if (navigator.vibrate) navigator.vibrate(60);
          close();
          onCode(code);
          return;
        }
        if (found && found.length && ++misses === 6) msg.textContent = t("That code didn’t read cleanly. Hold the phone steady, a little further away.");
        timer = setTimeout(function () { tick(detector); }, 160);
      }, function () { timer = setTimeout(function () { tick(detector); }, 400); });
    }
  }

  window.SLScan = { available: available, open: open, close: function () { if (current) current.close(); } };
})();
