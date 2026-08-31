// App wiring -- the only file that imports maplibregl directly, and the
// only one that touches `document` to look up its own panel controls.
// spriteLayer.js/iconSpriteLayer.js/glowTexture.js also touch the DOM
// now (a canvas element, for texture generation) and import THREE
// directly -- that's a deliberate, narrower boundary than before: they
// still take all their actual DATA (sprite positions/colors/codes) via
// function parameters rather than reaching for a global, which is what
// keeps zoomScale.js/glyphAtlas.js (the pure logic those files depend
// on) independently testable (see the *.test.js files -- none of them
// open a browser, and none of them import a file that imports THREE).
//
// forest+roads / classification-highlight / water-shimmer are not
// wired up here right now (their files -- forestRoadsLayer.js,
// classificationLayer.js, shimmerCanvas.js, bushTexture.js -- and their
// commented-out sections in index.html are untouched). They predate
// this rearchitecture; re-integrating one means updating it to accept
// an injected logger the same way minimalPresetLayer.js now does.

import {
  createConsoleLogger,
  createPageLogger,
  createRemoteLogger,
  createCompositeLogger,
  installGlobalErrorLogging,
} from "./logger.js";
import { createMapLibreStyleController } from "./mapStyleController.js";
import { createStyleOverrideApplier } from "./styleOverrideApplier.js";
import {
  CATEGORY_TO_SOURCE_LAYERS,
  snapshotOriginalPaint,
  applyCategoryColor,
  populateColorSelect,
  snapshotOriginalFilters,
  applyNativeDetail,
} from "./nativeStyleControls.js";
import { createMinimalPresetLayer } from "./minimalPresetLayer.js";
import { createSpriteLayer } from "./spriteLayer.js";
import { createIconSpriteLayer } from "./iconSpriteLayer.js";
import { scatterPoints } from "./landmarkScatter.js";
import { createBoxedLabelLayer } from "./boxedLabelLayer.js";
import { createBloomGlowEffect } from "./glowEffects.js";
import { createLabelSettings } from "./labelSettings.js";
import { renderLabelSettingsPanel } from "./labelSettingsPanel.js";

// The panel is hidden by default and toggled by #panelToggleButton (see
// index.html) -- it's a desktop dev tool (dropdowns, checkboxes, a
// "dump style state" button) that doesn't belong showing by default on
// a phone screen, but is still needed on demand while working on this
// sandbox itself. Runs before anything else since it's independent of
// the rest of this file's setup.
const panel = document.getElementById("panel");
const panelToggleButton = document.getElementById("panelToggleButton");
panelToggleButton.addEventListener("click", () => {
  const hidden = panel.style.display === "none";
  panel.style.display = hidden ? "" : "none";
  panelToggleButton.textContent = hidden ? "Hide settings" : "Show settings";
});

// The original three are the seeded Sydney landmarks M2 put in the real
// API (apps/api's places seed); the rest (added later, same treatment)
// are more real Sydney landmarks, web-searched for real coordinates
// (see chat for sources), not from memory. This sandbox has no live
// connection to the real API either way, so every coordinate here is a
// hand-copied real-world value, not fetched -- good enough for a
// rendering prototype, not a source of truth for the actual app data.
//
// This is deliberately the ONLY data array feeding icon-only markers --
// spriteLayer.js (plain glowing orbs) and iconSpriteLayer.js (glyph
// icons) both build their sprite lists straight off SPRITE_PLACES
// below, so "add a landmark" is one entry here, not new code in either
// layer. Unlike COMEDY_CLUB_PLACES, nothing here gets a name box --
// these are icon-only, via that same shared pipe.
//
// iconCode is a codepoint into apps/mobile's dungeonmode glyph font
// (16x16 grid, see iconSpriteLayer.js) -- picked by eye off a rendered
// contact sheet of the font, same as the original three: 245 a
// cross/altar, 220 an owl/creature face, 211 an archway, 154 a
// rounded arch/dome mound, 9 a flower-on-a-stem, 139 a castle-like
// twin-tower silhouette, 6 a leaf/shield blob, 128 a solid vertical
// spire bar, 144 twin pillars/columns, 210 a diagonal
// stair/cobblestone zigzag -- each loosely themed to its place, not a
// literal likeness.
const SPRITE_PLACES = [
  {
    id: "st-marys-cathedral",
    lng: 151.2137,
    lat: -33.8722,
    color: [0.96, 0.82, 0.35, 0.9],
    iconCode: 245,
  },
  {
    id: "sydney-opera-house",
    lng: 151.2153,
    lat: -33.8568,
    color: [0.35, 0.85, 0.9, 0.9],
    iconCode: 220,
  },
  {
    id: "queen-victoria-building",
    lng: 151.2069,
    lat: -33.8715,
    color: [0.75, 0.45, 0.95, 0.9],
    iconCode: 211,
  },
  {
    id: "sydney-harbour-bridge",
    lng: 151.21056,
    lat: -33.85222,
    color: [0.55, 0.65, 0.85, 0.9],
    iconCode: 154,
  },
  {
    id: "royal-botanic-garden",
    lng: 151.21694,
    lat: -33.86389,
    color: [0.45, 0.85, 0.45, 0.9],
    iconCode: 9,
  },
  {
    id: "sydney-town-hall",
    lng: 151.206323,
    lat: -33.873235,
    color: [0.85, 0.65, 0.35, 0.9],
    iconCode: 139,
  },
  { id: "hyde-park", lng: 151.211389, lat: -33.873333, color: [0.65, 0.9, 0.4, 0.9], iconCode: 6 },
  {
    id: "sydney-tower-eye",
    lng: 151.2089,
    lat: -33.8704,
    color: [0.95, 0.4, 0.6, 0.9],
    iconCode: 128,
  },
  {
    id: "australian-museum",
    lng: 151.2134,
    lat: -33.8743,
    color: [0.9, 0.5, 0.3, 0.9],
    iconCode: 144,
  },
  { id: "the-rocks", lng: 151.20901, lat: -33.85985, color: [0.8, 0.7, 0.55, 0.9], iconCode: 210 },
];

// A wider, denser field of icon-only markers across real Sydney areas
// (inner west, eastern suburbs, south Sydney/near the airport, plus a
// couple of inner-city suburbs for live-music variety) -- same
// icon-only, no-name-box contract as SPRITE_PLACES above, concatenated
// into that same array below so it flows through the exact same
// spriteLayer/iconSpriteLayer pipe with zero new rendering code.
//
// Two different honesty levels on purpose: NAMED_ANCHOR_VENUES are real,
// individually web-searched venues (major stadiums/concert halls --
// there are only a handful of these in real life, so naming them
// individually is accurate); SYDNEY_SUBURBS below is real suburb
// centroids (general public geography, not individually sourced) used
// only to SCATTER generic "there's probably a bar/park around here"
// markers via landmarkScatter.js's deterministic jitter -- these are
// NOT claimed as real, individually geocoded businesses, unlike every
// other array in this file. That distinction is why "stadium" only
// ever appears in the named-anchor list, never generated -- there
// really are only a few real stadiums, and scattering fake ones would
// misrepresent the city.
const NAMED_ANCHOR_VENUES = [
  { id: "accor-stadium", lng: 151.06306, lat: -33.84722, category: "stadium" },
  { id: "qudos-bank-arena", lng: 151.067, lat: -33.85, category: "concert-hall" },
  { id: "allianz-stadium", lng: 151.22528, lat: -33.88917, category: "stadium" },
  { id: "sydney-cricket-ground", lng: 151.22472, lat: -33.89167, category: "stadium" },
  { id: "hordern-pavilion", lng: 151.2212, lat: -33.8897, category: "concert-hall" },
  { id: "enmore-theatre", lng: 151.17389, lat: -33.89889, category: "concert-hall" },
  { id: "metro-theatre", lng: 151.206776, lat: -33.875759, category: "concert-hall" },
];

// Real suburb centroids (approximate, general geography -- not
// individually sourced the way NAMED_ANCHOR_VENUES above is).
const SYDNEY_SUBURBS = [
  // Inner west
  { id: "newtown", lng: 151.1785, lat: -33.8988 },
  { id: "marrickville", lng: 151.1548, lat: -33.9108 },
  { id: "glebe", lng: 151.1861, lat: -33.8799 },
  { id: "balmain", lng: 151.1784, lat: -33.857 },
  { id: "leichhardt", lng: 151.1567, lat: -33.8834 },
  { id: "ashfield", lng: 151.1244, lat: -33.889 },
  { id: "petersham", lng: 151.1544, lat: -33.8978 },
  { id: "annandale", lng: 151.1697, lat: -33.8815 },
  // Eastern suburbs
  { id: "bondi-beach", lng: 151.2743, lat: -33.8908 },
  { id: "bondi-junction", lng: 151.2477, lat: -33.8918 },
  { id: "coogee", lng: 151.2578, lat: -33.9202 },
  { id: "paddington", lng: 151.2266, lat: -33.8848 },
  { id: "randwick", lng: 151.2437, lat: -33.9146 },
  { id: "double-bay", lng: 151.2428, lat: -33.8778 },
  { id: "maroubra", lng: 151.238, lat: -33.9469 },
  // South Sydney / near the airport
  { id: "mascot", lng: 151.197, lat: -33.9244 },
  { id: "alexandria", lng: 151.1953, lat: -33.9037 },
  { id: "rockdale", lng: 151.14, lat: -33.953 },
  { id: "kogarah", lng: 151.1354, lat: -33.9668 },
  { id: "botany", lng: 151.1965, lat: -33.9469 },
  { id: "brighton-le-sands", lng: 151.1596, lat: -33.9631 },
  // Inner-city (live-music-adjacent density)
  { id: "surry-hills", lng: 151.2118, lat: -33.8845 },
  { id: "redfern", lng: 151.2044, lat: -33.893 },
];

// Live-music-dense suburbs get a scattered "concert-hall" marker or two
// as well as the usual bar/park ones -- every other suburb just gets
// bars and parks, the two categories realistically present almost
// everywhere.
const CONCERT_HALL_SUBURB_IDS = new Set([
  "newtown",
  "marrickville",
  "surry-hills",
  "redfern",
  "paddington",
  "glebe",
]);

// Per-category visual style -- icon codes picked by eye off the same
// rendered dungeon-mode contact sheet as SPRITE_PLACES' comment
// documents: a ring (bar, reads like a glass rim), a musical note
// (concert-hall), a shield/badge (stadium), a clover (park).
const SCATTER_CATEGORY_STYLE = {
  bar: { iconCode: 190, color: [0.9, 0.55, 0.25, 0.85] },
  park: { iconCode: 5, color: [0.4, 0.8, 0.35, 0.85] },
  "concert-hall": { iconCode: 22, color: [0.8, 0.35, 0.85, 0.85] },
  stadium: { iconCode: 158, color: [0.9, 0.25, 0.25, 0.85] },
};
const SCATTER_RADIUS_DEGREES = 0.012; // roughly a ~1.3km scatter radius at Sydney's latitude -- keeps markers inside their own suburb, not spilling into the next one

function scatterCategoryPlaces(suburb, category, count) {
  return scatterPoints(
    `${suburb.id}:${category}`,
    suburb.lng,
    suburb.lat,
    count,
    SCATTER_RADIUS_DEGREES,
  ).map(({ lng, lat }, i) => ({
    id: `${suburb.id}-${category}-${i}`,
    lng,
    lat,
    ...SCATTER_CATEGORY_STYLE[category],
  }));
}

const SYDNEY_SCATTER_PLACES = [
  ...NAMED_ANCHOR_VENUES.map((venue) => ({
    id: venue.id,
    lng: venue.lng,
    lat: venue.lat,
    ...SCATTER_CATEGORY_STYLE[venue.category],
  })),
  ...SYDNEY_SUBURBS.flatMap((suburb) => [
    ...scatterCategoryPlaces(suburb, "bar", 3),
    ...scatterCategoryPlaces(suburb, "park", 1),
    ...(CONCERT_HALL_SUBURB_IDS.has(suburb.id)
      ? scatterCategoryPlaces(suburb, "concert-hall", 1)
      : []),
  ]),
];

// Real Sydney comedy clubs (web-searched, not from memory -- see chat
// for sources). Coordinates are hand-approximated from each venue's
// published street address/suburb, same "real but not precisely
// geocoded" standard as SPRITE_PLACES above -- good enough for a
// rendering prototype, not a source of truth for the real app.
//
// Each place's visual knobs (border/text color, marquee symbol/color/
// spacing/speed/tail/emissive-intensity, this label's own bloom
// strength/radius/threshold) live in ONE settings object
// (labelSettings.js), not scattered fields here -- that object is
// exactly what labelSettingsPanel.js renders into the debug panel and
// what boxedLabelLayer.js reads/mutates live. Starting colors below
// just carry over each place's previous fixed tint as a sensible
// default; every field is independently adjustable per place from the
// panel once the page loads.
const COMEDY_CLUB_PLACES = [
  {
    id: "the-comedy-store",
    name: "The Comedy Store",
    lng: 151.2246,
    lat: -33.893,
    settings: createLabelSettings({ color: "#ff8c33" }),
  },
  {
    id: "sydney-comedy-club",
    name: "Sydney Comedy Club",
    lng: 151.2051,
    lat: -33.8721,
    settings: createLabelSettings({ color: "#66e680" }),
  },
  {
    id: "happy-endings-comedy-club",
    name: "Happy Endings",
    lng: 151.2247,
    lat: -33.8716,
    settings: createLabelSettings({ color: "#f266bf" }),
  },
];

// All five are real OpenMapTiles-schema styles (verified live, no API
// key needed) -- source-layer names (water/building/park/landcover/
// transportation) are standardized by that schema, so the same
// category-based logic works across all of them.
const BASE_STYLES = {
  "dark-matter": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  "of-liberty": "https://tiles.openfreemap.org/styles/liberty",
  "of-bright": "https://tiles.openfreemap.org/styles/bright",
  "of-positron": "https://tiles.openfreemap.org/styles/positron",
  // Saved from Maputnik (originally at repo root as "positron_test_2",
  // with per-layer visibility toggled while exploring it there). Its
  // embedded source/glyphs URLs pointed at MapTiler with Maputnik's own
  // placeholder demo key ("get_your_own_..."), which returns a real
  // 403 when queried directly -- swapped for the same free OpenFreeMap
  // endpoints "of-positron" above already uses successfully.
  "positron-test-2": "./positron_test_2.json",
};
const INITIAL_CENTER = [151.2136, -33.8722];
const INITIAL_ZOOM = 14;

// Saved zoom-preset looks, per the "Zoom preset" select -- add more here
// as new ones get found by eye and confirmed worth keeping. Note the
// real, honest limit on what this can do: it freezes which LAYERS are
// visible (per each layer's own minzoom/maxzoom), not the underlying
// tile data. A layer can be forced "on" at any real zoom, but if the
// loaded tile at that zoom genuinely contains no geometry for it (real
// vector tiles are server-generalized per zoom), there is nothing to
// draw regardless. This preset is a good fit for "keep major roads on
// a couple of zoom levels past where they'd normally vanish"; it is
// NOT "render exactly what zoom 12.82 looks like at zoom 5".
const ZOOM_PRESETS = {
  "zoom-12.82": 12.82,
};

// Version-stamps this page load -- printed to the log and shown in the
// stats panel. Code review flagged that neither side of a debugging
// conversation could tell whether the JS actually running matched the
// file on disk (a real, confirmed cause of wasted round trips earlier
// in this project, before the static server was switched to send
// Cache-Control: no-store). This doesn't prevent staleness, but it
// makes it immediately checkable instead of assumed.
const BUILD_MARKER = new Date().toISOString();

const logger = createCompositeLogger([
  createConsoleLogger(),
  createPageLogger("pageError"),
  createRemoteLogger("/log"),
]);
installGlobalErrorLogging(logger);
logger.log("info", "main", `sandbox loaded, build ${BUILD_MARKER}`);

async function loadBaseStyle(styleKey) {
  const url = BASE_STYLES[styleKey];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`loadBaseStyle("${styleKey}"): HTTP ${response.status} fetching ${url}`);
  }
  return response.json();
}

for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
  populateColorSelect(`${category}Color`, category);
}

(async () => {
  let initialStyle;
  try {
    initialStyle = await loadBaseStyle(document.getElementById("baseStyleSelect").value);
  } catch (error) {
    logger.log("error", "main", error.message);
    return;
  }

  const map = new maplibregl.Map({
    container: "map",
    style: initialStyle,
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
  });

  // MapLibre's own internal failures (bad layer ids, style validation
  // errors, tile/glyph/sprite fetch failures) fire as `error` events on
  // the Map object -- NOT thrown exceptions, and not window.onerror.
  // Code review found this was the single biggest diagnostic gap in
  // the whole codebase: a large share of real failures were completely
  // invisible because nothing was listening for this.
  map.on("error", (e) => {
    logger.log("error", "maplibre", e.error?.message ?? String(e.error ?? "unknown map error"), {
      sourceId: e.sourceId,
    });
  });

  const styleController = createMapLibreStyleController(map);
  const overrideApplier = createStyleOverrideApplier(styleController, logger);

  // Without a beforeId, addLayer appends to the very TOP of the layer
  // stack -- above labels -- so our opaque fills would completely cover
  // every place name/road label. Insert just before the first symbol
  // (label/icon) layer instead.
  function firstSymbolLayerId(map) {
    // map.getStyle() can transiently lack a usable .layers array if
    // this is ever reached before the style is confirmed ready (the
    // same class of bug fixed in mapFeatureSource.js's
    // findVectorSourceId earlier) -- guarded the same way here rather
    // than trusting every call site to only ever fire post-load.
    return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  }

  // spriteLayer/iconSpriteLayer (Three.js, screen-space) re-derive each
  // sprite's screen position every frame via map.project(lng, lat) --
  // unlike the old raw-WebGL version, no mercator precompute is needed
  // here at all now.
  //
  // The hand-picked landmarks and the generated suburb scatter are two
  // separately-documented arrays above (different honesty levels -- see
  // SYDNEY_SCATTER_PLACES' comment) but flow through ONE combined list
  // here, so both layers render every icon-only marker through the same
  // single pipe regardless of which array it came from.
  const ALL_ICON_PLACES = [...SPRITE_PLACES, ...SYDNEY_SCATTER_PLACES];

  const spriteLayer = createSpriteLayer(
    ALL_ICON_PLACES.map((place, index) => ({
      id: place.id,
      lng: place.lng,
      lat: place.lat,
      color: place.color,
      phase: index * 2.1,
    })),
    logger,
  );
  let spriteLayerAdded = false;
  function updateSpriteLayerActive() {
    const wantsSprites = document.getElementById("spriteToggle").checked;
    if (wantsSprites && !spriteLayerAdded) {
      map.addLayer(spriteLayer);
      spriteLayerAdded = true;
    } else if (!wantsSprites && spriteLayerAdded) {
      map.removeLayer(spriteLayer.id);
      spriteLayerAdded = false;
    }
  }

  const iconSpriteLayer = createIconSpriteLayer(
    ALL_ICON_PLACES.map((place, index) => ({
      id: place.id,
      lng: place.lng,
      lat: place.lat,
      color: place.color,
      code: place.iconCode,
      phase: index * 2.1 + 1, // offset from the orb sprites' phase so the two don't bob in lockstep if both are ever on together
    })),
    "./assets/dungeon-mode-mask.png",
    logger,
  );
  let iconSpriteLayerAdded = false;
  function updateIconSpriteLayerActive() {
    const wantsIcons = document.getElementById("iconSpriteToggle").checked;
    if (wantsIcons && !iconSpriteLayerAdded) {
      map.addLayer(iconSpriteLayer);
      iconSpriteLayerAdded = true;
    } else if (!wantsIcons && iconSpriteLayerAdded) {
      map.removeLayer(iconSpriteLayer.id);
      iconSpriteLayerAdded = false;
    }
  }

  const boxedLabelLayer = createBoxedLabelLayer(
    COMEDY_CLUB_PLACES.map((place, index) => ({
      id: place.id,
      lng: place.lng,
      lat: place.lat,
      name: place.name,
      phase: index * 2.6 + 1,
      settings: place.settings,
    })),
    "./assets/dungeon-mode-mask.png",
    "./assets/dungeon-437-mask.png",
    // Real bloom post-processing (glowEffects.js) instead of a
    // background halo sprite -- thresholds/blurs each label's own
    // actual rendered pixels, so the glow follows its real shape
    // uniformly. Passed as the FACTORY ITSELF (not called here) --
    // boxedLabelLayer.js calls this once per label with that label's
    // OWN settings.bloomStrength/Radius/Threshold, so each of the 3
    // places gets an independent bloom instance tunable from its own
    // panel section, not one shared setting for all three.
    // spriteLayer/iconSpriteLayer still use the older halo-sprite
    // approach; nothing about their (already-approved) look needed to
    // change for this.
    createBloomGlowEffect,
    logger,
  );
  let boxedLabelLayerAdded = false;
  function updateBoxedLabelLayerActive() {
    const wantsBoxes = document.getElementById("boxedLabelToggle").checked;
    if (wantsBoxes && !boxedLabelLayerAdded) {
      map.addLayer(boxedLabelLayer);
      boxedLabelLayerAdded = true;
    } else if (!wantsBoxes && boxedLabelLayerAdded) {
      map.removeLayer(boxedLabelLayer.id);
      boxedLabelLayerAdded = false;
    }
  }

  const minimalPresetLayer = createMinimalPresetLayer(logger);
  let minimalPresetLayerAdded = false;
  function updateMinimalPresetActive() {
    const wantsMinimalPreset = document.getElementById("minimalPresetToggle").checked;
    if (wantsMinimalPreset && !minimalPresetLayerAdded) {
      map.addLayer(minimalPresetLayer, firstSymbolLayerId(map));
      minimalPresetLayerAdded = true;
    } else if (!wantsMinimalPreset && minimalPresetLayerAdded) {
      map.removeLayer(minimalPresetLayer.id);
      minimalPresetLayerAdded = false;
    }
    // Hides every native layer via opacity, not visibility -- keeps the
    // openmaptiles source marked "used" so MapLibre keeps loading tiles
    // for it, which is what this layer's own querySourceFeatures calls
    // depend on. Hiding via visibility (the old setAllNativeLayersHidden)
    // starved the source of tile loads entirely and was the actual,
    // confirmed root cause of this preset's "screen goes black" bug.
    overrideApplier.setHideAll(wantsMinimalPreset);
  }

  const zoomPresetSelect = document.getElementById("zoomPresetSelect");
  function applyZoomPreset() {
    const value = zoomPresetSelect.value;
    overrideApplier.setZoomPreset(value === "auto" ? null : ZOOM_PRESETS[value]);
  }

  // Everything that must happen fresh every time a style is confirmed
  // loaded, in one place -- called from both the initial "load" and
  // every subsequent "style.load". Baseline capture MUST happen before
  // any feature is (re)applied, since every feature is a pure function
  // FROM that baseline.
  function initializeForNewStyle() {
    snapshotOriginalPaint(map);
    snapshotOriginalFilters(map);
    overrideApplier.captureBaselineNow();
    applyNativeDetail(map, Number(document.getElementById("detail").value));
    applyZoomPreset();
    updateMinimalPresetActive();
    updateSpriteLayerActive();
    updateIconSpriteLayerActive();
    updateBoxedLabelLayerActive();
  }

  map.on("load", initializeForNewStyle);

  function resetColorSelectsToDefault() {
    for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
      document.getElementById(`${category}Color`).value = "";
    }
  }

  document.getElementById("baseStyleSelect").addEventListener("change", async (e) => {
    let newStyle;
    try {
      newStyle = await loadBaseStyle(e.target.value);
    } catch (error) {
      logger.log("error", "main", error.message);
      return;
    }
    minimalPresetLayerAdded = false; // setStyle drops all layers, including ours
    spriteLayerAdded = false;
    iconSpriteLayerAdded = false;
    boxedLabelLayerAdded = false;
    // { diff: false } forces MapLibre's full-reload path every time
    // (Style._load(), which is the ONLY place "style.load" fires).
    // MapLibre's default diff path can apply some style changes without
    // ever firing "style.load" at all -- confirmed in code review
    // against Map#setStyle's source -- which was a real, separate bug:
    // the zoom-preset reset logic used to hang entirely off that one
    // event and could silently just not run. A local sandbox has no
    // need for diffing's performance benefit; here, reliability is
    // worth more than it.
    map.setStyle(newStyle, { diff: false });
    map.once("style.load", () => {
      resetColorSelectsToDefault();
      initializeForNewStyle();
    });
  });

  for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
    document.getElementById(`${category}Color`).addEventListener("change", (e) => {
      applyCategoryColor(map, category, e.target.value || null);
    });
  }

  document
    .getElementById("minimalPresetToggle")
    .addEventListener("change", updateMinimalPresetActive);
  document.getElementById("spriteToggle").addEventListener("change", updateSpriteLayerActive);
  document
    .getElementById("iconSpriteToggle")
    .addEventListener("change", updateIconSpriteLayerActive);
  document
    .getElementById("boxedLabelToggle")
    .addEventListener("change", updateBoxedLabelLayerActive);

  // One settings panel PER PLACE, generated entirely from
  // LABEL_SETTINGS_SCHEMA (labelSettings.js) -- this loop is the whole
  // wiring for however many places exist; adding a 4th place or a new
  // schema field needs no changes here (Open/Closed). Each place's
  // settings object is the SAME one boxedLabelLayer.js already holds a
  // reference to, so mutating it here and telling the layer which key
  // changed is the entire live-update contract.
  for (const place of COMEDY_CLUB_PLACES) {
    const container = document.getElementById(`labelSettingsPanel-${place.id}`);
    if (!container) continue;
    renderLabelSettingsPanel(container, place.settings, (key) => {
      boxedLabelLayer.updateLabelSettings(place.id, key);
    });
  }

  // setFilter (inside applyNativeDetail) always schedules a MapLibre
  // repaint on its own -- no explicit triggerRepaint needed here.
  document.getElementById("detail").addEventListener("input", (e) => {
    applyNativeDetail(map, Number(e.target.value));
  });

  zoomPresetSelect.addEventListener("change", applyZoomPreset);

  // ---- Diagnostics: "Dump style state" ---------------------------------
  // Per code review recommendation P0.4: one look at this table would
  // have ended the zoom-preset investigation in a single round trip
  // instead of two wrong guesses -- it shows declared vs. live
  // visibility side by side, MapLibre's actual isHidden() result, and
  // the diagnostic source-used approximation, for every layer.
  document.getElementById("dumpStyleStateButton").addEventListener("click", () => {
    const table = overrideApplier.getDebugTable();
    const header =
      "id".padEnd(30) +
      "type".padEnd(11) +
      "source".padEnd(13) +
      "declared".padEnd(10) +
      "live".padEnd(10) +
      "minz".padEnd(6) +
      "maxz".padEnd(6) +
      "hidden".padEnd(8) +
      "srcUsed";
    const rows = table.map(
      (r) =>
        String(r.id).padEnd(30) +
        String(r.type).padEnd(11) +
        String(r.source || "-").padEnd(13) +
        String(r.declaredVisibility).padEnd(10) +
        String(r.liveVisibility).padEnd(10) +
        String(r.minzoom).padEnd(6) +
        String(r.maxzoom).padEnd(6) +
        String(r.isHidden).padEnd(8) +
        String(r.sourceUsed),
    );
    document.getElementById("styleStateOutput").textContent =
      `zoom: ${table[0]?.zoom ?? "?"}\n${header}\n${rows.join("\n")}`;
    logger.log("info", "styleState", `dumped ${table.length} layers`, { zoom: table[0]?.zoom });
  });

  let frames = 0;
  let lastTime = performance.now();
  function tick() {
    frames += 1;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      const detailPercent = document.getElementById("detail").value;
      const zoomLevel = map.getZoom().toFixed(2);
      const minimalPresetLines = minimalPresetLayerAdded
        ? (() => {
            const info = minimalPresetLayer.getDebugInfo();
            return `\nminimal preset: on\n  water: ${info.waterFeatures} features, ${info.waterVertices} vertices\n  building: ${info.buildingFeatures} features, ${info.buildingVertices} vertices\n  major roads: ${info.roadFeatures} features, ${info.roadVertices} vertices${info.lastError ? `\n  ERROR: ${info.lastError}` : ""}`;
          })()
        : "";
      document.getElementById("stats").textContent =
        `build: ${BUILD_MARKER.slice(11, 19)}\nfps: ${frames}\nzoom: ${zoomLevel}\ndetail: ${detailPercent}%${minimalPresetLines}`;
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
