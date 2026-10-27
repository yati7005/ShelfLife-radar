/*
 * ShelfLife Radar — Settings: the shop's data as a whole.
 *
 * Backup and restore, spreadsheet import and export, and starting over — moved here from
 * the Shelf so the Shelf is only about stock. The same safety rules apply: every change is
 * checked first and shown before it's made, a copy of the current data is kept before
 * anything is replaced, and undo puts back exactly what was there.
 */
(function () {
  var Inv = window.SLInventory, Store = window.SLStore, Csv = window.SLCsv, I18n = window.SLi18n, UI = window.SLUI, SL = window.SL;
  var root = document.querySelector("[data-settings]");
  if (!Inv || !Store || !Csv || !I18n || !UI || !SL || !root) return;
  var t = I18n.t, tn = I18n.tn, esc = UI.esc;
  var reduced = SL.reduced;
  var LOC = I18n.locale;

  var today = new Date();
  var fmtFull = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "long", year: "numeric" });
  var fmtTime = new Intl.DateTimeFormat(LOC, { hour: "2-digit", minute: "2-digit" });
  var LAST_BACKUP = "shelflife-last-backup";

  var data = Store.load(today);
  if (!data.sales) data.sales = [];
  var gen = 0;                          // goes up with every change here, so an older undo can't overwrite a newer change

  function save() {
    if (!Store.save(data)) UI.toast(t("Couldn’t save — this browser’s storage is full or blocked. Changes will be lost when you leave."), null);
  }
  function snapshot() {
    return JSON.stringify({ products: data.products, batches: data.batches, statuses: data.statuses, writeoffs: data.writeoffs,
      sales: data.sales || [], shop: data.shop || "", own: !!data.own, customized: data.customized });
  }
  function restoreSnapshot(s) {
    var o = JSON.parse(s);
    data.products = o.products; data.batches = o.batches; data.statuses = o.statuses; data.writeoffs = o.writeoffs;
    data.sales = o.sales; data.shop = o.shop; data.own = o.own; data.customized = o.customized;
    save();
  }
  // the shop's name, everywhere it shows, always matches the data (after a restore, reset or undo too)
  function syncShop() {
    UI.showShop(data.shop || "", data.own);
    nameForm.elements.shop.value = data.shop || "";
  }
  // a change with undo: undo applies only while nothing else has changed since
  function changed(message, before) {
    var mine = ++gen;
    UI.toast(message, function () {
      if (mine !== gen) { UI.toast(t("That can’t be undone any more — something changed since."), null); return; }
      restoreSnapshot(before);
      gen++;
      renderAll();
    });
    renderAll();
  }
  function setPanel(el, html, focusSel) {
    el.innerHTML = html;
    UI.enter(el, ":scope > *");
    var f = focusSel && el.querySelector(focusSel);
    if (f) f.focus({ preventScroll: true });
  }
  function lastBackup() {
    var d = null;
    try { d = new Date(localStorage.getItem(LAST_BACKUP) || ""); } catch (e) {}
    return d && !isNaN(d) ? d : null;
  }
  function contents(d) {
    var parts = [tn(d.products.length, "{n} product", "{n} products"), tn(d.batches.length, "{n} batch", "{n} batches"),
      tn(d.writeoffs.length, "{n} write-off", "{n} write-offs")];
    if (d.sales && d.sales.length) parts.push(tn(d.sales.length, "{n} sale recorded", "{n} sales recorded"));
    return parts.join(", ");
  }
  function csvName(kind) { return "shelflife-" + kind + "-" + Inv.toISO(today) + ".csv"; }

  // ---------- 1. your data ----------
  var summaryEl = root.querySelector("[data-set-summary]");
  var dueEl = root.querySelector("[data-set-due]");
  function renderSummary() {
    UI.tween("set-counts", [data.products.length, data.batches.length, data.writeoffs.length], function (v, moving) {
      summaryEl.innerHTML =
        '<span class="count"><b>' + Math.round(v[0]) + "</b>" + esc(t(Math.round(v[0]) === 1 ? "product" : "products")) + "</span>" +
        '<span class="count"><b>' + Math.round(v[1]) + "</b>" + esc(t(Math.round(v[1]) === 1 ? "batch" : "batches")) + "</span>" +
        '<span class="count"><b>' + Math.round(v[2]) + "</b>" + esc(t(Math.round(v[2]) === 1 ? "write-off" : "write-offs")) + "</span>";
      summaryEl.setAttribute("aria-busy", String(moving));
    });
    var last = lastBackup();
    var days = last ? (Date.now() - last.getTime()) / 864e5 : Infinity;
    var due = data.customized && !(days < 7);
    dueEl.className = "set__due" + (due ? " is-due" : "");
    dueEl.textContent = !data.customized ? t("You’re looking at the demo’s sample stock. Once you change it, back it up now and then.") :
      !last ? t("No backup yet. Download one now — it takes a second.") :
      due ? t("Your last backup was on {date} — over a week ago. Download a new one.", { date: fmtFull.format(last) }) :
      t("Last backup: {date}. You’re covered.", { date: fmtFull.format(last) });
  }

  // ---------- 2. backup and restore ----------
  var backupEl = root.querySelector("[data-set-backup]");
  var pendingRestore = null;
  function backupHTML(problem) {
    return (problem ? '<p class="io__problem" role="alert">' + esc(problem) + "</p>" : "") +
      '<p class="io__text">' + t("Everything is saved only in this browser. If its data is cleared, or you change phones, it’s gone — so download a backup now and then and keep it somewhere safe, like your email or Google Drive.") + "</p>" +
      '<div class="pform__actions"><button type="button" class="btn btn--primary btn--sm" data-backup-download>' + t("Download backup") + "</button>" +
      '<label class="btn btn--ghost btn--sm io__file">' + t("Restore from a backup") + '<input type="file" accept=".json,application/json" class="io__input" data-restore-file></label></div>';
  }
  function restoreHTML(name, r) {
    var from = r.savedAt ? fmtFull.format(r.savedAt) + ", " + fmtTime.format(r.savedAt) : t("an unknown date");
    return '<p class="io__sum">' + t("Restore “{file}”?", { file: esc(name) }) + "</p>" +
      '<p class="io__text">' + t("Backup from {date}: {contents}.", { date: from, contents: contents(r.data) }) + "</p>" +
      (r.dropped ? '<p class="io__problem">' + tn(r.dropped, "{n} damaged record in it will be skipped.", "{n} damaged records in it will be skipped.") + "</p>" : "") +
      '<p class="io__text">' + t("This replaces what’s in this browser now ({contents}). A copy of the current data is kept in this browser first, and you can undo straight after.", { contents: contents(data) }) + "</p>" +
      '<div class="pform__actions"><button type="button" class="btn btn--primary btn--sm" data-restore-go>' + t("Restore this backup") + "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-restore-cancel>' + t("Cancel") + "</button></div>";
  }
  backupEl.addEventListener("click", function (e) {
    if (e.target.closest("[data-backup-download]")) {
      var name = "shelflife-backup-" + Inv.toISO(today) + ".json";
      Csv.download(name, Store.backupFile(data), "application/json");
      try { localStorage.setItem(LAST_BACKUP, new Date().toISOString()); } catch (err) {}
      UI.toast(t("Downloaded {file} — keep it somewhere safe.", { file: name }), null);
      var dot = document.querySelector("[data-backup-due]");
      if (dot) dot.hidden = true;
      renderSummary();
      return;
    }
    if (e.target.closest("[data-restore-cancel]")) { pendingRestore = null; setPanel(backupEl, backupHTML()); return; }
    if (e.target.closest("[data-restore-go]") && pendingRestore) {
      if (!Store.keepCurrent()) { setPanel(backupEl, backupHTML(t("Couldn’t keep a copy of the current data, so nothing was replaced. Download a backup of it first."))); return; }
      var before = snapshot(), r = pendingRestore.result;
      var keepShop = data.shop, keepOwn = data.own;
      data = r.data;
      if (!r.hasShop) { data.shop = keepShop || ""; data.own = !!keepOwn; }   // an older backup has no name: keep the current one
      save();
      pendingRestore = null;
      setPanel(backupEl, backupHTML());
      changed(r.savedAt ? t("Restored the backup from {date}", { date: fmtFull.format(r.savedAt) }) : t("Restored the backup"), before);
    }
  });
  backupEl.addEventListener("change", function (e) {
    if (!e.target.matches("[data-restore-file]")) return;
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setPanel(backupEl, backupHTML(t("That file is too large to be a backup."))); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var r = Store.readBackup(String(reader.result));
      if (r.fatal) { pendingRestore = null; setPanel(backupEl, backupHTML(r.fatal)); return; }
      pendingRestore = { result: r, name: file.name };
      setPanel(backupEl, restoreHTML(file.name, r), "[data-restore-go]");
    };
    reader.onerror = function () { setPanel(backupEl, backupHTML(t("Couldn’t read that file."))); };
    reader.readAsText(file, "UTF-8");
  });

  // ---------- 3. spreadsheets ----------
  var sheetEl = root.querySelector("[data-set-sheets]");
  var pendingImport = null;
  function sheetHTML(problem) {
    return (problem ? '<p class="io__problem" role="alert">' + esc(problem) + "</p>" : "") +
      '<p class="io__text">' + t("One row per batch, with the columns <b>Product name</b>, Category, <b>Quantity</b>, Unit, <b>Expiry date</b>, Batch number, Supplier, Cost per unit, Selling price, Date received and Barcode. Only the ones in bold are required. Write dates as DD/MM/YYYY.") + "</p>" +
      '<p class="io__text">' + t("Keep the column names in English, as in the template. In Excel, save the file as “CSV UTF-8”. Rows already on record are skipped, so importing the same file twice never adds anything twice.") + "</p>" +
      '<div class="pform__actions"><label class="btn btn--primary btn--sm io__file">' + t("Import a CSV file") + '<input type="file" accept=".csv,text/csv" class="io__input" data-import-file></label>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-template>' + t("Download template") + "</button></div>" +
      '<div class="set__exports"><button type="button" class="detail__link" data-export-stock>' + t("Download your stock (CSV)") + "</button>" +
      '<button type="button" class="detail__link" data-export-writeoffs>' + t("Download your write-offs (CSV)") + "</button></div>";
  }
  function rowList(items, text) {
    var shown = items.slice(0, 20).map(function (it) {
      return "<li><b>" + t("Row {n}", { n: it.row }) + "</b>" + (it.name ? " · " + esc(it.name) : "") + " — " + esc(text(it)) + "</li>";
    }).join("");
    return '<ul class="io__rows">' + shown + (items.length > 20 ? "<li>" + t("…and {n} more.", { n: items.length - 20 }) + "</li>" : "") + "</ul>";
  }
  function planHTML(name, plan) {
    var n = plan.batches.length;
    var head = n ? tn(n, "{n} batch ready to add", "{n} batches ready to add") : plan.links.length ? t("No new batches") : t("Nothing new to add from this file");
    var parts = [];
    if (plan.products.length) parts.push(tn(plan.products.length, "{n} new product", "{n} new products"));
    if (plan.existingAdds) parts.push(tn(plan.existingAdds, "{n} batch for products you already have", "{n} batches for products you already have"));
    if (plan.links.length) parts.push(tn(plan.links.length, "{n} barcode for products that had none", "{n} barcodes for products that had none"));
    var html = '<p class="io__sum">' + t("Checked “{file}”", { file: esc(name) }) + "</p>" +
      '<p class="io__text">' + head + (parts.length ? ": " + parts.join(", ") : "") + t(".") + " " + tn(plan.rows, "{n} row checked.", "{n} rows checked.") + "</p>";
    if (plan.garbled) html += '<p class="io__problem">' + t("Some characters couldn’t be read, so names may look wrong. In Excel, use Save As → “CSV UTF-8” and import again.") + "</p>";
    if (plan.errors.length) {
      html += '<p class="io__problem">' + tn(plan.errors.length,
          "{n} row has a problem and won’t be imported. Fix it in the file and import it again — rows already added are skipped then.",
          "{n} rows have problems and won’t be imported. Fix them in the file and import it again — rows already added are skipped then.") + "</p>" +
        rowList(plan.errors, function (it) { return it.messages.join(" "); });
    }
    if (plan.skipped.length) {
      html += '<details class="io__details"><summary>' + tn(plan.skipped.length, "{n} row is a duplicate and will be skipped", "{n} rows are duplicates and will be skipped") + "</summary>" +
        rowList(plan.skipped, function (it) { return it.reason; }) + "</details>";
    }
    return html + '<div class="pform__actions">' +
      (n || plan.links.length ? '<button type="button" class="btn btn--primary btn--sm" data-import-go>' +
        (n ? tn(n, "Add {n} batch", "Add {n} batches") : tn(plan.links.length, "Save {n} barcode", "Save {n} barcodes")) + "</button>" : "") +
      '<button type="button" class="btn btn--ghost btn--sm" data-import-cancel>' + t("Cancel") + "</button></div>";
  }
  sheetEl.addEventListener("change", function (e) {
    if (!e.target.matches("[data-import-file]")) return;
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > Csv.MAX_BYTES) { setPanel(sheetEl, sheetHTML(t("That file is larger than 2 MB. Split it into smaller files."))); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result);
      var plan = Csv.plan(text, data, today);
      if (plan.fatal) { pendingImport = null; setPanel(sheetEl, sheetHTML(plan.fatal)); return; }
      pendingImport = { text: text, name: file.name };
      setPanel(sheetEl, planHTML(file.name, plan), "[data-import-go], [data-import-cancel]");
    };
    reader.onerror = function () { setPanel(sheetEl, sheetHTML(t("Couldn’t read that file. Try saving it again as CSV."))); };
    reader.readAsText(file, "UTF-8");
  });
  sheetEl.addEventListener("click", function (e) {
    if (e.target.closest("[data-template]")) { Csv.download("shelflife-template.csv", Csv.templateCSV()); return; }
    if (e.target.closest("[data-import-cancel]")) { pendingImport = null; setPanel(sheetEl, sheetHTML()); return; }
    if (e.target.closest("[data-export-stock]")) {
      if (!data.batches.length) { UI.toast(t("There’s no stock to export."), null); return; }
      var name = csvName("stock");
      Csv.download(name, Csv.stockCSV(data));
      UI.toast(t("Downloaded {file} — {batches}", { file: name, batches: tn(data.batches.length, "{n} batch", "{n} batches") }), null);
      return;
    }
    if (e.target.closest("[data-export-writeoffs]")) {
      if (!data.writeoffs.length) { UI.toast(t("Nothing has been written off yet."), null); return; }
      var wname = csvName("write-offs");
      Csv.download(wname, Csv.writeoffsCSV(data));
      UI.toast(t("Downloaded {file} — {count}", { file: wname, count: tn(data.writeoffs.length, "{n} write-off", "{n} write-offs") }), null);
      return;
    }
    if (e.target.closest("[data-import-go]") && pendingImport) {
      // check again against the data as it is now, so nothing can be added twice
      var plan = Csv.plan(pendingImport.text, data, today);
      if (plan.fatal || (!plan.batches.length && !plan.links.length)) { setPanel(sheetEl, plan.fatal ? sheetHTML(plan.fatal) : planHTML(pendingImport.name, plan)); return; }
      var before = snapshot();
      plan.links.forEach(function (l) { l.product.barcode = l.code; });
      data.products = data.products.concat(plan.products);
      data.batches = data.batches.concat(plan.batches);
      data.customized = true;
      save();
      pendingImport = null;
      var said = [];
      if (plan.batches.length) said.push(plan.products.length ?
        t("Imported {batches} ({products})", { batches: tn(plan.batches.length, "{n} batch", "{n} batches"), products: tn(plan.products.length, "{n} new product", "{n} new products") }) :
        t("Imported {batches}", { batches: tn(plan.batches.length, "{n} batch", "{n} batches") }));
      if (plan.links.length) said.push(tn(plan.links.length, "Saved {n} barcode", "Saved {n} barcodes"));
      setPanel(sheetEl, '<p class="io__sum">' + esc(said.join(" · ")) + "</p>" +
        '<div class="pform__actions"><a class="btn btn--primary btn--sm" href="demo.html" data-page-link>' + t("See them on the Shelf") + "</a>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-import-cancel>' + t("Import another file") + "</button></div>");
      changed(said.join(" · "), before);
    }
  });

  // ---------- 4. start over: an empty shop of your own, or the sample back ----------
  var resetEl = root.querySelector("[data-set-reset]");
  function resetHTML(confirming) {
    if (!confirming) return '<p class="io__text">' + t("Start an empty shop of your own, or put back the demo’s sample stock to show ShelfLife to someone.") + "</p>" +
      '<div class="pform__actions"><button type="button" class="btn btn--ghost btn--sm" data-reset-ask="empty">' + t("Start an empty shop") + "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-reset-ask="sample">' + t("Reset to the sample") + "</button></div>";
    var empty = confirming === "empty";
    return '<p class="io__sum">' + (empty ? t("Start an empty shop?") : t("Replace everything with the sample?")) + "</p>" +
      '<p class="io__text">' + t("Your {contents} will be replaced. A copy is kept in this browser first, and you can undo straight after.", { contents: contents(data) }) + "</p>" +
      '<div class="pform__actions"><button type="button" class="btn btn--ink btn--sm" data-reset-go="' + confirming + '">' + (empty ? t("Start an empty shop") : t("Reset to the sample")) + "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-reset-no>' + t("Keep my data") + "</button></div>";
  }
  resetEl.addEventListener("click", function (e) {
    var ask = e.target.closest("[data-reset-ask]");
    if (ask) { setPanel(resetEl, resetHTML(ask.getAttribute("data-reset-ask")), "[data-reset-no]"); return; }
    if (e.target.closest("[data-reset-no]")) { setPanel(resetEl, resetHTML(false), "[data-reset-ask]"); return; }
    var go = e.target.closest("[data-reset-go]");
    if (go) {
      if (!Store.keepCurrent()) { UI.toast(t("Couldn’t keep a copy of the current data, so nothing was replaced. Download a backup of it first."), null); return; }
      var before = snapshot();
      if (go.getAttribute("data-reset-go") === "empty") {
        data = Store.empty(data.shop);                 // the shop keeps its name
        save();
        try { localStorage.setItem("shelflife-welcomed", "1"); } catch (err) {}
        setPanel(resetEl, resetHTML(false));
        changed(t("Your shop is empty and ready. Add your first product on the Shelf."), before);
      } else {
        var s = Store.sample(today);
        data = { products: s.products, batches: s.batches, statuses: {}, writeoffs: [], sales: [], shop: "", customized: false, notices: [] };
        Store.clear();
        setPanel(resetEl, resetHTML(false));
        changed(t("Demo data restored"), before);
      }
    }
  });

  // ---------- the shop's name ----------
  var nameForm = root.querySelector("[data-set-name]");
  nameForm.elements.shop.value = data.shop || "";
  nameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var before = snapshot();
    var name = nameForm.elements.shop.value.trim().replace(/\s+/g, " ").slice(0, Store.LIMITS.shop);
    if (name === (data.shop || "")) return;
    data.shop = name;
    save();
    changed(name ? t("Saved the name: {shop}", { shop: name }) : t("Removed the shop’s name"), before);
  });

  function renderAll() { renderSummary(); syncShop(); }
  setPanel(backupEl, backupHTML());
  setPanel(sheetEl, sheetHTML());
  setPanel(resetEl, resetHTML(false));
  renderSummary();
  // Escape steps out of a half-finished restore, import or reset
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (pendingRestore) { pendingRestore = null; setPanel(backupEl, backupHTML()); }
    if (pendingImport) { pendingImport = null; setPanel(sheetEl, sheetHTML()); }
    if (resetEl.querySelector("[data-reset-go]")) setPanel(resetEl, resetHTML(false), "[data-reset-ask]");
  });
})();
