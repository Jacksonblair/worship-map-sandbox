import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  layerOpacityProperties,
  captureBaseline,
  computeZoomPresetOverrides,
  computeHideAllOverrides,
  mergeOverrides,
  resolveDesiredState,
  diffDesiredState,
} from "./styleOverrides.js";

function layer(overrides) {
  return {
    id: "layer",
    type: "fill",
    source: "src",
    sourceLayer: "water",
    visibility: undefined,
    minzoom: undefined,
    maxzoom: undefined,
    filter: null,
    opacity: {},
    ...overrides,
  };
}

describe("layerOpacityProperties", () => {
  test("returns the right paint property per type", () => {
    assert.deepEqual(layerOpacityProperties("fill"), ["fill-opacity"]);
    assert.deepEqual(layerOpacityProperties("symbol"), ["icon-opacity", "text-opacity"]);
    assert.deepEqual(layerOpacityProperties("background"), ["background-opacity"]);
  });
  test("returns empty array for a type with no known opacity property", () => {
    assert.deepEqual(layerOpacityProperties("hillshade"), []);
  });
});

describe("computeZoomPresetOverrides", () => {
  test("referenceZoom === null contributes no overrides (Auto)", () => {
    const baseline = captureBaseline([layer({ id: "a" })]);
    const overrides = computeZoomPresetOverrides(baseline, null);
    assert.equal(overrides.size, 0);
  });

  test("a layer whose minzoom excludes the reference zoom is forced hidden", () => {
    // Reproduces Positron's real highway_major_subtle: maxzoom 11.
    const baseline = captureBaseline([layer({ id: "subtle", maxzoom: 11, visibility: "visible" })]);
    const overrides = computeZoomPresetOverrides(baseline, 12.82);
    assert.equal(overrides.get("subtle").visibility, "none");
  });

  test("a layer in range at the reference zoom is forced visible AND zoom-widened", () => {
    // Reproduces Positron's real highway_major_casing: minzoom 11.
    // The old buggy version only set visibility -- confirming minzoom/
    // maxzoom are ALSO overridden is exactly what makes this fix real,
    // since MapLibre checks zoom range before visibility (per review).
    const baseline = captureBaseline([layer({ id: "casing", minzoom: 11, visibility: "visible" })]);
    const overrides = computeZoomPresetOverrides(baseline, 12.82);
    const override = overrides.get("casing");
    assert.equal(override.visibility, "visible");
    assert.equal(override.minzoom, 0);
    assert.equal(override.maxzoom, 24);
  });

  test("a layer already hidden regardless of zoom (e.g. park/labels toggled off) stays hidden even if in range", () => {
    const baseline = captureBaseline([layer({ id: "park", visibility: "none" })]); // no minzoom/maxzoom at all -- always "in range"
    const overrides = computeZoomPresetOverrides(baseline, 12.82);
    assert.equal(overrides.get("park").visibility, "none");
  });

  test("out-of-range layers get their own original zoom range explicitly restored, not left stale", () => {
    const baseline = captureBaseline([layer({ id: "subtle", maxzoom: 11, visibility: "visible" })]);
    const overrides = computeZoomPresetOverrides(baseline, 12.82);
    const override = overrides.get("subtle");
    assert.equal(override.minzoom, undefined);
    assert.equal(override.maxzoom, 11);
  });
});

describe("computeHideAllOverrides", () => {
  test("enabled: false contributes no overrides", () => {
    const baseline = captureBaseline([layer({ id: "a" })]);
    assert.equal(computeHideAllOverrides(baseline, false).size, 0);
  });

  test("enabled: true zeroes every applicable opacity property, not visibility", () => {
    const baseline = captureBaseline([
      layer({ id: "water-fill", type: "fill" }),
      layer({ id: "labels", type: "symbol" }),
    ]);
    const overrides = computeHideAllOverrides(baseline, true);
    assert.deepEqual(overrides.get("water-fill").opacity, { "fill-opacity": 0 });
    assert.deepEqual(overrides.get("labels").opacity, { "icon-opacity": 0, "text-opacity": 0 });
    assert.equal(overrides.get("water-fill").visibility, undefined);
  });

  test("a layer type with no opacity property is skipped entirely", () => {
    const baseline = captureBaseline([layer({ id: "shade", type: "hillshade" })]);
    const overrides = computeHideAllOverrides(baseline, true);
    assert.equal(overrides.has("shade"), false);
  });
});

describe("mergeOverrides", () => {
  test("two features touching different properties of the same layer both apply", () => {
    const zoomOverrides = new Map([["water", { visibility: "visible", minzoom: 0, maxzoom: 24 }]]);
    const hideOverrides = new Map([["water", { opacity: { "fill-opacity": 0 } }]]);
    const merged = mergeOverrides([zoomOverrides, hideOverrides]);
    assert.deepEqual(merged.get("water"), {
      visibility: "visible",
      minzoom: 0,
      maxzoom: 24,
      opacity: { "fill-opacity": 0 },
    });
  });

  test("a later map wins over an earlier map for the same property", () => {
    const first = new Map([["a", { visibility: "visible" }]]);
    const second = new Map([["a", { visibility: "none" }]]);
    assert.equal(mergeOverrides([first, second]).get("a").visibility, "none");
  });
});

describe("resolveDesiredState + diffDesiredState", () => {
  test("a layer with no override falls back exactly to baseline", () => {
    const baseline = captureBaseline([layer({ id: "a", visibility: "visible", minzoom: 5 })]);
    const desired = resolveDesiredState(baseline, new Map());
    assert.equal(desired.get("a").visibility, "visible");
    assert.equal(desired.get("a").minzoom, 5);
  });

  test("diff only reports properties that actually changed", () => {
    const current = [layer({ id: "a", visibility: "visible", opacity: { "fill-opacity": 1 } })];
    const desired = new Map([
      [
        "a",
        {
          id: "a",
          visibility: "visible",
          minzoom: undefined,
          maxzoom: undefined,
          opacity: { "fill-opacity": 1 },
        },
      ],
    ]);
    assert.deepEqual(diffDesiredState(current, desired), []);
  });

  test("diff reports a visibility change", () => {
    const current = [layer({ id: "a", visibility: "visible", opacity: {} })];
    const desired = new Map([
      ["a", { id: "a", visibility: "none", minzoom: undefined, maxzoom: undefined, opacity: {} }],
    ]);
    const changes = diffDesiredState(current, desired);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].property, "visibility");
    assert.equal(changes[0].to, "none");
  });

  test("a layer no longer present (style swap) is skipped, not thrown on", () => {
    const desired = new Map([["gone", { id: "gone", visibility: "visible", opacity: {} }]]);
    assert.doesNotThrow(() => diffDesiredState([], desired));
  });
});
