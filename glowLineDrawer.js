// A reusable, screen-space glowing line-segment drawer -- given two
// screen points, draws a soft-edged, additively-blended line directly
// onto the real canvas. No knowledge of boxes/labels/marquees at all;
// boxedLabelLayer.js is the first consumer (a tether from a label's box
// down to its real ground point), but any layer can create its own
// independent instance and call draw() between any two screen points.
//
// Deliberately NOT bloom-processed, unlike boxedLabelLayer.js's box
// content. A tether's TOP endpoint moves every frame (it's attached to
// a bobbing box) while its bottom endpoint (a real ground position)
// stays fixed -- meaning the line's length/angle change continuously.
// That's exactly the kind of continuously-changing geometry that made
// real bloom visibly flicker earlier in this sandbox (UnrealBloomPass's
// multi-mip blur is extremely sensitive to exact pixel alignment, and
// content that moves every frame keeps landing differently against it
// -- see glowEffects.js's header for the full incident). A soft
// procedural gradient texture drawn with additive blending gets a
// convincing glow with none of that sensitivity, since there's no
// multi-pass blur pipeline involved at all -- a deliberate design
// choice for moving content, not a corner cut.
//
// Owns HOW a line is positioned/oriented/scaled (shared by every line
// type); WHAT it looks like (glow/dashed/dotted/...) lives in
// lineStyles.js, so adding a new visual style never touches this file.

import * as THREE from "three";
import { computeLineTransform } from "./lineTransform.js";
import { createLineStyleRegistry } from "./lineStyles.js";

// createGlowLineDrawer() -- returns { draw(renderer, x1, y1, x2, y2,
// options, canvasWidth, canvasHeight), dispose() }. options: { color:
// [r, g, b, a], thickness, lineType } -- all optional.
export function createGlowLineDrawer() {
  let scene, camera, material, sprite, styleRegistry;

  function ensure() {
    if (scene) return;
    styleRegistry = createLineStyleRegistry();
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1); // real bounds set per draw(), from the real canvas size
    material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // this sandbox's screen-space camera is inverted-Y, which flips triangle winding -- without this, default back-face culling silently discards the whole sprite
    });
    sprite = new THREE.Sprite(material);
    scene.add(sprite);
  }

  return {
    draw(renderer, x1, y1, x2, y2, options, canvasWidth, canvasHeight) {
      ensure();
      const { color = [1, 1, 1, 1], thickness = 4, lineType = "glow" } = options ?? {};

      camera.left = 0;
      camera.right = canvasWidth;
      camera.top = 0;
      camera.bottom = canvasHeight;
      camera.updateProjectionMatrix();

      const { midX, midY, length, rotation } = computeLineTransform(x1, y1, x2, y2);
      const { texture, repeatUnitPixels } = styleRegistry.getStyle(lineType);
      // Tiling by real pixel length (not by the sprite's normalized 0..1
      // UV span) keeps a dash/dot's absolute size constant regardless of
      // how long any given tether happens to be.
      texture.repeat.set(1, Math.max(1, length / repeatUnitPixels));

      material.map = texture;
      material.color.setRGB(color[0], color[1], color[2]);
      material.opacity = color[3] ?? 1;
      material.rotation = rotation;
      sprite.position.set(midX, midY, 0);
      sprite.scale.set(thickness, length, 1);

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
    dispose() {
      material?.dispose();
      styleRegistry?.dispose();
    },
  };
}
