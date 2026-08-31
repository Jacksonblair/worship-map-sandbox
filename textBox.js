// A flexible ASCII box-drawing wrapper -- takes lines of text and
// returns the box-bordered version, using the same single-line
// box-drawing characters (┌─┐│└┘) as classic roguelike/dungeon-crawler
// UI chrome, but with every corner, every edge's fill character, and
// any individual position along any edge independently overridable.
// Pure string logic, no rendering/DOM/THREE dependency, so it's
// directly testable and reusable wherever a boxed text block is needed
// (a canvas overlay, a terminal printout, eventually a real HUD).
//
// The box is a grid: 4 corners, a top/bottom edge (one char per column
// of content width), a left/right edge (one char per row of content
// height), and the padded content interior. `decorations` is a flat
// list of { edge, at, char } overrides against that grid -- `at`
// supports negative indices (-1 = last position on that edge), so e.g.
// a message-box "tail" pointer sitting right before the closing corner
// (confirmed against a real example: "└───────▼┘") is just
// { edge: "bottom", at: -1, char: "▼" }, not a special case.
//
// Deliberately just the grid + overrides, nothing higher-level (no
// built-in "pattern" or "repeat" helper) -- generating a repeating
// decoration list (a themed border, alternating icons, etc.) is a
// one-line Array.from on the CALLER's side; baking that in here would
// be guessing at needs this doesn't have yet.

const DEFAULT_CORNERS = { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘" };
const DEFAULT_FILL = { top: "─", bottom: "─", left: "│", right: "│" };

function resolveIndex(at, length) {
  return at < 0 ? length + at : at;
}

function buildEdge(edge, length, fillChar, decorations) {
  const chars = new Array(length).fill(fillChar);
  for (const d of decorations) {
    if (d.edge !== edge) continue;
    const i = resolveIndex(d.at, length);
    if (i >= 0 && i < length) chars[i] = d.char;
  }
  return chars;
}

// drawTextBox(content, options) -- content: a string (split on "\n") or
// an array of lines. options:
//   minWidth    -- pad the box out to at least this content width
//   corners     -- { topLeft, topRight, bottomLeft, bottomRight }, each optional
//   fill        -- { top, bottom, left, right } default edge characters, each optional
//   decorations -- [{ edge: "top"|"bottom"|"left"|"right", at, char }]
export function drawTextBox(content, options = {}) {
  const lines = Array.isArray(content) ? content : content.split("\n");
  const { minWidth = 0, corners = {}, fill = {}, decorations = [] } = options;

  const width = Math.max(minWidth, 0, ...lines.map((line) => line.length));
  const height = lines.length;

  const c = { ...DEFAULT_CORNERS, ...corners };
  const f = { ...DEFAULT_FILL, ...fill };

  const topEdge = buildEdge("top", width, f.top, decorations);
  const bottomEdge = buildEdge("bottom", width, f.bottom, decorations);
  const leftEdge = buildEdge("left", height, f.left, decorations);
  const rightEdge = buildEdge("right", height, f.right, decorations);

  const top = `${c.topLeft}${topEdge.join("")}${c.topRight}`;
  const bottom = `${c.bottomLeft}${bottomEdge.join("")}${c.bottomRight}`;
  const body = lines.map((line, i) => {
    const padded = line + " ".repeat(width - line.length);
    return `${leftEdge[i]}${padded}${rightEdge[i]}`;
  });

  return [top, ...body, bottom];
}

// Joins two boxes (each an array of equal-length row strings, as
// returned by drawTextBox) side by side into one array of strings --
// lets multiple boxes compose into a single HUD layout, e.g. a room map
// next to an inventory panel. Both boxes must have the same row count.
export function joinBoxesHorizontally(left, right) {
  if (left.length !== right.length) {
    throw new Error(
      `joinBoxesHorizontally: row count mismatch (${left.length} vs ${right.length})`,
    );
  }
  return left.map((row, i) => row + right[i]);
}
