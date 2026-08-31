// WHAT a tether line looks like, as a registry of named styles --
// separate from glowLineDrawer.js, which owns HOW a line is positioned/
// oriented (shared by every style). Each style is a canvas-drawn
// pattern that TILES along the line's LENGTH (a dash/dot's absolute
// pixel size stays constant regardless of how long any given line
// actually is), masked by a soft glow gradient across the line's WIDTH
// so every style still reads as "glowing," not just "shaped."
//
// Adding a new line type is one entry in LINE_STYLE_BUILDERS plus
// lineTypes.js's LINE_TYPES list -- nothing in glowLineDrawer.js or the
// consumer (boxedLabelLayer.js) changes (Open/Closed). labelSettings.js
// also reads LINE_TYPES for its tetherLineType select field, so the
// settings panel's dropdown can never list a type this file doesn't
// implement (or vice versa).

import * as THREE from "three";
import { LINE_TYPES } from "./lineTypes.js";

const TEXTURE_SIZE = 64;

function buildLineTexture(drawMask, repeatUnitPixels) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");

  // Soft glow gradient across the line's WIDTH (the sprite's U axis).
  const gradient = ctx.createLinearGradient(0, 0, TEXTURE_SIZE, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Mask by this style's own along-length pattern (the sprite's V axis)
  // -- "destination-in" keeps only the gradient pixels that fall inside
  // the pattern's own shape, so a dash/dot still glows rather than
  // being a flat, ungradiented cutout.
  ctx.globalCompositeOperation = "destination-in";
  drawMask(ctx, TEXTURE_SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping; // across width -- never tiles
  texture.wrapT = THREE.RepeatWrapping; // along length -- tiles, so pattern size stays constant in real pixels regardless of line length
  return { texture, repeatUnitPixels };
}

const LINE_STYLE_BUILDERS = {
  glow: () =>
    buildLineTexture((ctx, size) => {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, size, size);
    }, 40),
  dashed: () =>
    buildLineTexture((ctx, size) => {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, size, size * 0.6);
    }, 26),
  dotted: () =>
    buildLineTexture((ctx, size) => {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }, 16),
};

// createLineStyleRegistry() -- lazily builds/caches one texture per
// requested type, shared across every draw() call regardless of which
// label asked for it (a texture is read-only per draw, so sharing is
// safe -- see glowLineDrawer.js). getStyle(type) falls back to "glow"
// for an unrecognized type instead of throwing, so a stale settings
// object naming a type that no longer exists can't break rendering.
export function createLineStyleRegistry() {
  const cache = new Map();
  return {
    getStyle(type) {
      const key = LINE_TYPES.includes(type) ? type : "glow";
      if (!cache.has(key)) cache.set(key, LINE_STYLE_BUILDERS[key]());
      return cache.get(key);
    },
    dispose() {
      for (const { texture } of cache.values()) texture.dispose();
      cache.clear();
    },
  };
}
