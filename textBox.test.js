import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { drawTextBox, joinBoxesHorizontally } from "./textBox.js";

describe("drawTextBox", () => {
  test("plain box with no decorations", () => {
    assert.deepEqual(drawTextBox(["x"]), ["┌─┐", "│x│", "└─┘"]);
  });

  test("reproduces the exact message-box tail example", () => {
    // Real example: "└───────▼┘" -- the ▼ sits at the LAST fill
    // position, immediately before the closing corner, not instead of it.
    const result = drawTextBox(["you take", "-1♥ dmg!"], {
      decorations: [{ edge: "bottom", at: -1, char: "▼" }],
    });
    assert.deepEqual(result, ["┌────────┐", "│you take│", "│-1♥ dmg!│", "└───────▼┘"]);
  });

  test("reproduces the exact decorated-top-border example", () => {
    // Real example: "┌♥♡♡─┐" over a 4-wide room -- icons at the first
    // three top positions, the fourth left as plain fill.
    const result = drawTextBox(["∙∙∙⟏", "∙☠∙∙", "∙∙@∙", "∙∙∙∙"], {
      decorations: [
        { edge: "top", at: 0, char: "♥" },
        { edge: "top", at: 1, char: "♡" },
        { edge: "top", at: 2, char: "♡" },
      ],
    });
    assert.equal(result[0], "┌♥♡♡─┐");
  });

  test("pads shorter lines to the widest line's width", () => {
    const result = drawTextBox(["hi", "a longer line"]);
    assert.equal(result[1].length, result[2].length);
    assert.equal(result[1], `│hi${" ".repeat(11)}│`);
  });

  test("accepts a single multi-line string", () => {
    assert.deepEqual(drawTextBox("ab\ncd"), ["┌──┐", "│ab│", "│cd│", "└──┘"]);
  });

  test("minWidth pads narrower content up to a fixed box width", () => {
    assert.equal(drawTextBox(["hi"], { minWidth: 5 })[0], "┌─────┐");
  });

  test("custom corners and fill characters (e.g. a double-line style)", () => {
    const result = drawTextBox(["x"], {
      corners: { topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝" },
      fill: { top: "═", bottom: "═", left: "║", right: "║" },
    });
    assert.deepEqual(result, ["╔═╗", "║x║", "╚═╝"]);
  });

  test("decorations on the left/right edges target specific content rows", () => {
    const result = drawTextBox(["aa", "bb"], {
      decorations: [
        { edge: "left", at: 0, char: "♦" },
        { edge: "right", at: -1, char: "♦" },
      ],
    });
    assert.equal(result[1], "♦aa│");
    assert.equal(result[2], "│bb♦");
  });

  test("an out-of-range decoration index is silently ignored", () => {
    const result = drawTextBox(["x"], { decorations: [{ edge: "top", at: 5, char: "!" }] });
    assert.equal(result[0], "┌─┐");
  });

  test("degenerate empty content still produces a valid box", () => {
    assert.deepEqual(drawTextBox([""]), ["┌┐", "││", "└┘"]);
  });
});

describe("joinBoxesHorizontally", () => {
  test("zips two equal-height boxes into one side-by-side layout", () => {
    const room = drawTextBox(["∙∙∙⟏", "∙☠∙∙", "∙∙@∙", "∙∙∙∙"], {
      decorations: [
        { edge: "top", at: 0, char: "♥" },
        { edge: "top", at: 1, char: "♡" },
        { edge: "top", at: 2, char: "♡" },
      ],
    });
    const inventory = drawTextBox(["†3", "⛨1", "⚱⚱", "⚷⚷"]);
    assert.deepEqual(joinBoxesHorizontally(room, inventory), [
      "┌♥♡♡─┐┌──┐",
      "│∙∙∙⟏││†3│",
      "│∙☠∙∙││⛨1│",
      "│∙∙@∙││⚱⚱│",
      "│∙∙∙∙││⚷⚷│",
      "└────┘└──┘",
    ]);
  });

  test("throws on mismatched row counts rather than silently misaligning", () => {
    assert.throws(() => joinBoxesHorizontally(["a"], ["b", "c"]));
  });
});
