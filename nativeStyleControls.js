// Customization of MapLibre's OWN native rendering: paint-property
// colors, and a synthetic 0-100% "Detail" reduction via setFilter.
// Entirely separate from the custom WebGL layers in the other files
// (which replace native rendering rather than adjust it) and from
// visibility/zoom-range overrides (styleOverrides.js +
// styleOverrideApplier.js) -- setFilter and setPaintProperty are
// orthogonal mechanisms to setLayoutProperty/setLayerZoomRange, and
// were never part of the bug class code review found in the
// visibility/zoom-range code, so they stay here unchanged in spirit.

// Category -> OpenMapTiles source-layer(s).
export const CATEGORY_TO_SOURCE_LAYERS = {
  water: ["water"],
  building: ["building"],
  land: ["park", "landcover"],
  road: ["transportation"],
};

// A small curated "cartoony" palette per category.
export const COLOR_OPTIONS = {
  water: [
    { label: "Default", value: null },
    { label: "Bright sky blue", value: "#5ec8f0" },
    { label: "Teal lagoon", value: "#2bb3a3" },
    { label: "Deep navy", value: "#1c3f6e" },
    { label: "Lavender", value: "#8f8fe0" },
  ],
  building: [
    { label: "Default", value: null },
    { label: "Warm sand", value: "#f0c987" },
    { label: "Peachy coral", value: "#f2a879" },
    { label: "Soft lilac", value: "#c9a6e0" },
    { label: "Mint", value: "#a3e0c4" },
  ],
  land: [
    { label: "Default", value: null },
    { label: "Grassy green", value: "#8fd17a" },
    { label: "Sage", value: "#a9c99a" },
    { label: "Cream", value: "#f5eccb" },
  ],
  road: [
    { label: "Default", value: null },
    { label: "Sunny yellow", value: "#ffd35c" },
    { label: "Chalky white", value: "#f5f5f0" },
    { label: "Terracotta", value: "#e08a5c" },
  ],
};

export function paintPropertyForType(layerType) {
  if (layerType === "fill") return "fill-color";
  if (layerType === "line") return "line-color";
  if (layerType === "fill-extrusion") return "fill-extrusion-color";
  return null;
}

export function layersForCategory(map, category) {
  const sourceLayers = CATEGORY_TO_SOURCE_LAYERS[category];
  return map.getStyle().layers.filter((l) => sourceLayers.includes(l["source-layer"]));
}

// ---- Colors -----------------------------------------------------------
let originalPaint = {};

export function snapshotOriginalPaint(map) {
  originalPaint = {};
  for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
    for (const layer of layersForCategory(map, category)) {
      const prop = paintPropertyForType(layer.type);
      if (prop) originalPaint[layer.id] = map.getPaintProperty(layer.id, prop);
    }
  }
}

export function applyCategoryColor(map, category, color) {
  for (const layer of layersForCategory(map, category)) {
    const prop = paintPropertyForType(layer.type);
    if (!prop) continue;
    map.setPaintProperty(layer.id, prop, color === null ? originalPaint[layer.id] : color);
  }
}

export function populateColorSelect(selectId, category) {
  const select = document.getElementById(selectId);
  select.innerHTML = "";
  for (const option of COLOR_OPTIONS[category]) {
    const el = document.createElement("option");
    el.value = option.value ?? "";
    el.textContent = option.label;
    select.appendChild(el);
  }
}

// ---- Detail (setFilter-based) ------------------------------------------
let originalFilters = {};

export function snapshotOriginalFilters(map) {
  originalFilters = {};
  for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
    for (const layer of layersForCategory(map, category)) {
      originalFilters[layer.id] = layer.filter ?? null;
    }
  }
}

function combineFilters(original, extra) {
  return original ? ["all", original, extra] : extra;
}

// Least-important-first. Real cartographic generalization drops minor
// roads before major ones; applyNativeDetail walks this list from the
// end as detail drops, so motorway/trunk/primary survive down to very
// low settings.
const ROAD_CLASS_RANKS = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "path",
  "track",
];

export function applyNativeDetail(map, detailPercent) {
  for (const category of Object.keys(CATEGORY_TO_SOURCE_LAYERS)) {
    if (category === "water") continue; // never reduced, at any level
    for (const layer of layersForCategory(map, category)) {
      const original = originalFilters[layer.id] ?? null;
      if (detailPercent >= 100) {
        map.setFilter(layer.id, original);
        continue;
      }
      let extra = null;
      if (category === "road") {
        const hideCount = Math.round(((100 - detailPercent) / 100) * (ROAD_CLASS_RANKS.length - 1));
        const hiddenClasses = ROAD_CLASS_RANKS.slice(ROAD_CLASS_RANKS.length - hideCount);
        if (hiddenClasses.length > 0) {
          extra = ["!", ["in", ["get", "class"], ["literal", hiddenClasses]]];
        }
      } else {
        // No usable "size" property on building/land features in this
        // schema, so this is a stable pseudo-random subsample by
        // feature id instead -- keeps roughly detailPercent% of
        // features, evenly distributed rather than geographically
        // clustered. Per the MapLibre style spec, `to-number(null)` is
        // 0, so a feature with NO id would otherwise always pass this
        // check (0 % 100 = 0 < any positive detailPercent) and never
        // drop out -- the opposite of what a previous version of this
        // comment claimed. Excluded explicitly instead, so a feature
        // with no id behaves the same regardless of detailPercent
        // rather than silently always surviving.
        extra = [
          "all",
          ["!=", ["id"], null], // ["has", "id"] would check properties.id, a different thing entirely -- ["id"] is the feature's own special id
          ["<", ["%", ["abs", ["to-number", ["id"]]], 100], ["literal", detailPercent]],
        ];
      }
      map.setFilter(layer.id, extra ? combineFilters(original, extra) : original);
    }
  }
}
