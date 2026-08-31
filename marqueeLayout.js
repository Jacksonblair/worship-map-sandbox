// Casino-marquee decorations for a textBox.js box -- lights studded at
// regular intervals around the FULL perimeter (all 4 edges), chasing in
// sequence like bulbs on a sign frame. Two pure, independent, testable
// concerns, deliberately not bundled into one "MarqueeController"
// (Interface Segregation -- neither function needs to know the other
// exists):
//
//   marqueePositions -- WHERE the lights sit. Built entirely on
//   textBox.js's own `decorations` mechanism (Open/Closed -- textBox.js
//   itself needed zero changes for this; generating a decorations list
//   programmatically is the exact extension point its own header
//   comment calls out). Returns each position in BOTH the shape
//   textBox.js's decorations array wants ({edge, at}) and the
//   row/col shape boxLayout.js's classifyBoxRow reports cells in, so a
//   caller never has to duplicate the edge-to-grid-coordinate math
//   itself, and in clockwise order (top → right → bottom → left) so
//   that order alone IS the chase sequence -- no separate perimeter
//   sort needed downstream.
//
//   marqueeBrightness -- WHEN a given light is lit. Pure function of
//   (index, total, time), no THREE/DOM/GL dependency, no awareness that
//   its output will end up as a sprite's opacity -- that link is
//   boxedLabelLayer.js's job, not this module's.

// marqueePositions(contentWidth, contentHeight, interval) --
// contentWidth/contentHeight are the box's INTERIOR dimensions (before
// adding the 2 border rows/columns) -- for the single-line boxed labels
// this sandbox draws, contentWidth is just the (uppercased) name's
// length and contentHeight is always 1.
export function marqueePositions(contentWidth, contentHeight, interval = 3) {
  const positions = [];
  const push = (edge, at, row, col) => positions.push({ edge, at, row, col });

  for (let i = 0; i < contentWidth; i += interval) push("top", i, 0, i + 1);
  for (let i = 0; i < contentHeight; i += interval) push("right", i, i + 1, contentWidth + 1);
  for (let i = contentWidth - 1; i >= 0; i -= interval) push("bottom", i, contentHeight + 1, i + 1);
  for (let i = contentHeight - 1; i >= 0; i -= interval) push("left", i, i + 1, 0);

  return positions;
}

// marqueeBrightness(index, totalCount, time, options) -- 1.0 at the
// "head" light currently sweeping past `index`, fading linearly to 0
// over `tailLength` positions behind it (a comet-style chase, not a
// single hard on/off bulb), wrapping around the ring once per
// `cycleSeconds`. `index` is a position in the SAME ordering
// marqueePositions returns, so index 0 there is index 0 here.
export function marqueeBrightness(
  index,
  totalCount,
  time,
  { cycleSeconds = 1.5, tailLength = 2 } = {},
) {
  if (totalCount <= 0) return 0;
  const progress = (((time / cycleSeconds) % 1) + 1) % 1; // 0..1, guards against negative `time`
  const headIndex = progress * totalCount;
  // How far the head has already swept PAST `index` (0 = head is exactly
  // here, growing as the head moves further ahead) -- deliberately
  // directional, not a symmetric distance either way. A light the head
  // hasn't reached yet must read as unlit, not "equally close" to one
  // the head just passed; that's what actually reads as a comet chasing
  // forward instead of a glow that happens to be centered on the head.
  const behindDistance = (headIndex - index + totalCount) % totalCount;
  if (behindDistance > tailLength) return 0;
  return 1 - behindDistance / tailLength;
}
