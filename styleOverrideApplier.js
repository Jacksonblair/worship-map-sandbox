// Orchestrates styleOverrides.js's pure functions against a real (or
// fake) IMapStyleController: holds the current baseline + which
// features are active, recomputes the desired state, diffs it against
// what the controller currently reports, and applies only the actual
// changes -- logging every change and verifying it via read-back
// (checked-setter pattern, since MapLibre's failure mode for a bad
// property set is a silent 'error' event on the map, never a thrown
// exception -- see main.js's map.on("error", ...) wiring, which is the
// OTHER half of catching that; this half catches "the call succeeded
// but produced a different value than asked for", which a plain error
// listener would miss entirely).
//
// This is the ONE place in the app that calls IMapStyleController
// setters for visibility/zoom-range/opacity. Every feature (zoom
// preset, hide-all, and any future one) contributes a pure override
// computation; nothing else touches the controller directly, so there
// is exactly one call site to get the ordering/diffing/logging right,
// instead of N features each with their own ad-hoc mutate-and-hope
// logic (which is what the old nativeStyleControls.js had, and why it
// kept breaking in new ways).

import {
  captureBaseline,
  computeZoomPresetOverrides,
  computeHideAllOverrides,
  mergeOverrides,
  resolveDesiredState,
  diffDesiredState,
} from "./styleOverrides.js";
import { createNoopLogger } from "./logger.js";

export function createStyleOverrideApplier(controller, logger = createNoopLogger()) {
  let baseline = new Map();
  let zoomPresetReferenceZoom = null; // null = "Auto"
  let hideAllEnabled = false;

  function applyChange(change) {
    if (change.property === "visibility") {
      controller.setLayoutProperty(change.id, "visibility", change.to);
    } else if (change.property === "zoomRange") {
      // Pass the computed values through verbatim -- do NOT default a
      // genuinely-desired `undefined` to 0/24. That coercion was
      // exactly the kind of unverified guess about a MapLibre API's
      // behavior that caused the bugs this file replaces; a test
      // (styleOverrideApplier.test.js's "converges to the same
      // baseline" case) caught it turning "no zoom restriction" into
      // "0-24" on every restore, which drifted the style further from
      // baseline on each round trip instead of reproducing it exactly.
      controller.setLayerZoomRange(change.id, change.to[0], change.to[1]);
    } else if (change.property.startsWith("opacity:")) {
      controller.setPaintProperty(change.id, change.property.slice("opacity:".length), change.to);
    }
  }

  function verifyChange(change) {
    let actual;
    if (change.property === "visibility") {
      actual = controller.getLayoutProperty(change.id, "visibility");
    } else if (change.property.startsWith("opacity:")) {
      actual = controller.getPaintProperty(change.id, change.property.slice("opacity:".length));
    } else {
      return; // zoomRange has no single-value getter to read back cheaply; skip
    }
    if (actual !== change.to) {
      logger.log(
        "warn",
        "styleOverrideApplier",
        `${change.id}.${change.property}: wanted ${change.to}, got ${actual}`,
      );
    }
  }

  function reapply() {
    const merged = mergeOverrides([
      computeZoomPresetOverrides(baseline, zoomPresetReferenceZoom),
      computeHideAllOverrides(baseline, hideAllEnabled),
    ]);
    const desired = resolveDesiredState(baseline, merged);
    const changes = diffDesiredState(controller.listLayers(), desired);

    for (const change of changes) {
      try {
        applyChange(change);
        verifyChange(change);
      } catch (error) {
        logger.log(
          "error",
          "styleOverrideApplier",
          `failed to apply ${change.property} on ${change.id}: ${error.message}`,
        );
      }
    }
    logger.log("debug", "styleOverrideApplier", `reapply: ${changes.length} change(s)`, {
      zoomPreset: zoomPresetReferenceZoom,
      hideAll: hideAllEnabled,
    });
  }

  return {
    // Must be called once per confirmed style load, before setZoomPreset/
    // setHideAll/reapply do anything meaningful -- this IS the baseline,
    // there is no lazy/first-call fallback (that lazy pattern is exactly
    // what caused the original bug this file replaces).
    captureBaselineNow() {
      baseline = captureBaseline(controller.listLayers());
      logger.log("info", "styleOverrideApplier", `baseline captured: ${baseline.size} layers`);
    },

    setZoomPreset(referenceZoomOrNull) {
      zoomPresetReferenceZoom = referenceZoomOrNull;
      reapply();
    },

    setHideAll(enabled) {
      hideAllEnabled = enabled;
      reapply();
    },

    reapply,

    // For the "Dump style state" diagnostic panel -- see review
    // recommendation P0.4. One look at this table would have ended the
    // zoom-preset investigation in a single round trip instead of two
    // wrong guesses: it shows declared vs. live visibility side by
    // side, plus MapLibre's actual isHidden() result and the
    // diagnostic source-used approximation, for every layer.
    getDebugTable() {
      const zoom = controller.getZoom();
      return baseline.size === 0
        ? []
        : controller.listLayers().map((layer) => {
            const declared = baseline.get(layer.id);
            return {
              id: layer.id,
              type: layer.type,
              source: layer.source ?? "",
              declaredVisibility: declared?.visibility ?? "visible",
              liveVisibility: layer.visibility ?? "visible",
              minzoom: layer.minzoom ?? "",
              maxzoom: layer.maxzoom ?? "",
              isHidden: controller.isLayerHidden(layer.id),
              sourceUsed: layer.source ? controller.isSourceUsed(layer.source) : "",
              zoom,
            };
          });
    },
  };
}
