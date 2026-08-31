import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { glyphUVRect } from "./glyphAtlas.js";

describe("glyphUVRect", () => {
  test("codepoint 0 is the top-left glyph cell", () => {
    const rect = glyphUVRect(0);
    assert.equal(rect.u0, 0);
    assert.ok(rect.u1 > rect.u0);
    assert.equal(rect.vTop, 1);
    assert.ok(rect.vBottom < rect.vTop);
  });

  test("codepoint 15 is the last cell of row 0 (right edge)", () => {
    const rect = glyphUVRect(15);
    assert.equal(rect.u1, 1);
  });

  test("codepoint 16 wraps to row 1, column 0", () => {
    const row0 = glyphUVRect(0);
    const row1 = glyphUVRect(16);
    assert.equal(row1.u0, row0.u0);
    assert.ok(row1.vTop < row0.vTop);
  });

  test("codepoint 255 is the bottom-right glyph cell", () => {
    const rect = glyphUVRect(255);
    assert.equal(rect.u1, 1);
    assert.equal(rect.vBottom, 0);
  });
});
