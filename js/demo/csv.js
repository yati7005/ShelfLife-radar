/*
 * ShelfLife Radar — CSV import and export (no DOM except the download helper).
 *
 * One row per batch, with the same columns for the template, the import and the stock export,
 * so an exported file can be imported again (rows already on record are skipped, not doubled).
 *
 * Import is checked row by row with the same rules as the forms; nothing is added until the
 * user has seen the summary and confirmed. Dates are read as DD/MM/YYYY (or YYYY-MM-DD),
 * because that's how Excel saves them on Indian systems.
 */
(function () {
  var Store = window.SLStore;
  var Inv = window.SLInventory;
  if (!Store || !Inv) return;
  // Messages are shown in the page's language; the file's column names and units stay English.
  var t = window.SLi18n ? window.SLi18n.t : function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); };

  var MAX_ROWS = 5000;
  var MAX_BYTES = 2 * 1024 * 1024;

  var COLUMNS = [
    { key: "name",     label: "Product name",  required: true, alias: ["product name", "product", "name", "item", "item name"] },
    { key: "category", label: "Category",      alias: ["category"] },
    { key: "qty",      label: "Quantity",      required: true, alias: ["quantity", "qty", "units"] },
    { key: "unit",     label: "Unit",          alias: ["unit", "uom", "unit of measure"] },
    { key: "expires",  label: "Expiry date",   required: true, alias: ["expiry date", "expiry", "expires", "exp date", "best before", "use by"] },
    { key: "lot",      label: "Batch number",  alias: ["batch number", "batch", "batch no", "lot", "lot number"] },
    { key: "supplier", label: "Supplier",      alias: ["supplier", "vendor", "distributor"] },
    { key: "cost",     label: "Cost per unit", alias: ["cost per unit", "cost", "unit cost", "purchase price", "rate"] },
    { key: "price",    label: "Selling price", alias: ["selling price", "price", "mrp", "sale price", "sp"] },
    { key: "received", label: "Date received", alias: ["date received", "received", "received date", "delivery date"] },
    { key: "barcode",  label: "Barcode",       alias: ["barcode", "ean", "upc", "gtin", "bar code"] }
  ];
  var LABEL = {};
  COLUMNS.forEach(function (c) { LABEL[c.key] = c.label; });

  // How units are written in the file (export uses the first spelling of each)
  var UNIT_WORDS = {
    pcs: ["pcs", "pc", "piece", "pieces", "unit", "units", "nos", "no", "numbers"],
    pack: ["packet", "packets", "pack", "packs", "pkt", "pkts"],
    box: ["box", "boxes", "carton", "cartons"],
    dozen: ["dozen", "doz", "dz"],
    kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
    g: ["g", "gm", "gms", "gram", "grams", "gr"],
    l: ["L", "l", "ltr", "ltrs", "lt", "litre", "litres", "liter", "liters"],
    ml: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"]
  };
  function readUnit(s) {
    var t = s.toLowerCase().replace(/\./g, "");
    for (var id in UNIT_WORDS) if (UNIT_WORDS[id].some(function (w) { return w.toLowerCase() === t; })) return id;
    return null;
  }

  // ---------- reading ----------
  // RFC 4180-style: quoted fields may hold commas, quotes ("") and line breaks.
  // The separator is guessed from the header line (Excel uses ";" in some regions).
  function parse(text) {
    text = text.replace(/^﻿/, "");
    var head = text.split(/\r?\n/, 1)[0];
    function n(ch) { return head.split(ch).length - 1; }
    var sep = n(";") > n(",") ? ";" : n("\t") > n(",") ? "\t" : ",";
    var rows = [], row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"' && field === "") quoted = true;
      else if (c === sep) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (f) { return f.trim() !== ""; }); });
    rows.sep = sep;
    return rows;
  }

  // Numbers as Excel writes them. In "," files a comma groups digits ("1,250.50", or "1,25,000"
  // in Indian style). In ";" files Excel uses the comma as the decimal point ("1,5" = 1.5).
  function readNumber(s, decimalComma) {
    s = s.replace(/₹|rs\.?|inr|\s/gi, "");
    if (decimalComma) return s.indexOf(",") === -1 ? s : s.replace(/\./g, "").replace(",", ".");
    return s.replace(/,/g, "");
  }

  // Export protects text cells from being run as spreadsheet formulas ('=…'); undo that here.
  function cell(s) { s = String(s || "").trim(); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; }
  function headerKey(h) {
    var t = cell(h).toLowerCase().replace(/\(.*?\)/g, "").replace(/[.:_]/g, " ").replace(/\s+/g, " ").trim();
    for (var i = 0; i < COLUMNS.length; i++) if (COLUMNS[i].alias.indexOf(t) !== -1) return COLUMNS[i].key;
    return null;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // "" → { empty }, a usable date → { iso }, anything else → { bad }
  function readDate(s) {
    s = cell(s).replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "");      // Excel sometimes adds 00:00
    if (!s) return { empty: true };
    var y, m, d, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else if ((x = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += 2000; }
    else return { bad: true };
    var iso = y + "-" + pad(m) + "-" + pad(d);
    return Store.validISO(iso) ? { iso: iso } : { bad: true };
  }

  // Checks every row and works out what would be added. Changes nothing.
  // Returns { fatal } or { products, batches, links, existingAdds, skipped, errors, rows, garbled }.
  function plan(text, data, today) {
    var rows = parse(text);
    if (!rows.length) return { fatal: t("The file is empty.") };
    var map = {};
    rows[0].forEach(function (h, i) { var k = headerKey(h); if (k && !(k in map)) map[k] = i; });
    var missing = COLUMNS.filter(function (c) { return c.required && !(c.key in map); }).map(function (c) { return c.label; });
    if (missing.length) {
      return { fatal: t(missing.length > 1 ? "Couldn’t find the columns {names}. The first row must hold the column names — download the template to see them."
        : "Couldn’t find the column {names}. The first row must hold the column names — download the template to see them.", { names: missing.join(", ") }) };
    }
    if (rows.length - 1 > MAX_ROWS) return { fatal: t("That’s more than {n} rows. Split the file into smaller ones.", { n: MAX_ROWS.toLocaleString("en-IN") }) };

    var taken = {};
    data.products.forEach(function (p) { taken[p.id] = true; });
    data.batches.forEach(function (b) { taken[b.id] = true; });
    (data.writeoffs || []).forEach(function (w) { taken[w.id] = true; });

    // links: barcodes from the file for products already on record that had none
    var out = { products: [], batches: [], links: [], existingAdds: 0, skipped: [], errors: [], rows: 0, garbled: /�/.test(text) };
    var all = data.batches.slice();          // what's on record plus what this file adds so far
    var rowOf = {};                          // batch id → row number in the file

    function wasWrittenOff(pid, lot, expires) {
      return (data.writeoffs || []).some(function (w) {
        if (w.productId !== pid) return false;
        return lot ? w.lot.toLowerCase() === lot.toLowerCase() : !w.lot && w.expires === expires;
      });
    }

    // a sale whose batch is no longer on the shelf means that batch sold out
    function wasSoldOut(pid, lot, expires) {
      return (data.sales || []).some(function (s) {
        if (s.productId !== pid || !s.batchId || data.batches.some(function (b) { return b.id === s.batchId; })) return false;
        return lot ? s.lot.toLowerCase() === lot.toLowerCase() : !s.lot && s.expires === expires;
      });
    }

    try { checkRows(); } finally { out.links.forEach(function (l) { l.product.barcode = ""; }); }
    return out;

    function checkRows() {
    for (var r = 1; r < rows.length; r++) {
      var line = r + 1;                      // the row number a spreadsheet shows
      var get = function (k) { return k in map ? cell(rows[r][map[k]]) : ""; };
      out.rows++;
      var msgs = [];
      var name = get("name").replace(/\s+/g, " ");
      var catRaw = get("category");
      var category = "Other";
      if (catRaw) {
        category = Store.CATEGORIES.filter(function (c) { return c.toLowerCase() === catRaw.toLowerCase(); })[0];
        if (!category) msgs.push(t("Category “{value}” isn’t one of: {list}.", { value: catRaw, list: Store.CATEGORIES.join(", ") }));
      }
      // Excel shows long numbers as 8.90123E+12 unless the column is formatted as text
      var code = get("barcode").replace(/[\s-]/g, "");
      var known = data.products.concat(out.products);
      // a barcode already on record identifies the product, even if the name is spelled differently
      var product = Store.findProductByBarcode(known, code) ||
        (name ? Store.findProductByName(data.products, name) || Store.findProductByName(out.products, name) : null);
      var link = null;
      if (!name && !product) msgs.push(t("Product name is missing."));
      else if (!product) {
        var vp = Store.validateProduct({ name: name, category: category || "Other", barcode: code }, { products: known });
        if (vp.errors && vp.errors.name) msgs.push(vp.errors.name);
        if (vp.errors && vp.errors.barcode) msgs.push(t("Barcode: {problem}", { problem: /E\+/i.test(code) ?
          t("Excel turned it into “{value}”. Format the column as Text and type it again.", { value: code }) : vp.errors.barcode }));
      } else if (code && product.barcode !== code) {
        if (product.barcode) msgs.push(t("Barcode {code} doesn’t match the one on record for {name} ({onRecord}).", { code: code, name: product.name, onRecord: product.barcode }));
        else {
          var vl = Store.validateProduct({ name: product.name, category: product.category, barcode: code }, { products: known, excludeId: product.id });
          if (vl.errors && vl.errors.barcode) msgs.push(t("Barcode: {problem}", { problem: vl.errors.barcode }));
          else link = { product: product, code: code };
        }
      }
      if (product && !name) name = product.name;

      var unitRaw = get("unit");
      var unit = unitRaw ? readUnit(unitRaw) : null;
      if (unitRaw && !unit) msgs.push(t("Unit “{value}” isn’t one this app knows. Use pcs, packet, box, dozen, kg, g, L or ml.", { value: unitRaw }));
      else if (product && unit && unit !== product.unit) {
        msgs.push(t("Unit {value} doesn’t match {name}, which is counted in {unit}.", { value: unitRaw, name: product.name, unit: t(Store.unitOf(product.unit).many) }));
      }
      unit = product ? product.unit : unit || "pcs";

      var exp = readDate(get("expires"));
      var rec = readDate(get("received"));
      if (exp.empty) msgs.push(t("Expiry date is missing."));
      else if (exp.bad) msgs.push(t("Expiry date “{value}” can’t be read. Use DD/MM/YYYY, like 05/11/2026.", { value: get("expires") }));
      if (rec.bad) msgs.push(t("Date received “{value}” can’t be read. Use DD/MM/YYYY, or leave it empty.", { value: get("received") }));

      var qty = readNumber(get("qty"), rows.sep === ";").replace(/\.0+$/, "");
      var cost = readNumber(get("cost"), rows.sep === ";");
      var price = readNumber(get("price"), rows.sep === ";");
      var raw = { lot: get("lot"), qty: qty, expires: exp.iso || "", supplier: get("supplier"), cost: cost, price: price, received: rec.iso || "" };
      var vb = Store.validateBatch(raw, { batches: [], productId: null, today: today, unit: unit });
      if (vb.errors) {
        Object.keys(vb.errors).forEach(function (k) {
          if ((k === "expires" && !exp.iso) || (k === "received" && !rec.iso)) return;   // already explained above
          msgs.push(t(LABEL[k]) + ": " + vb.errors[k]);
        });
      }
      if (msgs.length) { out.errors.push({ row: line, name: name, messages: msgs }); continue; }

      var v = vb.values;
      var pid = product ? product.id : null;
      var dup = pid ? Store.findDuplicateBatch(all, pid, v.lot, v.expires) : null;
      if (link && out.products.indexOf(link.product) !== -1) link.product.barcode = link.code;   // new from this file: just keep it
      else if (link && !out.links.some(function (l) { return l.product === link.product || l.code === link.code; })) {
        out.links.push(link);
        link.product.barcode = link.code;      // so later rows find it; reset in the finally above, as plan() changes nothing
      }
      if (dup) {
        out.skipped.push({ row: line, name: name, reason: rowOf[dup.id] ? t("same batch as row {n}", { n: rowOf[dup.id] }) : t("already on record") });
        continue;
      }
      // a batch that was written off has left the shop; importing an older file mustn't bring it back
      if (pid && wasWrittenOff(pid, v.lot, v.expires)) {
        out.skipped.push({ row: line, name: name, reason: t("already written off") });
        continue;
      }
      // the same goes for a batch that sold out
      if (pid && wasSoldOut(pid, v.lot, v.expires)) {
        out.skipped.push({ row: line, name: name, reason: t("already sold out") });
        continue;
      }
      if (!product) {
        product = { id: Store.newId("p", taken), name: name, category: category, unit: unit, barcode: code };
        taken[product.id] = true;
        out.products.push(product);
      } else if (data.products.indexOf(product) !== -1) out.existingAdds++;
      var b = { id: Store.newId("b", taken), productId: product.id, lot: v.lot, qty: v.qty, expires: v.expires,
        supplier: v.supplier, unitCost: v.unitCost, price: v.price, received: v.received };
      taken[b.id] = true;
      rowOf[b.id] = line;
      all.push(b);
      out.batches.push(b);
    }
    }
  }

  // ---------- writing ----------
  function field(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;        // a name like "=SUM(…)" stays text in Excel
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function stringify(rows) { return rows.map(function (r) { return r.map(field).join(","); }).join("\r\n") + "\r\n"; }

  function templateCSV() { return stringify([COLUMNS.map(function (c) { return c.label; })]); }

  // Every batch, product by product (soonest expiry first). Products with no stock have no row.
  function stockCSV(data) {
    var rows = [COLUMNS.map(function (c) { return c.label; })];
    var byProduct = {};
    data.batches.forEach(function (b) { (byProduct[b.productId] = byProduct[b.productId] || []).push(b); });
    data.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
      (byProduct[p.id] || []).sort(function (a, b) { return a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : 0; }).forEach(function (b) {
        rows.push([p.name, p.category, b.qty, UNIT_WORDS[p.unit][0], b.expires, b.lot, b.supplier, b.unitCost, b.price === undefined ? null : b.price, b.received, p.barcode || ""]);
      });
    });
    return stringify(rows);
  }

  var OUTCOME = { waste: "Thrown away", "return": "Returned to supplier" };
  var CLAIM = { pending: "Waiting", received: "Credited", refused: "Refused" };
  function writeoffsCSV(data) {
    var rows = [["Date", "Product name", "Batch number", "Quantity", "Unit", "Cost per unit", "Value", "Outcome", "Claim", "Claim settled", "Supplier", "Expiry date"]];
    data.writeoffs.slice().sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }).forEach(function (w) {
      var v = Store.valuePaise(w.qty, w.unitCost);
      rows.push([w.at, w.name, w.lot, w.qty, UNIT_WORDS[w.unit || "pcs"][0], w.unitCost, v === null ? null : v / 100, OUTCOME[w.outcome],
        w.claim ? CLAIM[w.claim] : "", w.settledAt, w.supplier, w.expires]);
    });
    return stringify(rows);
  }

  // Saves a file. For CSV (no type given) a byte-order mark makes Excel read ₹ and Hindi names correctly.
  function download(filename, text, type) {
    var url = URL.createObjectURL(new Blob([type ? text : "﻿" + text], { type: type || "text/csv;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.SLCsv = {
    COLUMNS: COLUMNS, MAX_BYTES: MAX_BYTES,
    parse: parse, plan: plan, readDate: readDate,
    templateCSV: templateCSV, stockCSV: stockCSV, writeoffsCSV: writeoffsCSV, download: download
  };
})();
