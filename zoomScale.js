// Pure, zoom-only -- no map/GL/DOM/THREE dependency, so it's directly
// testable (zoomScale.test.js) without a browser. Shared by
// spriteLayer.js and iconSpriteLayer.js so both grow/shrink identically
// with zoom. Kept in its own file (rather than living inside
// spriteLayer.js, as it originally did) specifically so it can be
// imported by tests WITHOUT also importing spriteLayer.js's own
// `import * as THREE from "https://..."` -- Node's test runner can't
// resolve https:// import specifiers, so any pure logic that needs to
// stay unit-testable has to live somewhere that never imports THREE.

const REFERENCE_ZOOM = 14; // matches main.js's INITIAL_ZOOM -- sprites are sized for this zoom
const MIN_SCALE = 0.4;
const MAX_SCALE = 3.0;

// Clamped so zooming all the way out doesn't shrink sprites to
// invisible dots and zooming all the way in doesn't blow them up past
// readability.
export function zoomScaleFor(
  zoom,
  referenceZoom = REFERENCE_ZOOM,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
) {
  const raw = Math.pow(2, (zoom - referenceZoom) * 0.5);
  return Math.min(maxScale, Math.max(minScale, raw));
}
