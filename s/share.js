/* Veya shared care sheet page.
 *
 * Link format: https://anhira.net/s/?id=<shareID>
 *
 * Rules (see qr-share-design.md):
 *  - Missing field = empty  -> the row is simply not shown.
 *  - Unknown field or choice ID = ignore -> never shown, never crashes.
 *  - Choices arrive as fixed IDs; the words shown here come from LABELS below.
 *  - One unit per number (°C, foot-candles, metres, days, weeks); other units are display only.
 *  - Shared text is always inserted as plain text (textContent), never as HTML.
 */
(function () {
  "use strict";

  // ---------- Where shares come from ----------
  // V1 test: ids starting with "test" load a file from /s/test/.
  // Next step: everything else will load from the CloudKit public database.
  var ShareSource = {
    load: function (id) {
      if (/^test/.test(id)) {
        return fetch("/s/test/" + encodeURIComponent(id) + ".json", { cache: "no-store" })
          .then(function (r) {
            if (r.status === 404) return null;
            if (!r.ok) throw new Error("http " + r.status);
            return r.json();
          });
      }
      // CloudKit is not connected yet, so any other id is "not shared".
      return Promise.resolve(null);
    }
  };

  // ---------- Words for choice IDs ----------
  var LABELS = {
    growsBest: { potted: "Potted", mounted: "Mounted", either: "Potted or mounted" },
    watering: { keep_moist: "Keep moist", slightly_dry: "Slightly dry", dry_out_fully: "Dry out fully" },
    rootAirflow: { low: "Low", medium: "Medium", high: "High" },
    flowering: { blooms: "Blooms", rarely_indoors: "Rarely indoors", never: "Never" },
    fragrance: { none: "None", faint: "Faint", moderate: "Moderate", strong: "Strong" },
    scent: {
      floral: "Floral", citrus: "Citrus", fruity: "Fruity", honey: "Honey", vanilla: "Vanilla",
      chocolate: "Chocolate", coconut: "Coconut", powdery: "Powdery", green: "Green", spicy: "Spicy",
      minty: "Minty", licorice: "Licorice", medicinal: "Medicinal", musky: "Musky", unpleasant: "Unpleasant"
    },
    fragrantWhen: { morning: "Morning", daytime: "Daytime", evening: "Evening", night: "Night" },
    flowersHeld: { upright: "Upright", arching: "Arching", hanging: "Hanging", below_pot: "Below the pot" },
    afterFlowering: {
      deadhead: "Deadhead", cut_stalk: "Cut the stalk", leave_stalk: "Leave the stalk",
      never_cut: "Never cut", pinch_buds: "Pinch off buds"
    },
    type: { species: "Species", hybrid: "Hybrid", intergeneric_hybrid: "Intergeneric hybrid" },
    pest: {
      spider_mites: "Spider mites", mealybugs: "Mealybugs", scale: "Scale", aphids: "Aphids",
      thrips: "Thrips", fungus_gnats: "Fungus gnats", whiteflies: "Whiteflies", snails_slugs: "Snails & slugs",
      root_rot: "Root rot", crown_rot: "Crown rot", black_rot: "Black rot", botrytis: "Botrytis",
      leaf_spot: "Leaf spot", sunburn: "Sunburn"
    }
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- Small helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function label(group, id) {
    return (LABELS[group] && LABELS[group][id]) || null; // unknown id -> ignored
  }
  function labels(group, ids) {
    return (Array.isArray(ids) ? ids : []).map(function (i) { return label(group, i); }).filter(Boolean);
  }
  function hasText(s) { return typeof s === "string" && s.trim() !== ""; }
  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function range(r, unit, conv) {
    if (!r || !isNum(r.min) && !isNum(r.max)) return null;
    var lo = isNum(r.min) ? r.min : r.max, hi = isNum(r.max) ? r.max : r.min;
    var main = (lo === hi ? fmt(lo) : fmt(lo) + "–" + fmt(hi)) + unit;
    if (!conv) return { main: main };
    var a = conv.f(lo), b = conv.f(hi);
    return { main: main, sub: (a === b ? fmt(a) : fmt(a) + "–" + fmt(b)) + conv.unit };
  }
  var toF = { f: function (c) { return c * 9 / 5 + 32; }, unit: " °F" };
  var toLux = { f: function (fc) { return fc * 10.764; }, unit: " lux" };
  var toFt = { f: function (m) { return m * 3.28084; }, unit: " ft" };
  function monthsText(list) {
    var m = (Array.isArray(list) ? list : []).filter(function (x) { return x >= 1 && x <= 12; });
    m = m.filter(function (x, i) { return m.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    if (!m.length) return null;
    if (m.length === 12) return "All year";
    // Find a single consecutive run (allowing wrap, e.g. Nov–Feb).
    for (var s = 0; s < m.length; s++) {
      var ok = true;
      for (var k = 1; k < m.length; k++) {
        var prev = m[(s + k - 1) % m.length], cur = m[(s + k) % m.length];
        if (cur !== prev % 12 + 1) { ok = false; break; }
      }
      if (ok) return m.length === 1 ? MONTHS[m[s] - 1] : MONTHS[m[s] - 1] + "–" + MONTHS[m[(s + m.length - 1) % m.length] - 1];
    }
    return m.map(function (x) { return MONTHS[x - 1]; }).join(", ");
  }
  function dateText(s) {
    var d = new Date(s);
    if (isNaN(d)) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  // ---------- Building blocks ----------
  function card(icon, title) {
    var c = el("section", "sh-card");
    var h = el("h2", "sh-head");
    h.appendChild(el("span", "sh-icon " + icon));
    h.appendChild(el("span", null, title));
    c.appendChild(h);
    return c;
  }
  function stats(items) { // [{k, v, sub}]
    items = items.filter(function (i) { return i && i.v; });
    if (!items.length) return null;
    var g = el("div", "sh-stats");
    items.forEach(function (i) {
      var s = el("div", "sh-stat");
      s.appendChild(el("span", "k", i.k));
      s.appendChild(el("span", "v", i.v));
      if (i.sub) s.appendChild(el("span", "sub", i.sub));
      g.appendChild(s);
    });
    return g;
  }
  function rows(items) { // [{k, v, sub}]
    items = items.filter(function (i) { return i && i.v; });
    if (!items.length) return null;
    var d = el("dl", "sh-rows");
    items.forEach(function (i) {
      d.appendChild(el("dt", null, i.k));
      var dd = el("dd", null, i.v);
      if (i.sub) dd.appendChild(el("span", "sub", i.sub));
      d.appendChild(dd);
    });
    return d;
  }
  function prose(text, cls) { return hasText(text) ? el("p", "sh-prose" + (cls ? " " + cls : ""), text.trim()) : null; }
  function chips(list, cls) {
    if (!list.length) return null;
    var w = el("div", "sh-chips");
    list.forEach(function (t) { w.appendChild(el("span", "chip" + (cls ? " " + cls : ""), t)); });
    return w;
  }
  function add(parent, kids) {
    var n = 0;
    kids.forEach(function (k) { if (k) { parent.appendChild(k); n++; } });
    return n;
  }
  function r(rangeObj, key) { return rangeObj ? { k: key, v: rangeObj.main, sub: rangeObj.sub } : null; }

  // ---------- Sections ----------
  function sectionWatering(d) {
    if (!d) return null;
    var c = card("i-water", "Watering & roots");
    var n = add(c, [
      stats([
        { k: "Watering", v: label("watering", d.watering) },
        { k: "Root airflow", v: label("rootAirflow", d.rootAirflow) },
        { k: "Grows best", v: label("growsBest", d.growsBest) }
      ]),
      prose(d.notes)
    ]);
    return n ? c : null;
  }

  function sectionLight(d) {
    if (!d) return null;
    var c = card("i-light", "Light");
    var n = add(c, [
      prose(d.text, "lead-ish"),
      rows([
        r(range(d.footCandles, " fc", toLux), "Intensity"),
        r(range(d.ppfd, " µmol/m²/s"), "PPFD"),
        r(range(d.dli, " mol/m²/day"), "DLI")
      ])
    ]);
    return n ? c : null;
  }

  function climateCol(title, s) {
    if (!s) return null;
    var t = range(s.tempC, " °C", toF), h = range(s.humidity, "% humidity");
    if (!t && !h) return null;
    var col = el("div", "sh-season");
    if (title) col.appendChild(el("span", "k", title));
    if (t) { col.appendChild(el("span", "v", t.main)); col.appendChild(el("span", "sub", t.sub + " · night–day")); }
    if (h) col.appendChild(el("span", "h", h.main));
    return col;
  }

  function sectionClimate(d) {
    if (!d) return null;
    var c = card("i-climate", "Climate");
    var cols = el("div", "sh-seasons");
    var n = 0;
    if (d.mode === "seasonal") {
      n += add(cols, [climateCol("Summer (growing)", d.summer), climateCol("Winter (rest)", d.winter)]);
      if (n) c.querySelector(".sh-head").appendChild(el("span", "tag", "Seasonal"));
    } else {
      n += add(cols, [climateCol("All year", d.allYear)]);
    }
    if (n) c.appendChild(cols);
    n += add(c, [
      rows([r(range(d.elevationM, " m", toFt), "Elevation")]),
      hasText(d.nativeRange) ? rows([{ k: "Native range", v: d.nativeRange.trim() }]) : null
    ]);
    return n ? c : null;
  }

  function sectionBloom(d) {
    if (!d) return null;
    var c = card("i-bloom", "Bloom");
    if (d.flowering === "never") {
      c.appendChild(rows([{ k: "Flowering", v: "Doesn't usually flower" }]));
      return c;
    }
    var scents = labels("scent", d.scent), when = labels("fragrantWhen", d.fragrantWhen), after = labels("afterFlowering", d.afterFlowering);
    var n = add(c, [
      rows([
        d.flowering === "rarely_indoors" ? { k: "Flowering", v: "Rarely indoors" } : null,
        { k: "Season", v: monthsText(d.months) },
        r(range(d.flowersLastDays, d.flowersLastDays && d.flowersLastDays.max === 1 ? " day" : " days"), "Flowers last"),
        { k: "Color", v: hasText(d.color) ? d.color.trim() : null },
        { k: "Fragrance", v: label("fragrance", d.fragrance) },
        { k: "Scent", v: scents.join(", ") || null },
        { k: "Fragrant", v: when.join(", ") || null },
        { k: "Flowers held", v: label("flowersHeld", d.flowersHeld) },
        { k: "After flowering", v: after.join(", ") || null },
        d.bloomsOnceThenDies === true ? { k: "Life cycle", v: "Blooms once, then dies. Keep the pups." } : null,
        isNum(d.nightDropC) ? { k: "Night drop", v: fmt(d.nightDropC) + " °C cooler at night", sub: fmt(d.nightDropC * 9 / 5) + " °F" } : null,
        isNum(d.dryRestWeeks) ? { k: "Dry rest", v: fmt(d.dryRestWeeks) + (d.dryRestWeeks === 1 ? " week" : " weeks") } : null,
        isNum(d.photoperiodHours) ? { k: "Photoperiod", v: fmt(d.photoperiodHours) + " hours of light" } : null
      ]),
      prose(d.notes)
    ]);
    return n ? c : null;
  }

  function sectionHealth(list) {
    var names = labels("pest", list);
    if (!names.length) return null;
    var c = card("i-health", "Watch for");
    c.appendChild(chips(names, "pest"));
    return c;
  }

  function sectionText(icon, title, text) {
    if (!hasText(text)) return null;
    var c = card(icon, title);
    c.appendChild(prose(text));
    return c;
  }

  // ---------- Page ----------
  function nameBlock(name) {
    var wrap = el("div", "sh-title");
    var h = el("h1", "serif");
    if (hasText(name.genus)) h.appendChild(el("span", null, name.genus.trim()));
    if (hasText(name.speciesEpithet)) h.appendChild(document.createTextNode(" " + name.speciesEpithet.trim()));
    if (hasText(name.variety)) {
      h.appendChild(el("span", "roman", " var. "));
      h.appendChild(document.createTextNode(name.variety.trim()));
    }
    if (hasText(name.grex)) h.appendChild(el("span", "roman", " " + name.grex.trim()));
    if (hasText(name.cultivar)) h.appendChild(el("span", "roman", " '" + name.cultivar.trim() + "'"));
    wrap.appendChild(h);

    var chain = ["order", "family", "subfamily", "tribe", "subtribe"]
      .map(function (k) { return hasText(name[k]) ? name[k].trim() : null; }).filter(Boolean);
    var c = chips(chain);
    if (c) wrap.appendChild(c);
    return wrap;
  }

  function render(share, root) {
    var name = share.name || {};
    var on = Array.isArray(share.sections) ? share.sections : [];
    function shared(key) { return on.indexOf(key) !== -1; }

    root.textContent = "";
    var title = [name.genus, name.speciesEpithet].filter(hasText).join(" ");
    if (title) document.title = title + " · Care sheet · Veya";

    var meta = el("p", "sh-meta");
    meta.appendChild(el("span", "by", "Shared by " + (hasText(share.displayName) ? share.displayName.trim() : "a Veya grower")));
    var upd = dateText(share.updatedAt);
    if (upd) meta.appendChild(el("span", null, "Updated " + upd));
    if (name.gbifMatch === "exact") meta.appendChild(el("span", "ok", "Name verified with GBIF"));

    root.appendChild(el("p", "eyebrow", "Care sheet"));
    root.appendChild(nameBlock(name));
    root.appendChild(meta);

    var any = add(root, [
      shared("wateringRoots") ? sectionWatering(share.wateringRoots) : null,
      shared("light") ? sectionLight(share.light) : null,
      shared("climate") ? sectionClimate(share.climate) : null,
      shared("bloom") ? sectionBloom(share.bloom) : null,
      shared("plantHealth") ? sectionHealth(share.plantHealth) : null,
      shared("careNotes") ? sectionText("i-notes", "Care notes", share.careNotes) : null,
      shared("description") ? sectionText("i-desc", "About this plant", share.description) : null
    ]);
    if (!any) root.appendChild(el("p", "state", "The grower hasn't added care details to this sheet yet."));
  }

  function showState(root, title, text) {
    root.textContent = "";
    var box = el("div", "sh-empty");
    box.appendChild(el("h1", "serif", title));
    box.appendChild(el("p", "lead", text));
    root.appendChild(box);
  }

  var root = document.getElementById("sheet");
  var after = document.getElementById("after");
  var id = new URLSearchParams(location.search).get("id") || "";

  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) {
    showState(root, "Plant not found", "This link is missing its plant code. Try scanning the label again.");
    after.hidden = false;
    document.getElementById("report").hidden = true;
    return;
  }

  var report = document.getElementById("report");
  report.href = "mailto:support@anhira.net?subject=" + encodeURIComponent("Report a shared care sheet (" + id + ")") +
    "&body=" + encodeURIComponent("Care sheet: " + location.href + "\n\nWhat's wrong with it:\n");

  ShareSource.load(id).then(function (share) {
    if (!share) {
      showState(root, "No longer shared", "This plant's care sheet isn't shared anymore.");
      report.hidden = true;
    } else {
      render(share, root);
    }
    after.hidden = false;
  }).catch(function () {
    showState(root, "Couldn't load", "Check your connection and try again.");
    after.hidden = false;
    report.hidden = true;
  });
})();
