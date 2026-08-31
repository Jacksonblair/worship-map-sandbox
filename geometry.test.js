// Covers the geometry helpers that don't depend on the maplibregl/earcut
// browser globals (mercXY, ringsFromGeometry, linesFromGeometry, and
// polygonToTriangles all need one of those two globals and are out of
// scope for a plain-Node test run -- they're exercised for real every
// time the sandbox is actually loaded in a browser instead).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  catmullRomSpline,
  pointsToLineSegments,
  tiledUV,
  withRepeated,
  lineToTriangles,
} from "./geometry.js";

describe("catmullRomSpline", () => {
  test("passes through every original point exactly", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 3, y: 1 },
      { x: 4, y: 4 },
    ];
    const spline = catmullRomSpline(points, 4);
    for (const p of points) {
      assert.ok(
        spline.some((s) => Math.abs(s.x - p.x) < 1e-9 && Math.abs(s.y - p.y) < 1e-9),
        `missing original point (${p.x},${p.y})`,
      );
    }
  });

  test("adds interpolated points between originals", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const spline = catmullRomSpline(points, 4);
    assert.ok(spline.length > points.length);
  });

  test("fewer than 3 points is returned unchanged (nothing to smooth)", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    assert.equal(catmullRomSpline(points, 4), points);
  });

  test("ends exactly on the last original point", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ];
    const spline = catmullRomSpline(points, 3);
    const last = spline[spline.length - 1];
    assert.equal(last.x, 10);
    assert.equal(last.y, 0);
  });
});

describe("pointsToLineSegments", () => {
  test("produces a gl.LINES-style pair list, not a strip", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    // 3 points -> 2 segments -> 4 vertices -> 8 numbers
    assert.deepEqual(pointsToLineSegments(points), [0, 0, 1, 1, 1, 1, 2, 2]);
  });

  test("a single point produces no segments", () => {
    assert.deepEqual(pointsToLineSegments([{ x: 0, y: 0 }]), []);
  });
});

describe("tiledUV", () => {
  test("reduces a large world-position/tile-size ratio to a small magnitude", () => {
    const uv = tiledUV(0.5, 7e-7);
    assert.ok(Math.abs(uv) < 1024, `expected magnitude under 1024, got ${uv}`);
  });

  test("preserves the fractional part exactly (only removes whole multiples of 1024)", () => {
    const tileSize = 0.001;
    const worldPos = 1024.25 * tileSize; // raw ratio is exactly 1024.25
    const uv = tiledUV(worldPos, tileSize);
    assert.ok(Math.abs(uv - 0.25) < 1e-9, `expected ~0.25, got ${uv}`);
  });
});

describe("withRepeated", () => {
  test("cycles through values to fill the requested count", () => {
    assert.deepEqual(withRepeated([1, 2], 5), [1, 2, 1, 2, 1]);
  });
});

describe("lineToTriangles", () => {
  test("produces 6 vertices (2 triangles) per segment", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const positions = lineToTriangles(points, 2);
    assert.equal(positions.length, (points.length - 1) * 6 * 2); // *2 for x,y pairs
  });

  test("expands perpendicular to the segment direction", () => {
    const positions = lineToTriangles(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
    );
    // A horizontal segment should expand in Y, not X, at half-width 2.
    const ys = [];
    for (let i = 1; i < positions.length; i += 2) ys.push(positions[i]);
    assert.ok(ys.some((y) => Math.abs(y - 2) < 1e-9));
    assert.ok(ys.some((y) => Math.abs(y + 2) < 1e-9));
  });
});
