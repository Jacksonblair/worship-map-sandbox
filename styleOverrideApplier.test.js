import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeMapStyleController } from "./mapStyleController.js";
import { createStyleOverrideApplier } from "./styleOverrideApplier.js";
import { createMemoryLogger } from "./logger.js";

// A cut-down but real reproduction of positron_test_2.json's actual
// layer table: the two major-road tiers plus a couple of the layers
// the user deliberately hid in Maputnik (park, a place label), which
// must stay hidden through every scenario below.
function positronLikeLayers() {
  return [
    {
      id: "background",
      type: "background",
      source: undefined,
      minzoom: undefined,
      maxzoom: undefined,
      visibility: "visible",
      filter: null,
      opacity: { "background-opacity": 1 },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      minzoom: undefined,
      maxzoom: undefined,
      visibility: "visible",
      filter: null,
      opacity: { "fill-opacity": 1 },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      minzoom: undefined,
      maxzoom: undefined,
      visibility: "none",
      filter: null,
      opacity: { "fill-opacity": 1 },
    }, // deliberately hidden by the user in Maputnik
    {
      id: "place_city",
      type: "symbol",
      source: "openmaptiles",
      minzoom: undefined,
      maxzoom: undefined,
      visibility: "none",
      filter: null,
      opacity: { "icon-opacity": 1, "text-opacity": 1 },
    }, // same
    {
      id: "highway_major_subtle",
      type: "line",
      source: "openmaptiles",
      minzoom: undefined,
      maxzoom: 11,
      visibility: "visible",
      filter: null,
      opacity: { "line-opacity": 1 },
    },
    {
      id: "highway_major_casing",
      type: "line",
      source: "openmaptiles",
      minzoom: 11,
      maxzoom: undefined,
      visibility: "visible",
      filter: null,
      opacity: { "line-opacity": 1 },
    },
  ];
}

describe("zoom preset regression: the exact bug reported by the user", () => {
  test("freezing at 12.82 shows casing (not subtle), then Auto restores baseline EXACTLY -- including the deliberately-hidden layers", () => {
    const controller = createFakeMapStyleController(positronLikeLayers(), 12.82);
    const logger = createMemoryLogger();
    const applier = createStyleOverrideApplier(controller, logger);
    applier.captureBaselineNow();

    applier.setZoomPreset(12.82);
    assert.equal(
      controller.isLayerHidden("highway_major_casing"),
      false,
      "casing should be forced visible at 12.82",
    );
    assert.equal(
      controller.isLayerHidden("highway_major_subtle"),
      true,
      "subtle's maxzoom (11) excludes 12.82",
    );

    // The actual reported symptom: zoom out past what the frozen preset
    // can show, THEN switch back to Auto.
    controller.setZoom(5);
    applier.setZoomPreset(null); // Auto

    const water = controller.getLayer("water");
    const park = controller.getLayer("park");
    const placeLabel = controller.getLayer("place_city");
    const subtle = controller.getLayer("highway_major_subtle");
    const casing = controller.getLayer("highway_major_casing");

    assert.equal(water.visibility, "visible");
    // This is the bug that actually shipped: the old undefined-based
    // restore turned these back on permanently. They must stay hidden.
    assert.equal(
      park.visibility,
      "none",
      "user's deliberate hide must survive a round trip through the zoom preset",
    );
    assert.equal(placeLabel.visibility, "none", "same for labels");
    assert.equal(subtle.minzoom, undefined);
    assert.equal(
      subtle.maxzoom,
      11,
      "subtle's own zoom range must be restored, not left widened or stale",
    );
    assert.equal(
      casing.minzoom,
      11,
      "casing's own zoom range must be restored after being widened to 0-24",
    );
  });

  test("toggling frozen -> auto -> frozen -> auto repeatedly always converges to the same baseline state", () => {
    const controller = createFakeMapStyleController(positronLikeLayers(), 8);
    const applier = createStyleOverrideApplier(controller, createMemoryLogger());
    applier.captureBaselineNow();
    const baselineSnapshot = JSON.stringify(controller.listLayers());

    for (let i = 0; i < 5; i += 1) {
      applier.setZoomPreset(12.82);
      applier.setZoomPreset(null);
    }

    assert.equal(
      JSON.stringify(controller.listLayers()),
      baselineSnapshot,
      "5 round trips must leave the style identical to baseline, not drift",
    );
  });

  test("re-capturing the baseline (simulating a style swap) does not leak the previous style's layer ids", () => {
    const controller = createFakeMapStyleController(positronLikeLayers(), 12.82);
    const applier = createStyleOverrideApplier(controller, createMemoryLogger());
    applier.captureBaselineNow();
    applier.setZoomPreset(12.82);

    // A different style loads -- different layer set, but SOME ids
    // deliberately overlap with Positron's own (e.g. "water" is a
    // common name across OpenMapTiles-based styles), which was
    // flagged in review as a realistic cross-style id collision risk
    // for any cache keyed only by layer.id.
    const newController = createFakeMapStyleController(
      [
        {
          id: "water",
          type: "fill",
          source: "carto",
          minzoom: undefined,
          maxzoom: undefined,
          visibility: "none",
          filter: null,
          opacity: { "fill-opacity": 1 },
        },
      ],
      12.82,
    );
    const newApplier = createStyleOverrideApplier(newController, createMemoryLogger());
    newApplier.captureBaselineNow();
    newApplier.setZoomPreset(null);

    // The new style's "water" was declared hidden -- must stay hidden,
    // not inherit visibility from the OLD applier/controller's "water".
    assert.equal(newController.getLayer("water").visibility, "none");
  });
});

describe("hide-all + zoom preset run together without clobbering each other", () => {
  test("hide-all zeroes opacity while zoom preset still controls visibility/zoom range on the same layers", () => {
    const controller = createFakeMapStyleController(positronLikeLayers(), 12.82);
    const applier = createStyleOverrideApplier(controller, createMemoryLogger());
    applier.captureBaselineNow();

    applier.setZoomPreset(12.82);
    applier.setHideAll(true);

    const casing = controller.getLayer("highway_major_casing");
    assert.equal(
      casing.visibility,
      "visible",
      "zoom preset's visibility contribution must survive hide-all being layered on top",
    );
    assert.equal(
      casing.opacity["line-opacity"],
      0,
      "hide-all's opacity contribution must also apply",
    );
    // And the source must still be marked used, since opacity (not
    // visibility) is what's hiding it -- this is the actual fix for
    // the black-screen bug, verified end-to-end through the applier.
    assert.equal(controller.isSourceUsed("openmaptiles"), true);
  });
});

describe("getDebugTable", () => {
  test("produces one row per layer with declared vs. live visibility", () => {
    const controller = createFakeMapStyleController(positronLikeLayers(), 12.82);
    const applier = createStyleOverrideApplier(controller, createMemoryLogger());
    applier.captureBaselineNow();
    applier.setZoomPreset(12.82);

    const table = applier.getDebugTable();
    const subtleRow = table.find((r) => r.id === "highway_major_subtle");
    assert.equal(subtleRow.declaredVisibility, "visible");
    assert.equal(subtleRow.liveVisibility, "none");
    assert.equal(subtleRow.isHidden, true);
  });
});
