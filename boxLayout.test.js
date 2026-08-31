import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { borderCharCode, decorationCharCode, classifyBoxRow } from "./boxLayout.js";
import { drawTextBox } from "./textBox.js";

describe("borderCharCode", () => {
  test("maps all 6 single-line box-drawing characters to real CP437 codepoints", () => {
    assert.equal(borderCharCode("┌"), 218);
    assert.equal(borderCharCode("─"), 196);
    assert.equal(borderCharCode("┐"), 191);
    assert.equal(borderCharCode("│"), 179);
    assert.equal(borderCharCode("└"), 192);
    assert.equal(borderCharCode("┘"), 217);
  });

  test("returns null for a character with no border mapping", () => {
    assert.equal(borderCharCode("A"), null);
    assert.equal(borderCharCode("♥"), null);
  });
});

describe("decorationCharCode", () => {
  test("maps all 4 card suits to their real CP437 codepoints", () => {
    assert.equal(decorationCharCode("♥"), 3);
    assert.equal(decorationCharCode("♦"), 4);
    assert.equal(decorationCharCode("♣"), 5);
    assert.equal(decorationCharCode("♠"), 6);
  });

  test("returns null for a character with no decoration mapping", () => {
    assert.equal(decorationCharCode("A"), null);
    assert.equal(decorationCharCode("┌"), null);
  });
});

describe("classifyBoxRow", () => {
  test("a top border row is entirely border-atlas cells", () => {
    const cells = classifyBoxRow("┌───┐");
    assert.deepEqual(cells, [
      { col: 0, code: 218, atlas: "border" },
      { col: 1, code: 196, atlas: "border" },
      { col: 2, code: 196, atlas: "border" },
      { col: 3, code: 196, atlas: "border" },
      { col: 4, code: 191, atlas: "border" },
    ]);
  });

  test("a content row mixes border edges with text-atlas letters, skipping spaces", () => {
    const cells = classifyBoxRow("│HI │");
    assert.deepEqual(cells, [
      { col: 0, code: 179, atlas: "border" },
      { col: 1, code: "H".charCodeAt(0), atlas: "text" },
      { col: 2, code: "I".charCodeAt(0), atlas: "text" },
      { col: 4, code: 179, atlas: "border" },
    ]);
  });

  test("composes cleanly with drawTextBox's real output", () => {
    const rows = drawTextBox(["OK"]);
    assert.deepEqual(rows, ["┌──┐", "│OK│", "└──┘"]);
    const middleRowCells = classifyBoxRow(rows[1]);
    assert.deepEqual(middleRowCells, [
      { col: 0, code: 179, atlas: "border" },
      { col: 1, code: "O".charCodeAt(0), atlas: "text" },
      { col: 2, code: "K".charCodeAt(0), atlas: "text" },
      { col: 3, code: 179, atlas: "border" },
    ]);
  });
});
