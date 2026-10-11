/* Veya shared care sheet page.
 *
 * Link format: https://anhira.net/s/?id=<shareID>
 *
 * Rules (see qr-share-design.md):
 *  - Missing field = empty  -> the row is simply not shown.
 *  - Unknown field or choice ID = ignore -> never shown, never crashes.
 *  - A share uses the app's own plant format (PlantBundle in PlantTransfer.swift):
 *    short keys under "sp", choices as the app's codes (e.g. "slightlyDry"), pairs as [low, high].
 *    fromBundle() below is the only place that knows those short keys.
 *  - Choices arrive as the app's codes; the words shown here come from LABELS below.
 *  - One unit per number (°C, foot-candles, metres, days, weeks); other units are display only.
 *  - Shared text is always inserted as plain text (textContent), never as HTML.
 */
(function () {
  "use strict";

  // ---------- Where shares come from ----------
  // Real care sheets: the CloudKit public database (record type "CareSheet", record name = id,
  // field "json" = the care sheet), read with CloudKit Web Services and a read-only API token.
  // Hand-made test sheets (ids starting "test") are files in /s/test/.
  var CLOUDKIT = {
    container: "iCloud.com.anhira.rootnote",
    // "development" while testing with Xcode builds; "production" once TestFlight/App Store
    // builds share (and the schema has been deployed to Production).
    environment: "development",
    // CloudKit Console → API Access → Tokens. Public: it can only read the public database.
    apiToken: ""
  };

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
      if (!CLOUDKIT.apiToken) return Promise.resolve(null);
      var url = "https://api.apple-cloudkit.com/database/1/" + CLOUDKIT.container + "/" +
        CLOUDKIT.environment + "/public/records/lookup?ckAPIToken=" + encodeURIComponent(CLOUDKIT.apiToken);
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ recordName: id }] })
      })
        .then(function (r) {
          if (!r.ok) throw new Error("cloudkit " + r.status);
          return r.json();
        })
        .then(function (data) {
          var rec = data && data.records && data.records[0];
          if (!rec || rec.serverErrorCode) return null;          // NOT_FOUND → no longer shared
          var json = rec.fields && rec.fields.json && rec.fields.json.value;
          return json ? JSON.parse(json) : null;
        });
    }
  };

  // ---------- Words for choice IDs ----------
  var LABELS = {
    growsBest: { potted: "Potted", mounted: "Mounted", either: "Potted or mounted" },
    watering: { keepMoist: "Keep moist", slightlyDry: "Slightly dry", dryOut: "Dry out fully" },
    rootAirflow: { low: "Low", medium: "Medium", high: "High" },
    feedingFrequency: { weekly: "Weekly", everyTwoWeeks: "Every 2 weeks", monthly: "Monthly" },
    feedingStrength: { quarter: "¼ strength", half: "½ strength", full: "Full strength" },
    feedingWinter: { same: "Same", less: "Less", stop: "Stop" },
    flowering: { blooms: "Blooms", rarely: "Rarely indoors", never: "Never" },
    fragrance: { none: "None", faint: "Faint", moderate: "Moderate", strong: "Strong" },
    scent: {
      floral: "Floral", citrus: "Citrus", fruity: "Fruity", honey: "Honey", vanilla: "Vanilla",
      chocolate: "Chocolate", coconut: "Coconut", powdery: "Powdery", green: "Green", spicy: "Spicy",
      minty: "Minty", licorice: "Licorice", medicinal: "Medicinal", musky: "Musky", unpleasant: "Unpleasant"
    },
    fragrantWhen: { morning: "Morning", daytime: "Daytime", evening: "Evening", night: "Night" },
    flowersHeld: { upright: "Upright", arching: "Arching", hanging: "Hanging", belowPot: "Below the pot" },
    afterFlowering: {
      deadhead: "Deadhead", cutStalk: "Cut the stalk", leaveStalk: "Leave the stalk",
      neverCut: "Never cut", pinchBuds: "Pinch off buds"
    },
    type: { species: "Species", hybrid: "Hybrid", intergeneric_hybrid: "Intergeneric hybrid" },
    pest: {
      "spider-mites": "Spider mites", "false-spider-mites": "False spider mites", mealybugs: "Mealybugs",
      "root-mealybugs": "Root mealybugs", scale: "Scale insects", thrips: "Thrips", aphids: "Aphids",
      whiteflies: "Whiteflies", "fungus-gnats": "Fungus gnats", "broad-cyclamen-mites": "Broad & cyclamen mites",
      "snails-slugs": "Snails & slugs", "leaf-spot": "Leaf spot & anthracnose", botrytis: "Botrytis petal blight",
      "fusarium-wilt": "Fusarium wilt", "powdery-mildew": "Powdery mildew", rust: "Rust",
      "sooty-mould": "Sooty mould", "southern-blight": "Southern blight", "bacterial-rot": "Bacterial soft rot",
      "bacterial-brown-spot": "Bacterial brown spot", "crown-rot": "Crown rot", "black-rot": "Black rot",
      "root-rot": "Root rot", "orchid-viruses": "Orchid viruses", sunburn: "Sunburn", "cold-damage": "Cold damage",
      "bud-blast": "Bud blast", "fertilizer-burn": "Fertilizer (salt) burn", dehydration: "Dehydration",
      "low-light": "Too little light", "accordion-leaves": "Accordion (pleated) leaves"
    }
  };
  // Temperature unit: remembered per visitor; US visitors start in °F.
  var UNIT = (function () {
    try { var u = localStorage.getItem("veya-temp-unit"); if (u === "C" || u === "F") return u; } catch (e) {}
    return /^en-US/i.test(navigator.language || "") ? "F" : "C";
  })();
  function setUnit(u) {
    UNIT = u;
    try { localStorage.setItem("veya-temp-unit", u); } catch (e) {}
  }
  function cToU(c) { return UNIT === "F" ? c * 9 / 5 + 32 : c; }
  function tempRange(r) {
    if (!r || !isNum(r.min) && !isNum(r.max)) return null;
    var lo = isNum(r.min) ? r.min : r.max, hi = isNum(r.max) ? r.max : r.min;
    var a = fmt(cToU(lo)), b = fmt(cToU(hi));
    return (a === b ? a : a + "–" + b) + (UNIT === "F" ? " °F" : " °C");
  }
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
    var g = el("div", "sh-stats" + (items.length === 4 ? " two" : ""));   // 4 → a tidy 2 × 2
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
  // Long notes start folded to a few lines, with a button to open them.
  var proseCount = 0;
  function prose(text, cls) {
    if (!hasText(text)) return null;
    var p = el("p", "sh-prose" + (cls ? " " + cls : ""), text.trim());
    if (text.trim().length < 420) return p;
    var id = "notes-" + (++proseCount);
    p.id = id;
    var box = el("div", "fold");
    box.appendChild(p);
    var btn = el("button", "more", "Show more");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id);
    btn.addEventListener("click", function () {
      var open = box.classList.toggle("open");
      if (open) box.style.setProperty("--full", p.scrollHeight + "px");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Show less" : "Show more";
      if (!open && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    var wrap = el("div", "fold-wrap");
    wrap.appendChild(box);
    wrap.appendChild(btn);
    return wrap;
  }
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

  // ---------- The app's format → what this page draws ----------
  function fromBundle(b) {
    var sp = (b && b.sp) || {}, h = sp.h || {};
    function pr(p) {
      return Array.isArray(p) && (isNum(p[0]) || isNum(p[1])) ? { min: p[0], max: p[1] } : null;
    }
    // Bloom months travel as [from, to]; From can be later in the year than To (e.g. Nov–Feb).
    function monthList(p) {
      if (!Array.isArray(p)) return [];
      var a = isNum(p[0]) ? p[0] : p[1], z = isNum(p[1]) ? p[1] : p[0];
      if (!isNum(a) || a < 1 || a > 12 || z < 1 || z > 12) return [];
      var out = [a];
      while (out[out.length - 1] !== z && out.length < 12) out.push(out[out.length - 1] % 12 + 1);
      return out;
    }
    var temps = { tempC: pr(sp.st), humidity: pr(sp.sh) };
    return {
      displayName: b && b.from,
      updatedAt: b && b.updated,
      name: {
        kingdom: h.kingdom, phylum: h.phylum, "class": h["class"], order: h.order, family: h.family,
        subfamily: h.subfamily, tribe: h.tribe, subtribe: h.subtribe,
        genus: sp.g, speciesEpithet: sp.e, variety: sp.vr, grex: sp.gx, cultivar: sp.c, type: sp.t
      },
      wateringRoots: {
        watering: sp.w, winterWatering: sp.se === true ? sp.ww : null,
        rootAirflow: sp.ra, growsBest: sp.gb, notes: sp.wn
      },
      feeding: { frequency: sp.fq, strength: sp.fs, winter: sp.fz },
      light: { text: sp.li, footCandles: pr(sp.lf), ppfd: pr(sp.pp), dli: pr(sp.dl) },
      climate: {
        mode: sp.se === true ? "seasonal" : "allYear",
        summer: temps, allYear: temps,
        winter: { tempC: pr(sp.wt), humidity: pr(sp.wh) },
        elevationM: pr(sp.el), nativeRange: sp.nr
      },
      bloom: {
        flowering: sp.fw, months: monthList(sp.bm), flowersLastDays: pr(sp.fl), color: sp.bc,
        fragrance: sp.fr, scent: sp.fn, fragrantWhen: sp.ft, flowersHeld: sp.fh,
        afterFlowering: sp.af ? [sp.af] : [], bloomsOnceThenDies: sp.md === true,
        nightDropC: sp.nd, dryRestWeeks: sp.dr, photoperiod: pr(sp.ph), notes: sp.bn
      },
      plantHealth: sp.pi, careNotes: sp.cn, description: sp.ds
    };
  }

  // ---------- Visuals ----------
  // Bloom months: a 12-month strip with the flowering months lit.
  function monthStrip(list) {
    var on = (Array.isArray(list) ? list : []).filter(function (x) { return x >= 1 && x <= 12; });
    if (!on.length) return null;
    var w = el("div", "months");
    w.setAttribute("role", "img");
    w.setAttribute("aria-label", "Blooms " + monthsText(on));
    MONTHS.forEach(function (m, i) {
      var c = el("span", on.indexOf(i + 1) !== -1 ? "on" : null, m.charAt(0));
      c.title = m;
      w.appendChild(c);
    });
    return w;
  }

  // Light: where the range sits between deep shade and full sun (log scale, 100–10,000 fc).
  function lightScale(r) {
    if (!r || !isNum(r.min) || !isNum(r.max)) return null;
    function pos(fc) { return Math.max(0, Math.min(100, (Math.log10(Math.max(fc, 1)) - 2) / 2 * 100)); }
    var w = el("div", "scale light-scale");
    w.setAttribute("role", "img");
    w.setAttribute("aria-label", "Light " + fmt(r.min) + " to " + fmt(r.max) + " foot-candles, on a scale from deep shade to full sun");
    var track = el("div", "track");
    var band = el("div", "band");
    band.style.left = pos(r.min) + "%";
    band.style.width = Math.max(2, pos(r.max) - pos(r.min)) + "%";
    track.appendChild(band);
    w.appendChild(track);
    var ends = el("div", "ends");
    ends.appendChild(el("span", null, "Deep shade"));
    ends.appendChild(el("span", null, "Full sun"));
    w.appendChild(ends);
    return w;
  }

  // Temperature: seasonal bands on one thermometer.
  function tempScale(bands) { // [{cls, r}]
    bands = bands.filter(function (b) { return b.r && isNum(b.r.min) && isNum(b.r.max); });
    if (!bands.length) return null;
    var lo = 0, hi = 40;
    bands.forEach(function (b) { lo = Math.min(lo, Math.floor((b.r.min - 2) / 5) * 5); hi = Math.max(hi, Math.ceil((b.r.max + 2) / 5) * 5); });
    function pos(c) { return (c - lo) / (hi - lo) * 100; }
    var w = el("div", "scale temp-scale");
    w.setAttribute("aria-hidden", "true"); // the numbers above already say this
    var track = el("div", "track");
    bands.forEach(function (b) {
      var band = el("div", "band " + b.cls);
      band.style.left = pos(b.r.min) + "%";
      band.style.width = Math.max(2, pos(b.r.max) - pos(b.r.min)) + "%";
      track.appendChild(band);
    });
    w.appendChild(track);
    var ticks = el("div", "ticks");
    for (var c = lo; c <= hi; c += 10) {
      var t = el("span", null, fmt(cToU(c)) + "°");
      t.style.left = pos(c) + "%";
      ticks.appendChild(t);
    }
    w.appendChild(ticks);
    return w;
  }

  function unitToggle() {
    var g = el("div", "units");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", "Temperature unit");
    ["C", "F"].forEach(function (u) {
      var b = el("button", null, "°" + u);
      b.type = "button";
      b.dataset.unit = u;
      b.setAttribute("aria-pressed", String(UNIT === u));
      b.addEventListener("click", function () {
        if (UNIT === u) return;
        setUnit(u);
        render(CURRENT, document.getElementById("sheet"));
        var again = document.querySelector('.units button[data-unit="' + u + '"]');
        if (again) again.focus();
      });
      g.appendChild(b);
    });
    return g;
  }

  // ---------- Sections ----------
  function sectionWatering(d) {
    if (!d) return null;
    var c = card("i-water", "Watering & roots");
    var winter = label("watering", d.winterWatering);
    var n = add(c, [
      stats([
        { k: winter ? "Summer watering" : "Watering", v: label("watering", d.watering) },
        winter ? { k: "Winter watering", v: winter } : null,
        { k: "Air movement", v: label("rootAirflow", d.rootAirflow) },
        { k: "Grows best", v: label("growsBest", d.growsBest) }
      ]),
      prose(d.notes)
    ]);
    return n ? c : null;
  }

  function sectionFeeding(d) {
    if (!d) return null;
    var c = card("i-feed", "Feeding");
    var n = add(c, [
      stats([
        { k: "How often", v: label("feedingFrequency", d.frequency) },
        { k: "Strength", v: label("feedingStrength", d.strength) },
        { k: "In winter", v: label("feedingWinter", d.winter) }
      ])
    ]);
    return n ? c : null;
  }

  function sectionLight(d) {
    if (!d) return null;
    var c = card("i-light", "Light");
    var n = add(c, [
      prose(d.text, "lead-ish"),
      lightScale(d.footCandles),
      rows([
        r(range(d.footCandles, " fc", toLux), "Intensity"),
        r(range(d.ppfd, " µmol/m²/s"), "PPFD"),
        r(range(d.dli, " mol/m²/day"), "DLI")
      ])
    ]);
    return n ? c : null;
  }

  function climateCol(title, s, cls) {
    if (!s) return null;
    var t = tempRange(s.tempC), h = range(s.humidity, "% humidity");
    if (!t && !h) return null;
    var col = el("div", "sh-season " + (cls || ""));
    if (title) col.appendChild(el("span", "k", title));
    if (t) { col.appendChild(el("span", "v", t)); col.appendChild(el("span", "sub", "Night to day")); }
    if (h) col.appendChild(el("span", "h", h.main));
    return col;
  }

  function sectionClimate(d) {
    if (!d) return null;
    var c = card("i-climate", "Climate");
    var cols = el("div", "sh-seasons");
    var n = 0;
    var scale;
    if (d.mode === "seasonal") {
      n += add(cols, [climateCol("Summer (growing)", d.summer, "summer"), climateCol("Winter (rest)", d.winter, "winter")]);
      scale = tempScale([{ cls: "winter", r: d.winter && d.winter.tempC }, { cls: "summer", r: d.summer && d.summer.tempC }]);
    } else {
      n += add(cols, [climateCol("All year", d.allYear, "summer")]);
      scale = tempScale([{ cls: "summer", r: d.allYear && d.allYear.tempC }]);
    }
    if (n) {
      c.querySelector(".sh-head").appendChild(unitToggle());
      c.appendChild(cols);
      if (scale) c.appendChild(scale);
    }
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
    var season = monthsText(d.months);
    var n = add(c, [
      season ? el("p", "season-line", season === "All year" ? "Blooms all year" : "Blooms " + season) : null,
      monthStrip(d.months),
      rows([
        d.flowering === "rarely" ? { k: "Flowering", v: "Rarely indoors" } : null,
        r(range(d.flowersLastDays, d.flowersLastDays && d.flowersLastDays.max === 1 ? " day" : " days"), "Flowers last"),
        { k: "Color", v: hasText(d.color) ? d.color.trim() : null },
        { k: "Fragrance", v: label("fragrance", d.fragrance) },
        { k: "Scent", v: scents.join(", ") || null },
        { k: "Fragrant", v: when.join(", ") || null },
        { k: "Flowers held", v: label("flowersHeld", d.flowersHeld) },
        { k: "After flowering", v: after.join(", ") || null },
        d.bloomsOnceThenDies === true ? { k: "Life cycle", v: "Blooms once, then dies. Keep the pups." } : null,
        isNum(d.nightDropC) ? { k: "Night drop", v: (UNIT === "F" ? fmt(d.nightDropC * 9 / 5) + " °F" : fmt(d.nightDropC) + " °C") + " cooler at night" } : null,
        isNum(d.dryRestWeeks) ? { k: "Dry rest", v: fmt(d.dryRestWeeks) + (d.dryRestWeeks === 1 ? " week" : " weeks") } : null,
        r(range(d.photoperiod, " hours of light"), "Photoperiod")
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

  var CURRENT = null;
  function render(raw, root) {
    CURRENT = raw;
    var share = fromBundle(raw);
    proseCount = 0;
    var name = share.name || {};

    root.textContent = "";
    var title = [name.genus, name.speciesEpithet].filter(hasText).join(" ");
    if (title) document.title = title + " · Care sheet · Veya";

    var meta = el("p", "sh-meta");
    meta.appendChild(el("span", "by", "Care sheet shared by " + (hasText(share.displayName) ? share.displayName.trim() : "a Veya grower")));
    var upd = dateText(share.updatedAt);
    if (upd) meta.appendChild(el("span", null, "Updated " + upd));
    if (name.gbifMatch === "exact") meta.appendChild(el("span", "ok", "Name verified with GBIF"));

    root.appendChild(nameBlock(name));
    root.appendChild(meta);

    var any = add(root, [
      sectionWatering(share.wateringRoots),
      sectionFeeding(share.feeding),
      sectionLight(share.light),
      sectionClimate(share.climate),
      sectionBloom(share.bloom),
      sectionHealth(share.plantHealth),
      sectionText("i-notes", "Care notes", share.careNotes),
      sectionText("i-desc", "About this plant", share.description)
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
