// Pure, codepoint-only -- no texture/GL/DOM/THREE dependency, testable
// (glyphAtlas.test.js) without a browser, same reasoning as
// zoomScale.js. Layout confirmed against apps/mobile/src/dungeonmode/
// DungeonSceneViewer.tsx's own atlas math: 16x16 grid of 8x8 glyphs,
// col = code % 16, row = floor(code / 16).
//
// vBottom/vTop follow THREE.Texture's own offset/repeat convention (V=0
// is the bottom of the image, V=1 the top -- matches THREE's default
// flipY=true on loaded textures). iconSpriteLayer.js uses this directly:
// `texture.offset.set(u0, vBottom); texture.repeat.set(1/16, 1/16);`
// crops a clone of the shared atlas texture to exactly one glyph cell,
// no shader/UV-remapping code needed.
const GLYPHS_PER_ROW = 16;
const GLYPH_ROWS = 16;

export function glyphUVRect(code) {
  const col = code % GLYPHS_PER_ROW;
  const row = Math.floor(code / GLYPHS_PER_ROW);
  const u0 = col / GLYPHS_PER_ROW;
  const u1 = (col + 1) / GLYPHS_PER_ROW;
  const vTop = 1 - row / GLYPH_ROWS;
  const vBottom = 1 - (row + 1) / GLYPH_ROWS;
  return { u0, u1, vBottom, vTop };
}
