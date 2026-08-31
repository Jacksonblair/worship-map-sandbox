// IGlowEffect: { renderToTexture(renderer, scene, camera, width, height):
// THREE.Texture, dispose() }. Produces a texture containing `scene`
// rendered through `camera`, with whatever post-processing this
// implementation applies -- purely a content -> texture transform, with
// NO opinion about where that texture ends up on screen or at what
// real-world position. This decoupling is deliberate and load-bearing:
// a caller can compute this on FIXED, unmoving local content while
// independently animating WHERE the resulting texture is displayed.
//
// That matters concretely for bloom: UnrealBloomPass builds its blur
// through several low-resolution mip levels, and for content as small
// as a single glyph, that's extremely sensitive to exact pixel
// alignment. This file's PREVIOUS version fed it content that moved
// every frame (a bobbing label) -- confirmed live, that flickered,
// because the tiny bright shape landed differently against the mip
// chain's own downsample grid each frame. Decoupling "compute the
// effect" from "where does it appear" removes the motion from what
// bloom ever sees entirely, fixing the flicker at the source rather
// than reducing the motion that triggers it.
//
// Dependency Inversion / Open/Closed / Liskov / Interface Segregation:
// a layer never imports EffectComposer/UnrealBloomPass itself; a
// consumer is handed a FACTORY (createNoGlowEffect or
// createBloomGlowEffect) rather than a single pre-built instance, so it
// can create one independent instance per piece of content it manages
// (see boxedLabelLayer.js -- one per label, since each has different
// content/size and must never share another label's cached buffer);
// every implementation is interchangeable behind the identical
// two-method shape.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// The trivial strategy -- renders into a plain offscreen target, no
// post-processing. Every consumer should default to this, so opting
// into a real effect is always explicit, never a behavior change by
// omission.
export function createNoGlowEffect() {
  let target = null;
  let lastWidth = 0;
  let lastHeight = 0;

  return {
    renderToTexture(renderer, scene, camera, width, height) {
      if (!target || lastWidth !== width || lastHeight !== height) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(width, height);
        lastWidth = width;
        lastHeight = height;
      }
      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      return target.texture;
    },
    dispose() {
      target?.dispose();
      target = null;
    },
    // No-op live tuning, so a caller (e.g. a UI slider) can call these
    // unconditionally without checking which IGlowEffect it has --
    // Liskov Substitution.
    setStrength() {},
    setRadius() {},
    setThreshold() {},
  };
}

// Wraps Three's own EffectComposer/RenderPass/UnrealBloomPass --
// thresholds bright pixels in whatever was ACTUALLY drawn (the real
// glyph shapes) and blurs/spreads them outward, so the glow follows
// their real silhouette uniformly instead of a separate background
// shape hand-sized to roughly match them.
//
// Non-obvious fixes below, each confirmed against Three's actual
// example source or against real live behavior, not assumed:
//
// 1. `composer.renderToScreen = false`. EffectComposer forces
//    `pass.renderToScreen = true` on whichever pass is last, every
//    single render() call. UnrealBloomPass's OWN render(), when
//    renderToScreen is true, does `renderer.setRenderTarget(null);
//    renderer.clear();` -- an unconditional clear of whatever's
//    currently bound. Since this effect always renders into an
//    explicit offscreen target (never the real screen -- see
//    boxedLabelLayer.js for what actually reaches the screen), this
//    also just keeps the whole pipeline correctly offscreen.
// 2. `RenderPass`'s clearAlpha. RenderPass clears its own target using
//    the renderer's ambient clear color/alpha unless told otherwise,
//    which defaults to opaque black -- passing clearAlpha=0 explicitly
//    makes empty areas of the local scene stay transparent instead of
//    opaque black.
// 3. This effect's OWN output texture's alpha channel is NOT
//    trustworthy -- confirmed live in an earlier version of this file
//    where trusting it made an entire map render opaque black.
//    UnrealBloomPass's blend shader is written for opaque full-screen
//    game rendering, where output alpha never mattered; it does not
//    preserve real per-pixel alpha. Callers of renderToTexture on THIS
//    implementation must derive alpha themselves (e.g. from the
//    color's own brightness) rather than trust texture.a -- see
//    boxedLabelLayer.js's compositor, which does exactly that,
//    uniformly for every glow effect (so it works unchanged for
//    createNoGlowEffect's texture too, whose alpha IS trustworthy, at
//    the cost of nothing -- brightness-derived alpha is safe there too
//    since every real color in this sandbox is deliberately saturated).
// 4. The composer's own render target is created with { type:
//    THREE.HalfFloatType }, not the default 8-bit storage. This is what
//    makes DIFFERENTIAL emissiveness possible at all: UnrealBloomPass
//    thresholds on raw pixel brightness, and the standard way to make
//    one object bloom more than everything else sharing the SAME bloom
//    pass is to render it "overbright" -- color channel values pushed
//    above 1.0 -- rather than literally brighter-looking. An 8-bit
//    target clamps anything above 1.0 back down to 1.0 before
//    UnrealBloomPass ever sees it, silently discarding the very signal
//    this technique depends on; half-float storage genuinely preserves
//    values above 1.0 through the pipeline. See boxedLabelLayer.js's
//    marqueeEmissiveIntensity for the actual overbright multiplier.
export function createBloomGlowEffect({ strength = 0.8, radius = 0.3, threshold = 0.25 } = {}) {
  let composer = null;
  let bloomPass = null;
  let lastWidth = 0;
  let lastHeight = 0;
  let currentStrength = strength;
  let currentRadius = radius;
  let currentThreshold = threshold;

  function ensure(renderer, scene, camera, width, height) {
    if (composer && lastWidth === width && lastHeight === height) return;
    composer?.dispose();

    composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }),
    );
    composer.renderToScreen = false; // see fix #1 above
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera, null, null, 0)); // clearAlpha=0, see fix #2 above
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      currentStrength,
      currentRadius,
      currentThreshold,
    );
    composer.addPass(bloomPass);

    lastWidth = width;
    lastHeight = height;
  }

  return {
    renderToTexture(renderer, scene, camera, width, height) {
      ensure(renderer, scene, camera, width, height);
      const previousTarget = renderer.getRenderTarget();
      composer.render();
      renderer.setRenderTarget(previousTarget);
      return composer.readBuffer.texture; // untrustworthy alpha -- see fix #3 above
    },
    // Live-mutable: UnrealBloomPass reads strength/radius/threshold as
    // plain instance properties every render() call (confirmed against
    // its actual source), so updating them here takes effect on the
    // very next frame with no composer rebuild needed -- what makes a
    // live UI slider possible instead of guessing values blind and
    // reloading. Stored locally too, so a value set before the composer
    // exists yet (e.g. before the first frame) still applies once it's
    // built.
    setStrength(value) {
      currentStrength = value;
      if (bloomPass) bloomPass.strength = value;
    },
    setRadius(value) {
      currentRadius = value;
      if (bloomPass) bloomPass.radius = value;
    },
    setThreshold(value) {
      currentThreshold = value;
      if (bloomPass) bloomPass.threshold = value;
    },
    dispose() {
      composer?.dispose();
      composer = null;
      bloomPass = null;
    },
  };
}
