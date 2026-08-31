import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLineTransform } from "./lineTransform.js";

describe("computeLineTransform", () => {
  test("midpoint and length for a simple horizontal segment", () => {
    const t = computeLineTransform(0, 0, 10, 0);
    assert.equal(t.midX, 5);
    assert.equal(t.midY, 0);
    assert.equal(t.length, 10);
  });

  test("straight down (dx=0, dy>0) is rotation 0 -- the common case", () => {
    const t = computeLineTransform(0, 0, 0, 20);
    // atan2(-0, positive) is -0 in JS, numerically identical to 0 but
    // not === under strict equality -- check magnitude, not sign of zero.
    assert.ok(Math.abs(t.rotation) < 1e-9);
    assert.equal(t.length, 20);
  });

  test("straight right (dx>0, dy=0) rotates -90 degrees", () => {
    const t = computeLineTransform(0, 0, 10, 0);
    assert.ok(Math.abs(t.rotation - -Math.PI / 2) < 1e-9);
  });

  test("straight left (dx<0, dy=0) rotates +90 degrees", () => {
    const t = computeLineTransform(0, 0, -10, 0);
    assert.ok(Math.abs(t.rotation - Math.PI / 2) < 1e-9);
  });

  test("straight up (dx=0, dy<0) rotates 180 degrees", () => {
    const t = computeLineTransform(0, 0, 0, -10);
    assert.ok(Math.abs(Math.abs(t.rotation) - Math.PI) < 1e-9);
  });

  test("a 45-degree diagonal splits the difference", () => {
    const t = computeLineTransform(0, 0, 10, 10);
    assert.ok(Math.abs(t.rotation - -Math.PI / 4) < 1e-9);
    assert.ok(Math.abs(t.length - Math.hypot(10, 10)) < 1e-9);
  });

  test("zero-length line (identical points) doesn't throw", () => {
    const t = computeLineTransform(5, 5, 5, 5);
    assert.equal(t.length, 0);
  });
});
