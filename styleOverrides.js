// Pure decision logic for what MapLibre style state SHOULD be, given a
// baseline (the style as originally loaded) and which features are
// currently active. Nothing in this file touches maplibregl, the DOM,
// or any IMapStyleController -- every function here is a plain
// data-in/data-out transform, which is what makes it testable with
// node:test and zero browser involvement (see styleOverrides.test.js).
//
// This replaces the old design (scattered module-scoped caches --
// originalPaint/originalFilters/originalVisibility/
// zoomSnapshotOriginalVisibility -- each owned by a different feature,
// each with its own reset rules, mutating the same underlying layer
// properties with no ordering discipline). That design was the root
// cause of every visibility bug found in code review: whichever
// feature last "restored" a layer decided what "original" meant, often
// using a stale or wrong idea of it. Here there is exactly one baseline,
// captured once, and every feature is a pure function FROM that
// baseline TO a set of desired overrides -- features can no longer
// clobber each other's restores because none of them mutate anything.

// ---- Opacity properties, by layer type ---------------------------------
// Used by the "hide everything" feature: zeroing a layer's opacity
// makes it invisible WITHOUT touching layout.visibility or the zoom
// range, which matters because MapLibre's own isHidden() (checked
// before a source is marked "used" for tile loading -- confirmed in
// code review against MapLibre's source) only looks at visibility and
// zoom range, never paint opacity. Hiding via visibility on every
// layer referencing a source starves that source of tile loads
// entirely; hiding via opacity does not. This was the actual root
// cause of the "screen goes black" bug in the minimal preset.
const OPACITY_PROPERTIES_BY_TYPE = {
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  background: ["background-opacity"],
  circle: ["circle-opacity"],
  "fill-extrusion": ["fill-extrusion-opacity"],
  raster: ["raster-opacity"],
  heatmap: ["heatmap-opacity"],
};

export function layerOpacityProperties(layerType) {
  return OPACITY_PROPERTIES_BY_TYPE[layerType] ?? [];
}

// ---- Baseline -----------------------------------------------------------
// A Map<layerId, LayerSnapshot> (see mapStyleController.js's typedef),
// captured once per confirmed style load. This IS the "original state"
// -- there is no other copy of it anywhere else in the app.
export function captureBaseline(layerSnapshots) {
  const baseline = new Map();
  for (const layer of layerSnapshots) baseline.set(layer.id, layer);
  return baseline;
}

// ---- Feature: zoom preset -----------------------------------------------
// Freezes which layers are visible to whatever a specific reference
// zoom would naturally show, regardless of the map's real current zoom.
//
// The old implementation only ever set `visibility`, which cannot work:
// MapLibre's isHidden() checks minzoom/maxzoom BEFORE visibility, so a
// layer whose own zoom window excludes the real current zoom stays
// hidden no matter what visibility says (confirmed against MapLibre
// source in code review). Freezing a layer "on" therefore requires
// widening its zoom range too -- there is no way to do this through
// visibility alone. `setLayerZoomRange` is not optional here, it's the
// only API that touches the actual mechanism doing the hiding.
//
// referenceZoom === null means "no override" (Auto) -- every layer
// falls through to baseline via mergeOverrides/resolveDesiredState
// rather than this function trying to restore anything itself. There
// is nothing to restore TO here except the baseline, and the baseline
// is already the fallback for every layer with no override.
export function computeZoomPresetOverrides(baseline, referenceZoom) {
  const overrides = new Map();
  if (referenceZoom === null) return overrides;

  for (const layer of baseline.values()) {
    const minzoom = layer.minzoom ?? -Infinity;
    const maxzoom = layer.maxzoom ?? Infinity;
    const inRange = referenceZoom >= minzoom && referenceZoom < maxzoom;
    const originallyVisible = layer.visibility !== "none";

    if (inRange && originallyVisible) {
      // Widen to "always in range" so the real current zoom can never
      // re-hide it via the zoom-range check.
      overrides.set(layer.id, { visibility: "visible", minzoom: 0, maxzoom: 24 });
    } else {
      // Explicitly restore the layer's own original zoom range (not
      // just set visibility: none) so a layer previously widened by an
      // earlier preset selection can't leave stale state behind if
      // some other feature later flips its visibility back on.
      overrides.set(layer.id, {
        visibility: "none",
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
      });
    }
  }
  return overrides;
}

// ---- Feature: hide everything (minimal-preset style) --------------------
// Used when a custom WebGL layer wants to be the entire visible map --
// hides every native layer via opacity (see the module comment above
// for why opacity, not visibility). `enabled: false` contributes no
// overrides, same reasoning as computeZoomPresetOverrides(baseline, null).
export function computeHideAllOverrides(baseline, enabled) {
  const overrides = new Map();
  if (!enabled) return overrides;

  for (const layer of baseline.values()) {
    const opacity = {};
    for (const prop of layerOpacityProperties(layer.type)) opacity[prop] = 0;
    if (Object.keys(opacity).length > 0) overrides.set(layer.id, { opacity });
  }
  return overrides;
}

// ---- Merge + resolve ------------------------------------------------------
// featureOverrideMaps: array of Map<layerId, partialOverride>, in
// priority order (a later map's keys win over an earlier map's keys for
// the SAME property on the SAME layer -- but two features touching
// DIFFERENT properties of the same layer both apply, they don't
// replace each other's contribution). This is what lets "hide
// everything" (opacity) and "zoom preset" (visibility/zoom range) run
// on the same layer simultaneously without one clobbering the other,
// which the old per-feature-owns-its-own-cache design could not do.
export function mergeOverrides(featureOverrideMaps) {
  const merged = new Map();
  for (const overrideMap of featureOverrideMaps) {
    for (const [layerId, partial] of overrideMap) {
      const existing = merged.get(layerId) ?? {};
      merged.set(layerId, {
        ...existing,
        ...partial,
        opacity: { ...existing.opacity, ...partial.opacity },
      });
    }
  }
  return merged;
}

// Produces the full desired state for every layer in the baseline:
// baseline values with any merged overrides applied on top. This is
// the single "target state" the applier reconciles the real map to --
// there is no other source of truth for what a layer's properties
// should currently be.
export function resolveDesiredState(baseline, mergedOverrides) {
  const desired = new Map();
  for (const layer of baseline.values()) {
    const override = mergedOverrides.get(layer.id) ?? {};
    desired.set(layer.id, {
      id: layer.id,
      visibility: override.visibility ?? layer.visibility,
      minzoom: override.minzoom ?? layer.minzoom,
      maxzoom: override.maxzoom ?? layer.maxzoom,
      opacity: { ...layer.opacity, ...override.opacity },
    });
  }
  return desired;
}

// ---- Diff -----------------------------------------------------------------
// Compares desired state against what the map's current layers actually
// report, returning only the individual (layerId, property, value)
// changes that need to happen. Applying only real diffs (rather than
// unconditionally re-setting every property on every layer every time)
// is what makes it cheap to call the applier's reapply() on every
// slider tick without measurable cost, and it's what lets the applier
// log exactly what changed instead of a wall of "set to the same value
// it already was" noise.
export function diffDesiredState(currentLayers, desiredState) {
  const changes = []; // { id, property, from, to }
  const currentById = new Map(currentLayers.map((l) => [l.id, l]));

  for (const desired of desiredState.values()) {
    const current = currentById.get(desired.id);
    if (!current) continue; // layer no longer exists (style swap) -- nothing to diff

    if (current.visibility !== desired.visibility) {
      changes.push({
        id: desired.id,
        property: "visibility",
        from: current.visibility,
        to: desired.visibility,
      });
    }
    if (current.minzoom !== desired.minzoom || current.maxzoom !== desired.maxzoom) {
      changes.push({
        id: desired.id,
        property: "zoomRange",
        from: [current.minzoom, current.maxzoom],
        to: [desired.minzoom, desired.maxzoom],
      });
    }
    for (const [prop, value] of Object.entries(desired.opacity)) {
      if (current.opacity[prop] !== value) {
        changes.push({
          id: desired.id,
          property: `opacity:${prop}`,
          from: current.opacity[prop],
          to: value,
        });
      }
    }
  }
  return changes;
}
