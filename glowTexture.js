// A single, shared, browser-only radial-gradient CanvasTexture (white
// center fading to transparent) reused as-is by both spriteLayer.js's
// orbs and iconSpriteLayer.js's icon halos -- tinted per-sprite via
// THREE.SpriteMaterial's own `color`, so one texture serves every
// color/sprite/layer. This is the direct Three.js replacement for what
// used to be a hand-written GLSL radial-falloff fragment shader; no
// shader source lives in this codebase anymore for either effect.
//
// Module-level singleton, not per-call -- safe to share a read-only
// texture across many SpriteMaterials/layers at once (the standard
// Three.js pattern, same as sharing one geometry across many meshes),
// and there's no per-layer teardown here to worry about since neither
// consumer disposes it in onRemove (see their own comments for why).

import * as THREE from "three";

const SIZE = 128;

let cached = null;

export function createGlowTexture() {
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);
  cached = new THREE.CanvasTexture(canvas);
  return cached;
}
