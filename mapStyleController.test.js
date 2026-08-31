import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFakeMapStyleController } from "./mapStyleController.js";

function layer(overrides) {
  return {
    id: "layer",
    type: "fill",
    source: "openmaptiles",
    sourceLayer: "water",
    visibility: "visible",
    minzoom: undefined,
    maxzoom: undefined,
    filter: null,
    opacity: { "fill-opacity": 1 },
    ...overrides,
  };
}

describe("isLayerHidden -- must match MapLibre's real StyleLayer#isHidden", () => {
  test("zoom range is checked BEFORE visibility (the actual root cause of the zoom-preset bug)", () => {
    const controller = createFakeMapStyleController(
      [layer({ id: "casing", minzoom: 11, visibility: "visible" })],
      5,
    );
    // Visible, but real zoom (5) is below minzoom (11) -- must be hidden.
    assert.equal(controller.isLayerHidden("casing"), true);
  });

  test("in range and visible -> not hidden", () => {
    const controller = createFakeMapStyleController(
      [layer({ id: "casing", minzoom: 11, visibility: "visible" })],
      12,
    );
    assert.equal(controller.isLayerHidden("casing"), false);
  });

  test("in range but visibility none -> hidden", () => {
    const controller = createFakeMapStyleController(
      [layer({ id: "park", visibility: "none" })],
      12,
    );
    assert.equal(controller.isLayerHidden("park"), true);
  });

  test("maxzoom is an exclusive upper bound (zoom === maxzoom is out of range)", () => {
    const controller = createFakeMapStyleController([layer({ id: "subtle", maxzoom: 11 })], 11);
    assert.equal(controller.isLayerHidden("subtle"), true);
  });
});

describe("isSourceUsed -- reproduces the minimal-preset black-screen root cause", () => {
  test("hiding every layer referencing a source via visibility marks the source unused", () => {
    const controller = createFakeMapStyleController(
      [
        layer({ id: "water", source: "openmaptiles", visibility: "none" }),
        layer({ id: "building", source: "openmaptiles", visibility: "none" }),
      ],
      12,
    );
    // This is the actual bug: with every layer hidden via visibility,
    // MapLibre stops loading tiles for the source at all (confirmed
    // against MapLibre's SourceCache#update in code review) --
    // querySourceFeatures then has nothing to return, and the custom
    // layer drawing from it renders nothing. Screen goes black with no
    // thrown error anywhere.
    assert.equal(controller.isSourceUsed("openmaptiles"), false);
  });

  test("hiding the same layers via opacity keeps the source used (the actual fix)", () => {
    const controller = createFakeMapStyleController(
      [
        layer({ id: "water", source: "openmaptiles", visibility: "visible" }),
        layer({ id: "building", source: "openmaptiles", visibility: "visible" }),
      ],
      12,
    );
    controller.setPaintProperty("water", "fill-opacity", 0);
    controller.setPaintProperty("building", "fill-opacity", 0);
    assert.equal(controller.isSourceUsed("openmaptiles"), true);
  });

  test("a source with no layers referencing it is unused", () => {
    const controller = createFakeMapStyleController(
      [layer({ id: "water", source: "openmaptiles" })],
      12,
    );
    assert.equal(controller.isSourceUsed("some-other-source"), false);
  });
});

describe("setLayoutProperty / setPaintProperty error behavior", () => {
  test("setting a property on a non-existent layer throws (matches MapLibre's real ErrorEvent case)", () => {
    const controller = createFakeMapStyleController([layer({ id: "a" })], 10);
    assert.throws(() => controller.setLayoutProperty("does-not-exist", "visibility", "none"));
  });
});
