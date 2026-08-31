import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scatterPoints } from "./landmarkScatter.js";

describe("scatterPoints", () => {
  test("returns exactly `count` points", () => {
    const points = scatterPoints("seed", 151.2, -33.87, 7, 0.02);
    assert.equal(points.length, 7);
  });

  test("same seed/args always produce the same layout", () => {
    const a = scatterPoints("marrickville:bar", 151.15, -33.91, 5, 0.015);
    const b = scatterPoints("marrickville:bar", 151.15, -33.91, 5, 0.015);
    assert.deepEqual(a, b);
  });

  test("every point stays within radiusDegrees of the center", () => {
    const centerLng = 151.2;
    const centerLat = -33.87;
    const radius = 0.02;
    const points = scatterPoints("seed", centerLng, centerLat, 50, radius);
    for (const { lng, lat } of points) {
      const distance = Math.hypot(lng - centerLng, lat - centerLat);
      assert.ok(distance <= radius + 1e-9, `point (${lng},${lat}) escaped radius ${radius}`);
    }
  });

  test("different seeds produce different layouts", () => {
    const a = scatterPoints("bondi:bar", 151.27, -33.89, 5, 0.015);
    const b = scatterPoints("coogee:bar", 151.25, -33.92, 5, 0.015);
    assert.notDeepEqual(a, b);
  });

  test("count 0 returns an empty array without throwing", () => {
    assert.deepEqual(scatterPoints("seed", 151.2, -33.87, 0, 0.02), []);
  });
});
