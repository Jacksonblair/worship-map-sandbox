// Bridges textBox.js's plain-string box output to the two font atlases
// this sandbox actually renders with. Pure, testable, no THREE/DOM
// dependency -- same "pure logic, separate from GL glue" split as
// zoomScale.js/glyphAtlas.js.
//
// dungeon-mode.png (used for letters/icons elsewhere in this sandbox)
// reskins its punctuation-range codepoints to unrelated maze/decoration
// shapes -- confirmed by visual inspection, it has no usable ┌─┐│└┘ at
// the standard CP437 box-drawing positions. dungeon-437.png (the OTHER
// dungeonmode font variant) DOES have real box-drawing glyphs at those
// exact codepoints -- also confirmed by visual inspection. So a boxed
// label needs BOTH atlases: border characters render from dungeon-437,
// everything else (letters/digits) renders from dungeon-mode, and both
// use the identical row/col codepoint math (glyphAtlas.js's
// glyphUVRect) since both sheets share the same 16x16/8px layout.

const BORDER_CODEPOINTS = {
  "┌": 218,
  "─": 196,
  "┐": 191,
  "│": 179,
  "└": 192,
  "┘": 217,
};

export function borderCharCode(char) {
  return BORDER_CODEPOINTS[char] ?? null;
}

// The classic CP437 card-suit codepoints -- dungeon-mode.png keeps the
// standard low-codepoint CP437 layout for these (unlike its
// punctuation range, which is reskinned), confirmed by visual
// inspection. Not used by classifyBoxRow itself -- boxedLabelLayer.js
// calls this directly to build its marquee OVERLAY sprites (see its own
// header comment for why those are a separate sprite layer rather than
// characters baked into the box's own content).
const DECORATION_CODEPOINTS = {
  "♥": 3,
  "♦": 4,
  "♣": 5,
  "♠": 6,
};

export function decorationCharCode(char) {
  return DECORATION_CODEPOINTS[char] ?? null;
}

// classifyBoxRow(row) -- for one row string from drawTextBox(), returns
// the list of renderable cells: { col, code, atlas }, atlas being
// "border" or "text". Spaces produce no cell (nothing to draw) -- box
// interiors are padded with spaces, and this keeps that padding free
// instead of drawing a glyph for it.
export function classifyBoxRow(row) {
  const cells = [];
  for (let col = 0; col < row.length; col++) {
    const char = row[col];
    if (char === " ") continue;
    const borderCode = borderCharCode(char);
    if (borderCode !== null) {
      cells.push({ col, code: borderCode, atlas: "border" });
      continue;
    }
    cells.push({ col, code: char.toUpperCase().charCodeAt(0), atlas: "text" });
  }
  return cells;
}
