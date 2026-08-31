// Pure geometry: given two screen points, the position/length/rotation
// needed to draw a THREE.Sprite as a line segment between them. No
// THREE/DOM dependency -- kept in its own file so it's testable without
// ever resolving the "three" bare specifier (same reasoning as
// zoomScale.js/glyphAtlas.js elsewhere in this sandbox: a file that
// imports THREE can't be imported by node --test).

// Matches THREE.Sprite's own rotation shader math exactly (confirmed
// against Three's actual source): at rotation=0, a sprite's local +Y
// axis maps to screen +Y (down) under this sandbox's inverted-Y camera
// convention (see spriteLayer.js's header for why that inversion
// exists everywhere here). Derived so rotation=0 already means
// "pointing straight down" -- the common case, a label directly above
// its ground point -- and every other direction rotates correctly from
// that baseline.
export function computeLineTransform(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return {
    midX: (x1 + x2) / 2,
    midY: (y1 + y2) / 2,
    length: Math.hypot(dx, dy),
    rotation: Math.atan2(-dx, dy),
  };
}
