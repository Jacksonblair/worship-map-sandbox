// IMapStyleController: a thin wrapper over the handful of MapLibre
// style-mutation primitives this app needs. The whole point of this
// interface is dependency inversion for testability -- every bug found
// in the code review that preceded this file was a wrong assumption
// about what a MapLibre API call actually does, and none of those bugs
// were catchable without a browser under the OLD direct-map-calls
// design. With this interface, the actual decision logic (styleOverrides.js)
// depends on IMapStyleController, not on maplibregl.Map directly, so it
// can be exercised against createFakeMapStyleController() in plain
// Node -- no browser, no WebGL, no MapLibre library at all.
//
// createMapLibreStyleController(map) is the real implementation, used
// only by main.js (the composition root). Nothing else in this codebase
// should import maplibregl directly.

import { layerOpacityProperties } from "./styleOverrides.js";

/**
 * @typedef {Object} LayerSnapshot
 * @property {string} id
 * @property {string} type
 * @property {string|undefined} source
 * @property {string|undefined} sourceLayer
 * @property {"visible"|"none"|undefined} visibility
 * @property {number|undefined} minzoom
 * @property {number|undefined} maxzoom
 * @property {Object|null} filter
 * @property {Object<string, number>} opacity -- current value of each
 *   opacity-ish paint property this layer's type has (see
 *   layerOpacityProperties), keyed by property name.
 */

// ---- Real implementation, wraps a live maplibregl.Map -----------------
export function createMapLibreStyleController(map) {
  function snapshotLayer(layer) {
    const opacity = {};
    for (const prop of layerOpacityProperties(layer.type)) {
      opacity[prop] = map.getPaintProperty(layer.id, prop);
    }
    return {
      id: layer.id,
      type: layer.type,
      source: layer.source,
      sourceLayer: layer["source-layer"],
      visibility: layer.layout?.visibility,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      filter: layer.filter ?? null,
      opacity,
    };
  }

  return {
    listLayers() {
      // type: "custom" layers are excluded from map.getStyle().layers
      // by MapLibre itself (confirmed in review against Style.serialize's
      // _serializeByIds) -- there is nothing to filter out here, they
      // simply never appear.
      return map.getStyle().layers.map(snapshotLayer);
    },

    getLayer(id) {
      const layer = map.getStyle().layers.find((l) => l.id === id);
      return layer ? snapshotLayer(layer) : null;
    },

    setLayoutProperty(id, name, value) {
      map.setLayoutProperty(id, name, value);
    },

    getLayoutProperty(id, name) {
      return map.getLayoutProperty(id, name);
    },

    setPaintProperty(id, name, value) {
      map.setPaintProperty(id, name, value);
    },

    getPaintProperty(id, name) {
      return map.getPaintProperty(id, name);
    },

    setLayerZoomRange(id, minzoom, maxzoom) {
      map.setLayerZoomRange(id, minzoom, maxzoom);
    },

    getZoom() {
      return map.getZoom();
    },

    // Mirrors MapLibre's own StyleLayer#isHidden exactly (confirmed
    // against source in review): zoom range is checked BEFORE
    // visibility, and visibility is the only thing that can hide a
    // layer that's within its own zoom range. Paint opacity plays no
    // part in this -- that distinction is exactly what
    // computeHideAllOverrides in styleOverrides.js relies on to hide
    // rendering without starving a source of tile loads.
    isLayerHidden(id) {
      const layer = this.getLayer(id);
      if (!layer) return true;
      const zoom = this.getZoom();
      if (layer.minzoom !== undefined && zoom < layer.minzoom) return true;
      if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) return true;
      return layer.visibility === "none";
    },

    // Diagnostic approximation of MapLibre's internal SourceCache#used
    // flag (not directly exposed by the public API) -- true if any
    // layer referencing this source is not hidden. Good enough for the
    // "dump style state" panel and for reasoning about why tiles for a
    // source might stop loading; not a byte-for-byte reimplementation
    // of MapLibre's internals.
    isSourceUsed(sourceId) {
      return this.listLayers().some((l) => l.source === sourceId && !this.isLayerHidden(l.id));
    },
  };
}

// ---- Fake implementation for tests -------------------------------------
// Implements the exact same interface, backed by a plain in-memory
// array instead of a real map. Deliberately reproduces MapLibre's real
// isHidden()/source-usage semantics (per the real controller's own
// comment above) so tests against this fake actually exercise the bug
// classes found in review, not a simplified stand-in that would pass
// regardless of whether the logic under test is correct.
export function createFakeMapStyleController(initialLayers, initialZoom = 0) {
  const layers = initialLayers.map((l) => ({
    ...l,
    opacity: { ...l.opacity },
  }));
  let zoom = initialZoom;

  function find(id) {
    return layers.find((l) => l.id === id);
  }

  return {
    listLayers() {
      return layers.map((l) => ({ ...l, opacity: { ...l.opacity } }));
    },
    getLayer(id) {
      const layer = find(id);
      return layer ? { ...layer, opacity: { ...layer.opacity } } : null;
    },
    setLayoutProperty(id, name, value) {
      const layer = find(id);
      if (!layer) throw new Error(`Cannot style non-existing layer "${id}".`);
      if (name === "visibility") layer.visibility = value;
    },
    getLayoutProperty(id, name) {
      const layer = find(id);
      if (name === "visibility") return layer?.visibility;
      return undefined;
    },
    setPaintProperty(id, name, value) {
      const layer = find(id);
      if (!layer) throw new Error(`Cannot style non-existing layer "${id}".`);
      layer.opacity[name] = value;
    },
    getPaintProperty(id, name) {
      return find(id)?.opacity[name];
    },
    setLayerZoomRange(id, minzoom, maxzoom) {
      const layer = find(id);
      if (!layer) throw new Error(`Cannot style non-existing layer "${id}".`);
      layer.minzoom = minzoom;
      layer.maxzoom = maxzoom;
    },
    getZoom() {
      return zoom;
    },
    setZoom(z) {
      zoom = z;
    },
    isLayerHidden(id) {
      const layer = find(id);
      if (!layer) return true;
      if (layer.minzoom !== undefined && zoom < layer.minzoom) return true;
      if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) return true;
      return layer.visibility === "none";
    },
    isSourceUsed(sourceId) {
      return layers.some((l) => l.source === sourceId && !this.isLayerHidden(l.id));
    },
  };
}
