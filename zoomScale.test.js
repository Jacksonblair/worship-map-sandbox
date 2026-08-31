import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { zoomScaleFor } from "./zoomScale.js";

describe("zoomScaleFor", () => {
  test("scale is 1 exactly at the reference zoom", () => {
    assert.equal(zoomScaleFor(14, 14), 1);
  });

  test("zooming in past reference makes sprites bigger", () => {
    assert.ok(zoomScaleFor(16, 14) > 1);
    assert.ok(zoomScaleFor(18, 14) > zoomScaleFor(16, 14));
  });

  test("zooming out past reference makes sprites smaller", () => {
    assert.ok(zoomScaleFor(12, 14) < 1);
    assert.ok(zoomScaleFor(10, 14) < zoomScaleFor(12, 14));
  });

  test("clamps to minScale/maxScale instead of growing unbounded", () => {
    assert.equal(zoomScaleFor(30, 14, 0.4, 3.0), 3.0);
    assert.equal(zoomScaleFor(0, 14, 0.4, 3.0), 0.4);
  });
});
