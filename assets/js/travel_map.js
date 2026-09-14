/**
 * US travel map.
 *
 * A Leaflet map that frames the lower 48, dims everything that is not a visited
 * state, drops a pin on every US national park, and shows a photo collage when
 * a visited state is hovered.
 *
 * Design notes:
 *  - Tiles are requested with detectRetina, so HiDPI screens get the next zoom
 *    level's imagery rather than an upscaled blur.
 *  - Place names from the tile provider are off by default. They bury the
 *    imagery in text; visited states carry their own label instead.
 *  - Everything outside the country is covered by a single mask polygon built
 *    from the state outlines, which keeps the eye on the US.
 *
 * Config and data are injected by _includes/us_visited_states_map.html into a
 * <script type="application/json" id="travel-map-data"> block. Colours come from
 * CSS custom properties in _sass/_travel_map.scss, so the palette stays in the
 * stylesheet and this file stays generic.
 */
(function () {
  "use strict";

  var root = document.getElementById("travel-map");
  var canvas = document.getElementById("travel-map-canvas");
  var cardEl = document.getElementById("travel-map-card");
  var loadingEl = document.getElementById("travel-map-loading");
  var dataEl = document.getElementById("travel-map-data");
  if (!root || !canvas || !dataEl) return;

  function fail(message) {
    if (loadingEl) {
      loadingEl.textContent = message;
      loadingEl.classList.add("is-error");
    }
  }

  var CFG;
  try {
    CFG = JSON.parse(dataEl.textContent);
  } catch (err) {
    fail("Map data could not be read.");
    return;
  }

  if (typeof window.L === "undefined") {
    fail("Map library did not load.");
    return;
  }

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  var VIEWS = {
    world: L.latLngBounds(CFG.view.worldSouthwest, CFG.view.worldNortheast),
    usa: L.latLngBounds(CFG.view.usaSouthwest, CFG.view.usaNortheast)
  };
  var VIEW_ORDER = ["world", "usa"];
  var VIEW_LABELS = { world: "World", usa: "USA" };
  var currentView = VIEWS[CFG.view.defaultView] ? CFG.view.defaultView : "world";
  // Below this zoom the city labels collide with each other, so they stay off.
  var PLACE_LABEL_ZOOM = 4;

  /* ---------------------------------------------------------------- basemaps */

  var ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  var ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';

  var BASEMAPS = {
    satellite: {
      label: "Satellite",
      base: function () {
        return L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          detectRetina: true,
          maxZoom: 19,
          attribution: ESRI_ATTR + ", Maxar, Earthstar Geographics"
        });
      },
      labels: function () {
        return L.tileLayer(
          ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { detectRetina: true, maxZoom: 19, pane: "travel-labels" }
        );
      }
    },
    terrain: {
      label: "Terrain",
      base: function () {
        // World_Physical_Map is natural-colour relief with no baked-in text,
        // which is what lets the Labels toggle mean anything here.
        return L.tileLayer(ESRI + "World_Physical_Map/MapServer/tile/{z}/{y}/{x}", {
          detectRetina: true,
          maxZoom: 19,
          maxNativeZoom: 8,
          attribution: ESRI_ATTR + ", USGS, NOAA"
        });
      },
      labels: function () {
        return L.tileLayer(
          ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { detectRetina: true, maxZoom: 19, pane: "travel-labels" }
        );
      }
    },
    minimal: {
      label: "Minimal",
      base: function () {
        // Esri's Light Gray Canvas rather than CARTO Positron: CARTO now stamps
        // "API KEY REQUIRED" across its keyless tiles.
        return L.tileLayer(ESRI + "Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          detectRetina: true,
          maxZoom: 16,
          attribution: ESRI_ATTR + ", HERE, Garmin, &copy; OpenStreetMap contributors"
        });
      },
      labels: function () {
        return L.tileLayer(
          ESRI + "Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          { detectRetina: true, maxZoom: 16, pane: "travel-labels" }
        );
      }
    }
  };

  var BASEMAP_ORDER = ["satellite", "terrain", "minimal"];
  var currentBasemap = BASEMAPS[CFG.view.basemap] ? CFG.view.basemap : "satellite";
  var showLabels = !!CFG.view.showLabels;
  var showParks = CFG.view.showParks !== false;

  var baseLayer = null;
  var labelLayer = null;

  /* ------------------------------------------------------------------ palette */

  var PAL = {};

  function readPalette() {
    var cs = getComputedStyle(root);
    function v(name, fallback) {
      var value = cs.getPropertyValue(name).trim();
      return value || fallback;
    }
    PAL = {
      accent: v("--travel-accent", "#ffd24a"),
      accentFill: v("--travel-accent-fill", "#ffd24a"),
      visitedFill: parseFloat(v("--travel-visited-fill-opacity", "0")),
      visitedHoverFill: parseFloat(v("--travel-visited-hover-fill-opacity", "0.18")),
      visitedWeight: parseFloat(v("--travel-visited-weight", "2.2")),
      scrim: v("--travel-scrim", "#070c16"),
      scrimFill: parseFloat(v("--travel-scrim-opacity", "0.62")),
      mask: v("--travel-mask", "#070c16"),
      maskFill: parseFloat(v("--travel-mask-opacity", "0.78")),
      border: v("--travel-border", "#9aa4b4"),
      borderOpacity: parseFloat(v("--travel-border-opacity", "0.3")),
      pinVisited: v("--travel-pin-visited", "#3ae37f"),
      pinPending: v("--travel-pin-pending", "#e8eef7"),
      pinPendingRing: v("--travel-pin-pending-ring", "#e8eef7"),
      pinRing: v("--travel-pin-ring", "#ffffff"),
      city: v("--travel-city", "#ffd24a"),
      cityRing: v("--travel-city-ring", "#ffffff")
    };
  }

  /* --------------------------------------------------------------- index data */

  var statesByCode = {};
  (CFG.states || []).forEach(function (s) {
    statesByCode[s.code] = s;
  });

  var parksByState = {};
  (CFG.parks || []).forEach(function (p) {
    (parksByState[p.state] = parksByState[p.state] || []).push(p);
  });

  function isVisited(code) {
    return Object.prototype.hasOwnProperty.call(statesByCode, code);
  }

  var usName = CFG.usCountry || "United States";

  var countriesByName = {};
  (CFG.countries || []).forEach(function (c) {
    countriesByName[c.name] = c;
  });

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ----------------------------------------------------------------- the map */

  var map = L.map(canvas, {
    minZoom: CFG.view.minZoom,
    maxZoom: CFG.view.maxZoom,
    zoomControl: false,
    // Half-steps let fitBounds frame the world snugly on a phone instead of
    // jumping to the next whole zoom and cropping Japan or Colorado off.
    zoomSnap: 0.5,
    scrollWheelZoom: false, // enabled once the user clicks into the map
    zoomAnimation: !reduceMotion,
    fadeAnimation: !reduceMotion,
    attributionControl: true
  });

  map.createPane("travel-mask").style.zIndex = 390;
  map.getPane("travel-mask").style.pointerEvents = "none";
  map.createPane("travel-labels").style.zIndex = 450;
  map.getPane("travel-labels").style.pointerEvents = "none";
  map.createPane("travel-rings").style.zIndex = 610;
  map.createPane("travel-pins").style.zIndex = 620;

  map.fitBounds(VIEWS[currentView]);
  map.addControl(L.control.zoom({ position: "bottomright" }));
  map.attributionControl.setPrefix("");

  readPalette();
  applyBasemap(true);

  // Scrolling the page over the map should scroll the page, not zoom. One click
  // into the map opts into wheel zoom; leaving the map opts back out.
  function activateWheel() {
    map.scrollWheelZoom.enable();
    root.classList.add("is-active");
  }
  function deactivateWheel() {
    map.scrollWheelZoom.disable();
    root.classList.remove("is-active");
  }
  canvas.addEventListener("click", activateWheel);
  canvas.addEventListener("focusin", activateWheel);
  canvas.addEventListener("mouseleave", deactivateWheel);
  canvas.addEventListener("focusout", deactivateWheel);

  /* ------------------------------------------------------------ basemap swap */

  function applyBasemap(skipRestyle) {
    if (baseLayer) map.removeLayer(baseLayer);
    if (labelLayer) map.removeLayer(labelLayer);

    baseLayer = BASEMAPS[currentBasemap].base();
    baseLayer.addTo(map);

    labelLayer = null;
    if (showLabels && BASEMAPS[currentBasemap].labels) {
      labelLayer = BASEMAPS[currentBasemap].labels();
      labelLayer.addTo(map);
    }

    BASEMAP_ORDER.forEach(function (k) {
      root.classList.toggle("travel-map--" + k, k === currentBasemap);
    });

    readPalette();
    if (!skipRestyle) restyleAll();
    syncControls();
  }

  function syncControls() {
    Array.prototype.forEach.call(root.querySelectorAll("[data-basemap]"), function (b) {
      var on = b.getAttribute("data-basemap") === currentBasemap;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-view-btn]"), function (b) {
      var on = b.getAttribute("data-view-btn") === currentView;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var toggles = { labels: showLabels, parks: showParks };
    Array.prototype.forEach.call(root.querySelectorAll("[data-toggle-layer]"), function (b) {
      var on = !!toggles[b.getAttribute("data-toggle-layer")];
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ------------------------------------------------------- layers and styles */

  var statesLayer = null;
  var maskLayer = null;
  var countriesLayer = null;
  var parksLayer = L.layerGroup();
  var placesLayer = L.layerGroup();
  var parkMarkers = [];
  var placeMarkers = [];
  var countryRings = [];

  function styleState(feature) {
    var code = feature.properties.abbr;
    if (isVisited(code)) {
      return {
        className: "travel-state travel-state--visited",
        color: PAL.accent,
        weight: PAL.visitedWeight,
        opacity: 1,
        fillColor: PAL.accentFill,
        // Zoomed out to the world an outline alone is a hairline, so visited
        // shapes take a fill there even when the US framing leaves them clear.
        fillOpacity: currentView === "usa" ? PAL.visitedFill : Math.max(PAL.visitedFill, 0.22)
      };
    }
    // The scrim belongs to the USA framing. Zoomed out to the whole world it
    // would dim North America for no reason while Taiwan and Brazil sit lit.
    return {
      className: "travel-state",
      color: PAL.border,
      weight: currentView === "usa" ? 0.6 : 0,
      opacity: currentView === "usa" ? PAL.borderOpacity : 0,
      fillColor: PAL.scrim,
      fillOpacity: currentView === "usa" ? PAL.scrimFill : 0
    };
  }

  function styleCountry() {
    return {
      className: "travel-state travel-state--visited",
      color: PAL.accent,
      weight: PAL.visitedWeight,
      opacity: 1,
      fillColor: PAL.accentFill,
      // Countries are drawn at world scale where an outline alone disappears,
      // so they always carry some fill even when states do not.
      fillOpacity: Math.max(PAL.visitedFill, 0.22)
    };
  }

  function placeStyle(place) {
    return {
      radius: place.home ? 7 : 5,
      color: PAL.cityRing,
      weight: place.home ? 2.5 : 1.6,
      opacity: 1,
      fillColor: PAL.city,
      fillOpacity: 1,
      className: "travel-city" + (place.home ? " travel-city--home" : "")
    };
  }

  function maskStyle() {
    return {
      className: "travel-mask",
      stroke: false,
      fillColor: PAL.mask,
      fillOpacity: PAL.maskFill,
      fillRule: "evenodd",
      interactive: false
    };
  }

  function parkStyle(park) {
    return {
      radius: park.visited ? 6.5 : 3,
      color: park.visited ? PAL.pinRing : PAL.pinPendingRing,
      weight: park.visited ? 2 : 1,
      opacity: park.visited ? 1 : 0.55,
      fillColor: park.visited ? PAL.pinVisited : PAL.pinPending,
      fillOpacity: park.visited ? 1 : 0.3,
      className: "travel-pin" + (park.visited ? " travel-pin--visited" : "")
    };
  }

  function restyleAll() {
    if (statesLayer) statesLayer.setStyle(styleState);
    if (countriesLayer) countriesLayer.setStyle(styleCountry);
    if (maskLayer) maskLayer.setStyle(maskStyle());
    parkMarkers.forEach(function (entry) {
      entry.marker.setStyle(parkStyle(entry.park));
    });
    placeMarkers.forEach(function (entry) {
      entry.marker.setStyle(placeStyle(entry.place));
    });
    countryRings.forEach(function (entry) {
      entry.ring.setStyle({ color: PAL.accent });
    });
    syncCountryRings();
  }

  /** Switch between the world framing and the US framing. */
  function setView(next) {
    if (!VIEWS[next]) return;
    currentView = next;

    VIEW_ORDER.forEach(function (v) {
      root.classList.toggle("travel-map--view-" + v, v === next);
    });

    if (maskLayer) {
      if (next === "usa") maskLayer.addTo(map);
      else map.removeLayer(maskLayer);
    }
    if (next === "usa" && showParks) parksLayer.addTo(map);
    else map.removeLayer(parksLayer);

    restyleAll();
    map.fitBounds(VIEWS[next]);
    syncControls();
  }

  function syncZoomClass() {
    root.classList.toggle("is-zoomed", map.getZoom() >= PLACE_LABEL_ZOOM);
  }

  /**
   * Show a country's locator ring only while the country itself is too small to
   * pick out. Brazil never needs one; Taiwan needs one until you zoom right in.
   */
  var RING_MIN_PX = 26;

  function syncCountryRings() {
    countryRings.forEach(function (entry) {
      var b = entry.layer.getBounds();
      var nw = map.latLngToLayerPoint(b.getNorthWest());
      var se = map.latLngToLayerPoint(b.getSouthEast());
      var span = Math.max(Math.abs(se.x - nw.x), Math.abs(se.y - nw.y));
      var small = span < RING_MIN_PX;
      entry.ring.setStyle({ opacity: small ? 0.9 : 0 });
      if (entry.ring._path) {
        entry.ring._path.style.pointerEvents = small ? "all" : "none";
      }
    });
  }

  /**
   * One polygon covering the world, with every state outline punched out of it
   * as a hole. With the even-odd fill rule the country reads as a window onto
   * the imagery and everything else sits under a scrim.
   */
  function buildMask(geo) {
    var world = [
      [-200, -85], [-200, 85], [200, 85], [200, -85], [-200, -85]
    ];
    var rings = [world];
    geo.features.forEach(function (f) {
      var g = f.geometry;
      var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      polys.forEach(function (poly) {
        rings.push(poly[0]); // exterior ring only
      });
    });
    return L.geoJSON(
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } },
      { style: maskStyle, pane: "travel-mask", interactive: false }
    );
  }

  function onEachState(feature, layer) {
    var code = feature.properties.abbr;
    var name = feature.properties.name;

    if (!isVisited(code)) {
      layer.bindTooltip(name, { direction: "top", sticky: true, className: "travel-tip" });
      return;
    }

    layer.bindTooltip(name, {
      permanent: true,
      direction: "center",
      className: "travel-label",
      interactive: false
    });

    layer.on("mouseover", function (e) {
      layer.setStyle({ fillOpacity: PAL.visitedHoverFill, weight: PAL.visitedWeight + 1.2 });
      if (layer.bringToFront) layer.bringToFront();
      if (canHover) openPlace(stateCard(code, name), e.containerPoint);
    });

    layer.on("mousemove", function (e) {
      if (canHover && !pinned) positionCard(e.containerPoint);
    });

    layer.on("mouseout", function () {
      layer.setStyle({ fillOpacity: PAL.visitedFill, weight: PAL.visitedWeight });
      if (canHover && !pinned) closePlace();
    });

    layer.on("click", function (e) {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      pinned = true;
      root.classList.add("travel-map--card-pinned");
      openPlace(stateCard(code, name), e.containerPoint);
    });
  }

  function buildParks() {
    (CFG.parks || []).forEach(function (park) {
      var opts = parkStyle(park);
      opts.pane = "travel-pins";
      opts.bubblingMouseEvents = false;
      var marker = L.circleMarker([park.lat, park.lng], opts);
      marker.bindTooltip(park.name, { direction: "top", className: "travel-tip", offset: [0, -4] });
      marker.bindPopup(
        '<div class="travel-popup">' +
          '<div class="travel-popup__title">' + esc(park.name) + "</div>" +
          '<div class="travel-popup__meta">' + esc(park.gateway) + "</div>" +
          '<div class="travel-popup__badge' + (park.visited ? " is-visited" : "") + '">' +
            (park.visited ? "Visited" : "Not yet") +
          "</div>" +
        "</div>",
        { className: "travel-popup-wrap", closeButton: true }
      );
      parksLayer.addLayer(marker);
      parkMarkers.push({ marker: marker, park: park });
    });
  }

  /** Attach hover, tap and label behaviour shared by countries and cities. */
  function wireCard(layer, card, labelClass, labelOpts) {
    layer.bindTooltip(card.name, L.extend({
      permanent: true,
      className: labelClass,
      interactive: false
    }, labelOpts || {}));

    layer.on("mouseover", function (e) {
      if (canHover) openPlace(card, e.containerPoint);
    });
    layer.on("mousemove", function (e) {
      if (canHover && !pinned) positionCard(e.containerPoint);
    });
    layer.on("mouseout", function () {
      if (canHover && !pinned) closePlace();
    });
    layer.on("click", function (e) {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      pinned = true;
      root.classList.add("travel-map--card-pinned");
      openPlace(card, e.containerPoint);
    });
  }

  /**
   * Taiwan is about three pixels across on a world map, so the outline alone is
   * not findable. Each visited country also gets a ring at its centre that
   * fades out once you zoom in far enough to see the real shape.
   */
  function addCountryRing(layer, card) {
    var ring = L.circleMarker(layer.getBounds().getCenter(), {
      radius: 11,
      color: PAL.accent,
      weight: 2,
      opacity: 0.9,
      fill: true,
      fillOpacity: 0,
      className: "travel-country-ring",
      pane: "travel-rings",
      bubblingMouseEvents: false
    });
    ring.on("mouseover", function (e) {
      if (canHover) openPlace(card, e.containerPoint);
    });
    ring.on("mouseout", function () {
      if (canHover && !pinned) closePlace();
    });
    ring.on("click", function (e) {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      pinned = true;
      root.classList.add("travel-map--card-pinned");
      openPlace(card, e.containerPoint);
    });
    countryRings.push({ ring: ring, layer: layer });
    ring.addTo(map);
  }

  function buildCountries(geo) {
    return L.geoJSON(geo, {
      style: styleCountry,
      bubblingMouseEvents: false,
      filter: function (feature) {
        return Object.prototype.hasOwnProperty.call(countriesByName, feature.properties.name);
      },
      onEachFeature: function (feature, layer) {
        var c = countriesByName[feature.properties.name];
        if (!c) return;
        var card = { name: c.label || c.name, note: c.note, photos: c.photos };
        wireCard(layer, card, "travel-country-label", { direction: "center" });
        addCountryRing(layer, card);
      }
    });
  }

  function buildPlaces() {
    (CFG.places || []).forEach(function (place) {
      var opts = placeStyle(place);
      opts.pane = "travel-pins";
      opts.bubblingMouseEvents = false;
      var marker = L.circleMarker([place.lat, place.lng], opts);
      var where = place.region
        ? place.region + ", " + place.country
        : (place.name === place.country ? "" : place.country);
      wireCard(
        marker,
        {
          name: place.name,
          where: where,
          note: place.note,
          photos: place.photos,
          home: place.home
        },
        "travel-place-label" + (place.home ? " travel-place-label--home" : ""),
        { direction: "right", offset: [9, 0] }
      );
      placesLayer.addLayer(marker);
      placeMarkers.push({ marker: marker, place: place });
    });
  }

  /* ---------------------------------------------------------- photo spread */

  /**
   * Hovering a place throws its photos out across the whole viewport, and
   * leaving it pulls them back into the place they came from.
   *
   * The overlay lives on <body> rather than inside the map, because the map
   * shell clips its own overflow, and it keeps `pointer-events: none` so that
   * covering the screen never steals the hover that is keeping it open. That
   * would otherwise flicker: overlay appears, cursor is no longer on the state,
   * mouseout fires, overlay closes, cursor is on the state again.
   */

  var SPREAD_MAX = 12;
  var SPREAD_STAGGER = 38;

  var spreadEl = null;
  var spreadTimer = null;

  function ensureSpread() {
    if (!spreadEl) {
      spreadEl = document.createElement("div");
      spreadEl.className = "travel-spread";
      spreadEl.setAttribute("aria-hidden", "true");
      // Only reachable while pinned, since the overlay is otherwise
      // pointer-events: none. On a touch screen it is the only way out.
      spreadEl.addEventListener("click", function () {
        if (pinned) unpinCard();
      });
      document.body.appendChild(spreadEl);
    }
    return spreadEl;
  }

  /** Small deterministic PRNG so a place scatters the same way every time. */
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6d2b79f5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Jittered grid across the viewport, sized to the number of photos.
   *
   * Photos keep their own aspect ratio rather than being cropped to a box, so
   * the height is not known here. Sizing budgets for the tallest common shape
   * and clamps every tile inside the viewport, which is what stops a portrait
   * shot from hanging off the bottom edge.
   */
  var SPREAD_PAD = 16;
  var SPREAD_TITLE_BAND = 120; // room at the foot for the place name
  var SPREAD_TALLEST = 1.4; // a little taller than 3:4

  function spreadLayout(n, rnd) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var usableH = Math.max(220, vh - SPREAD_TITLE_BAND);

    var cols = Math.max(1, Math.round(Math.sqrt(n * vw / usableH)));
    var rows = Math.ceil(n / cols);
    var cellW = vw / cols;
    var cellH = usableH / rows;

    // Under-fill each cell so neighbours do not crowd each other.
    var base = Math.min(cellW, cellH / SPREAD_TALLEST) * 0.82;
    base = Math.max(110, Math.min(base, Math.min(vw, usableH) * 0.4));

    // Never let a tile be wide enough that its tallest possible form spills.
    var maxW = (usableH - 2 * SPREAD_PAD) / SPREAD_TALLEST;

    var out = [];
    for (var i = 0; i < n; i++) {
      var col = i % cols;
      var row = Math.floor(i / cols);
      var inRow = Math.min(cols, n - row * cols);
      var indent = (cols - inRow) * cellW / 2; // centre a short last row

      var w = Math.min(base * (0.82 + rnd() * 0.34), maxW);
      var hEst = w * SPREAD_TALLEST;

      var x = indent + col * cellW + cellW / 2 + (rnd() - 0.5) * cellW * 0.3;
      var y = row * cellH + cellH / 2 + (rnd() - 0.5) * cellH * 0.3;

      x = Math.max(w / 2 + SPREAD_PAD, Math.min(x, vw - w / 2 - SPREAD_PAD));
      y = Math.max(hEst / 2 + SPREAD_PAD, Math.min(y, usableH - hEst / 2 - SPREAD_PAD));

      out.push({ x: x, y: y, rot: (rnd() - 0.5) * 12, size: w });
    }
    return out;
  }

  function showSpread(card, origin) {
    var photos = (card.photos || []).slice(0, SPREAD_MAX);
    if (!photos.length) return false;

    var el = ensureSpread();
    window.clearTimeout(spreadTimer);

    var rnd = seeded(card.name);
    var pos = spreadLayout(photos.length, rnd);
    var extra = (card.photos || []).length - photos.length;

    var html = '<div class="travel-spread__scrim"></div>';
    html +=
      '<div class="travel-spread__title">' +
        '<span class="travel-spread__name">' + esc(card.name) + "</span>" +
        (card.where ? '<span class="travel-spread__where">' + esc(card.where) + "</span>" : "") +
        (extra > 0 ? '<span class="travel-spread__more">+' + extra + " more</span>" : "") +
      "</div>";

    photos.forEach(function (photo, i) {
      var p = pos[i];
      html +=
        '<figure class="travel-spread__tile" style="' +
          "width:" + Math.round(p.size) + "px;" +
          "--tx:" + Math.round(p.x) + "px;" +
          "--ty:" + Math.round(p.y) + "px;" +
          "--rot:" + p.rot.toFixed(1) + "deg;" +
          "--ox:" + Math.round(origin.x) + "px;" +
          "--oy:" + Math.round(origin.y) + "px;" +
          "transition-delay:" + (i * SPREAD_STAGGER) + "ms" +
        '">' +
          '<img src="' + esc(photo.thumb) + '" data-fallback="' + esc(photo.src) +
            '" alt="' + esc(photo.caption || card.name) + '" decoding="async" />' +
          (photo.caption
            ? '<figcaption class="travel-spread__caption">' + esc(photo.caption) + "</figcaption>"
            : "") +
        "</figure>";
    });

    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll("img[data-fallback]"), function (img) {
      img.addEventListener("error", function onError() {
        img.removeEventListener("error", onError);
        img.src = img.getAttribute("data-fallback");
      });
    });

    void el.offsetWidth; // commit the closed state before flipping it open
    el.classList.add("is-open");
    el.classList.toggle("is-pinned", pinned);
    el.setAttribute("aria-hidden", "false");
    return true;
  }

  function hideSpread() {
    if (!spreadEl || !spreadEl.classList.contains("is-open")) return;

    // Condense back last-out-first, so the scatter collapses rather than
    // collapsing in the same order it opened.
    var tiles = spreadEl.querySelectorAll(".travel-spread__tile");
    var n = tiles.length;
    Array.prototype.forEach.call(tiles, function (tile, i) {
      tile.style.transitionDelay = (n - 1 - i) * 20 + "ms";
    });

    spreadEl.classList.remove("is-open", "is-pinned");
    spreadEl.setAttribute("aria-hidden", "true");
    window.clearTimeout(spreadTimer);
    spreadTimer = window.setTimeout(function () {
      if (spreadEl && !spreadEl.classList.contains("is-open")) spreadEl.innerHTML = "";
    }, 900);
  }

  /** Map container point -> viewport point, for the spread's origin. */
  function toViewport(containerPoint) {
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + containerPoint.x, y: rect.top + containerPoint.y };
  }

  /**
   * A place with photos gets the full-screen spread; one without falls back to
   * the small card, since taking over the screen to say "nothing here yet"
   * would be a poor trade.
   */
  function openPlace(card, containerPoint) {
    if (card.photos && card.photos.length) {
      hideCard();
      showSpread(card, toViewport(containerPoint));
    } else {
      hideSpread();
      showCard(card, containerPoint);
    }
  }

  function closePlace() {
    hideCard();
    hideSpread();
  }

  window.addEventListener("resize", hideSpread);

  /* ------------------------------------------------------------- hover card */

  var pinned = false;

  /** Build the descriptor the card renders from, for a US state. */
  function stateCard(code, name) {
    var info = statesByCode[code] || { photos: [], note: "" };
    var parks = parksByState[code] || [];
    var parksDone = parks.filter(function (p) { return p.visited; }).length;
    var meta = [];
    if (parks.length) {
      meta.push(parksDone + "/" + plural(parks.length, "park", "parks"));
    }
    return {
      name: name,
      where: usName,
      note: info.note,
      photos: info.photos,
      meta: meta
    };
  }

  function buildCard(card) {
    var limit = CFG.view.photoLimit || 5;
    var name = card.name;
    var all = card.photos || [];
    var photos = all.slice(0, limit);
    var extra = all.length - photos.length;
    var info = { note: card.note };

    var meta = (card.meta || []).slice();
    if (all.length) meta.push(plural(all.length, "photo", "photos"));

    var html =
      '<div class="travel-card__head">' +
        '<span class="travel-card__name">' + esc(name) + "</span>" +
        (meta.length ? '<span class="travel-card__meta">' + esc(meta.join("  ·  ")) + "</span>" : "") +
      "</div>";

    if (info.note) html += '<p class="travel-card__note">' + esc(info.note) + "</p>";

    if (photos.length) {
      html += '<div class="travel-card__collage travel-card__collage--n' + photos.length + '">';
      photos.forEach(function (photo, i) {
        html +=
          '<div class="travel-card__tile">' +
            '<img src="' + esc(photo.thumb) + '" alt="' +
              esc(photo.caption || name + " photo " + (i + 1)) +
              '" loading="lazy" decoding="async" data-fallback="' + esc(photo.src) + '" />' +
            (i === photos.length - 1 && extra > 0
              ? '<span class="travel-card__more">+' + extra + "</span>"
              : "") +
          "</div>";
      });
      html += "</div>";
    } else {
      html +=
        '<div class="travel-card__empty">' +
          '<span class="travel-card__empty-icon" aria-hidden="true">▢</span>' +
          "<span>Photos coming soon</span>" +
        "</div>";
    }

    if (pinned) {
      html += '<button type="button" class="travel-card__close" aria-label="Close">&times;</button>';
    }
    return html;
  }

  function showCard(card, containerPoint) {
    cardEl.innerHTML = buildCard(card);
    cardEl.classList.add("is-visible");
    cardEl.classList.toggle("travel-map__card--home", !!card.home);
    cardEl.setAttribute("aria-hidden", "false");

    Array.prototype.forEach.call(cardEl.querySelectorAll("img[data-fallback]"), function (img) {
      img.addEventListener("error", function onError() {
        img.removeEventListener("error", onError);
        img.src = img.getAttribute("data-fallback");
      });
    });

    var close = cardEl.querySelector(".travel-card__close");
    if (close) {
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        unpinCard();
      });
    }

    if (pinned) {
      cardEl.style.transform = ""; // pinned cards are placed by the stylesheet
    } else {
      positionCard(containerPoint);
    }
  }

  function positionCard(containerPoint) {
    if (!containerPoint) return;
    var size = map.getSize();
    var pad = 12;
    var w = cardEl.offsetWidth;
    var h = cardEl.offsetHeight;

    var x = containerPoint.x + 20;
    var y = containerPoint.y + 20;
    if (x + w + pad > size.x) x = containerPoint.x - w - 20;
    if (x < pad) x = pad;
    if (y + h + pad > size.y) y = containerPoint.y - h - 20;
    if (y < pad) y = pad;

    cardEl.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
  }

  function hideCard() {
    cardEl.classList.remove("is-visible");
    cardEl.setAttribute("aria-hidden", "true");
  }

  function unpinCard() {
    pinned = false;
    root.classList.remove("travel-map--card-pinned");
    hideCard();
    hideSpread();
  }

  map.on("click", function () {
    if (pinned) unpinCard();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && pinned) unpinCard();
  });

  /* -------------------------------------------------------------- controls */

  var MapControls = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
      var wrap = L.DomUtil.create("div", "travel-controls");

      var styles = L.DomUtil.create("div", "travel-controls__group", wrap);
      styles.setAttribute("role", "group");
      styles.setAttribute("aria-label", "Basemap style");
      BASEMAP_ORDER.forEach(function (key) {
        var btn = L.DomUtil.create("button", "travel-controls__btn", styles);
        btn.type = "button";
        btn.textContent = BASEMAPS[key].label;
        btn.setAttribute("data-basemap", key);
        L.DomEvent.on(btn, "click", function (e) {
          L.DomEvent.stop(e);
          currentBasemap = key;
          applyBasemap();
        });
      });

      var opts = L.DomUtil.create("div", "travel-controls__group travel-controls__group--sub", wrap);
      opts.setAttribute("role", "group");
      opts.setAttribute("aria-label", "Map detail");

      VIEW_ORDER.forEach(function (key) {
        var btn = L.DomUtil.create("button", "travel-controls__btn", opts);
        btn.type = "button";
        btn.textContent = VIEW_LABELS[key];
        btn.setAttribute("data-view-btn", key);
        L.DomEvent.on(btn, "click", function (e) {
          L.DomEvent.stop(e);
          setView(key);
        });
      });

      var parksBtn = L.DomUtil.create("button", "travel-controls__btn", opts);
      parksBtn.type = "button";
      parksBtn.textContent = "Parks";
      parksBtn.setAttribute("data-toggle-layer", "parks");
      parksBtn.setAttribute("title", "Show or hide the national park pins");
      L.DomEvent.on(parksBtn, "click", function (e) {
        L.DomEvent.stop(e);
        showParks = !showParks;
        if (showParks && currentView === "usa") parksLayer.addTo(map);
        else map.removeLayer(parksLayer);
        syncControls();
      });

      var labelsBtn = L.DomUtil.create("button", "travel-controls__btn", opts);
      labelsBtn.type = "button";
      labelsBtn.textContent = "Labels";
      labelsBtn.setAttribute("data-toggle-layer", "labels");
      labelsBtn.setAttribute("title", "Show or hide place names from the tile provider");
      L.DomEvent.on(labelsBtn, "click", function (e) {
        L.DomEvent.stop(e);
        showLabels = !showLabels;
        applyBasemap();
      });


      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    }
  });

  map.addControl(new MapControls());
  syncControls();

  /* ------------------------------------------------------------ boundaries */

  function getJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
      return res.json();
    });
  }

  Promise.all([
    getJSON(CFG.geojson),
    // A missing or empty country file should not take the whole map down.
    (CFG.countries || []).length
      ? getJSON(CFG.countriesGeojson).catch(function (err) {
          console.warn("[travel-map] country outlines unavailable:", err.message);
          return null;
        })
      : Promise.resolve(null)
  ])
    .then(function (results) {
      var geo = results[0];
      var world = results[1];

      maskLayer = buildMask(geo);
      statesLayer = L.geoJSON(geo, {
        style: styleState,
        onEachFeature: onEachState,
        bubblingMouseEvents: false
      }).addTo(map);

      if (world) {
        countriesLayer = buildCountries(world).addTo(map);
        var drawn = {};
        countriesLayer.eachLayer(function (l) {
          drawn[l.feature.properties.name] = true;
        });
        Object.keys(countriesByName).forEach(function (name) {
          if (!drawn[name]) {
            console.warn(
              '[travel-map] "' + name + '" is not in visited-countries.geojson. ' +
              "Run: python3 bin/build_country_shapes.py"
            );
          }
        });
      }

      buildParks();
      buildPlaces();
      placesLayer.addTo(map);

      map.on("zoomend", function () {
        syncZoomClass();
        syncCountryRings();
      });
      syncZoomClass();

      setView(currentView);

      if (loadingEl) loadingEl.remove();
      root.classList.add("is-ready");
    })
    .catch(function (err) {
      console.error("[travel-map]", err);
      fail("Map outlines could not be loaded.");
    });
})();
