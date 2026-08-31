import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { marqueePositions, marqueeBrightness } from "./marqueeLayout.js";

describe("marqueePositions", () => {
  test("walks the perimeter clockwise: top, right, bottom, left", () => {
    const positions = marqueePositions(6, 1, 3);
    assert.deepEqual(
      positions.map((p) => p.edge),
      ["top", "top", "right", "bottom", "bottom", "left"],
    );
  });

  test("row/col match textBox.js's own corner-inclusive grid coordinates", () => {
    // A 6-wide, 1-tall box has rows: top border (row 0), 1 content row
    // (row 1), bottom border (row 2) -- matching drawTextBox's own
    // output shape exactly.
    const positions = marqueePositions(6, 1, 3);
    const top = positions.find((p) => p.edge === "top" && p.at === 0);
    assert.deepEqual(top, { edge: "top", at: 0, row: 0, col: 1 });

    const right = positions.find((p) => p.edge === "right");
    assert.deepEqual(right, { edge: "right", at: 0, row: 1, col: 7 }); // col = contentWidth + 1

    // Bottom walks backward from contentWidth-1 in steps of `interval`,
    // so for contentWidth=6/interval=3 that's [5, 2], not [3] -- picking
    // an `at` this sequence actually produces, not an assumed one.
    const bottom = positions.find((p) => p.edge === "bottom" && p.at === 5);
    assert.deepEqual(bottom, { edge: "bottom", at: 5, row: 2, col: 6 });

    const left = positions.find((p) => p.edge === "left");
    assert.deepEqual(left, { edge: "left", at: 0, row: 1, col: 0 });
  });

  test("bottom edge walks right-to-left, completing the clockwise loop", () => {
    const positions = marqueePositions(9, 1, 3);
    const bottomAts = positions.filter((p) => p.edge === "bottom").map((p) => p.at);
    assert.deepEqual(bottomAts, [8, 5, 2]);
  });

  test("a wider interval than the content simply produces fewer lights, not zero", () => {
    const positions = marqueePositions(2, 1, 10);
    assert.ok(positions.length > 0);
  });
});

describe("marqueeBrightness", () => {
  test("the light at the current head position is fully lit", () => {
    // At time=0, progress=0, so index 0 (headIndex=0) is the head.
    assert.equal(marqueeBrightness(0, 10, 0, { cycleSeconds: 1, tailLength: 2 }), 1);
  });

  test("fades linearly over the tail length behind the head", () => {
    const options = { cycleSeconds: 1, tailLength: 2 };
    const atHead = marqueeBrightness(0, 10, 0, options);
    const oneBehind = marqueeBrightness(9, 10, 0, options); // index 9 is 1 position behind index 0 on a 10-light ring
    const twoBehind = marqueeBrightness(8, 10, 0, options);
    assert.ok(atHead > oneBehind);
    assert.ok(oneBehind > twoBehind);
    assert.equal(twoBehind, 0); // exactly at tailLength -> fully faded
  });

  test("lights ahead of the head or far behind it are unlit", () => {
    const options = { cycleSeconds: 1, tailLength: 2 };
    assert.equal(marqueeBrightness(1, 10, 0, options), 0); // ahead of the head
    assert.equal(marqueeBrightness(5, 10, 0, options), 0); // far away either direction
  });

  test("the head sweeps forward continuously as time advances", () => {
    const options = { cycleSeconds: 2, tailLength: 1 };
    // At t=1 (half the cycle), the head should be at index 5 of 10.
    assert.equal(marqueeBrightness(5, 10, 1, options), 1);
  });

  test("wraps around the ring instead of stopping at the last index", () => {
    // At t just past a full cycle, the head should be back near index 0,
    // and index (totalCount-1) should read as "1 behind" via wraparound.
    const brightness = marqueeBrightness(9, 10, 0.001, { cycleSeconds: 1, tailLength: 2 });
    assert.ok(brightness > 0);
  });

  test("zero or negative totalCount never throws, just returns unlit", () => {
    assert.equal(marqueeBrightness(0, 0, 5), 0);
  });
});
