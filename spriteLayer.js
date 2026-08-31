// Billboarded "orb" sprites that hover above a fixed lng/lat and bob in
// place -- rendered via Three.js instead of hand-written WebGL/GLSL.
// The raw-WebGL version this replaced hit two real bugs in a row (a
// stale zoom-preset visibility bug, then a cross-stage shader-precision
// link failure) -- exactly the class of bookkeeping a real rendering
// library takes off our hands, which is the whole reason for this swap.
//
// Rendered in its own screen-space (CSS-pixel) orthographic scene, NOT
// through MapLibre's mercator projection matrix. Each frame,
// map.project(lngLat) gives the sprite's current screen position
// directly, and it's positioned/scaled in plain pixel units from there
// -- no clip-space-offset math, no mercator-to-pixel conversion. This
// sidesteps the fiddlier "share a mercator-space camera with MapLibre's
// own matrix" integration (the standard approach for e.g. real 3D
// models on a map) entirely. Tradeoff: no true pitch/tilt support --
// but this sandbox has no pitch/bearing controls at all, so that's not
// a real loss today; if that ever changes, this is the file that needs
// the mercator-camera version instead.
//
// zoomScaleFor (zoomScale.js) is UNCHANGED from the raw-WebGL version --
// it was already pure pixel/zoom math with zero GL dependency, so this
// entire rendering-backend swap needed no changes to it or its tests.
// That split (pure logic vs. GL glue) is exactly what made this swap
// low-risk instead of a full rewrite.
//
// This screen-space camera uses top=0,bottom=height (inverted from
// Three's normal top>bottom convention) so its Y axis matches screen/
// CSS-pixel convention directly -- but that produces a NEGATIVE Y-scale
// in the projection matrix, which mirrors the scene and flips every
// triangle's winding order as Three sees it. Three's default
// side:FrontSide culls based on winding, so it was silently discarding
// every sprite's rasterized fragments after a real, correctly-issued
// draw call (confirmed via renderer.info showing the exact expected
// call/triangle counts every frame despite nothing ever being visible,
// with zero GL errors) -- a real, confirmed bug, not a hypothetical.
// Every material below sets side: THREE.DoubleSide to fix it, which is
// also just the semantically correct choice for a flat screen-space
// overlay, where "which side faces the camera" was never meaningful.

import * as THREE from "three";
import { createGlowTexture } from "./glowTexture.js";
import { zoomScaleFor } from "./zoomScale.js";
import { createNoopLogger } from "./logger.js";
import { repaintOnMapChange } from "./repaintOnMapChange.js";

const RADIUS_PIXELS = 14;
const HOVER_PIXELS = 34;

// createSpriteLayer(sprites, logger) -- sprites: [{ id, lng, lat, color:
// [r,g,b,a], phase }]. Same DI shape (plain data in, logger injected)
// as the raw-WebGL version.
export function createSpriteLayer(sprites, logger = createNoopLogger()) {
  let renderer, scene, camera;
  let mapRef = null;
  let contextLost = false;
  let unsubscribeRepaint = null;
  const spriteObjects = []; // { config, sprite, material }

  function buildScene(gl) {
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1); // left/right/top/bottom set for real each render(), from the canvas's current CSS size
    renderer = new THREE.WebGLRenderer({
      canvas: mapRef.getCanvas(),
      context: gl,
      antialias: true,
      alpha: true,
    });
    renderer.autoClear = false; // MUST NOT clear -- MapLibre's own base map is already drawn into this same context/canvas by the time this layer renders

    const glowTexture = createGlowTexture();
    spriteObjects.length = 0;
    for (const config of sprites) {
      const material = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(config.color[0], config.color[1], config.color[2]),
        opacity: config.color[3] ?? 1,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide, // see header comment -- the mirrored screen-space camera flips winding, which would otherwise back-face-cull every sprite
      });
      const sprite = new THREE.Sprite(material);
      scene.add(sprite);
      spriteObjects.push({ config, sprite, material });
    }
  }

  return {
    id: "sprite-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, gl) {
      logger.log("info", "spriteLayer", "onAdd called");
      mapRef = map;
      contextLost = false;
      buildScene(gl);

      // One repaint per real map-state change, not an unconditional
      // every-frame loop -- scoped to exactly this layer's lifetime,
      // unsubscribed in onRemove.
      unsubscribeRepaint = repaintOnMapChange(map, () => map.triggerRepaint());

      this._canvas = map.getCanvas();
      this._onContextLost = (e) => {
        e.preventDefault();
        contextLost = true;
        logger.log("warn", "spriteLayer", "WebGL context lost");
      };
      this._onContextRestored = () => {
        contextLost = false;
        logger.log("info", "spriteLayer", "WebGL context restored, rebuilding Three.js scene");
        buildScene(gl); // the underlying WebGLRenderingContext object itself survives a lost/restored cycle -- only its GPU-side resources are invalidated, so reusing the same `gl` reference to rebuild is correct
      };
      this._canvas.addEventListener("webglcontextlost", this._onContextLost, false);
      this._canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
    },

    onRemove() {
      // Kept permanently, not just for debugging -- low frequency (once
      // per add/remove, not per-frame) and directly useful if a layer
      // ever gets removed unexpectedly again: the stack's 2nd line is
      // whoever called it.
      logger.log("warn", "spriteLayer", "onRemove called", {
        stack: new Error().stack?.split("\n").slice(0, 4).join(" | "),
      });
      unsubscribeRepaint?.();
      unsubscribeRepaint = null;
      mapRef = null;
      this._canvas?.removeEventListener("webglcontextlost", this._onContextLost);
      this._canvas?.removeEventListener("webglcontextrestored", this._onContextRestored);
      for (const { material } of spriteObjects) material.dispose(); // does not cascade-dispose the shared glow texture
      spriteObjects.length = 0;
      renderer?.dispose();
    },

    // MapLibre calls render(gl, matrix) -- `matrix` is unused (see
    // header comment), but `gl` is needed for the framebuffer/GL-state
    // handling below.
    render(gl) {
      if (contextLost || !mapRef) return;
      try {
        // Three's WebGLRenderer force-binds the canvas's own default
        // framebuffer for every render() call rather than rendering into
        // whatever was already bound -- captured and restored below so
        // whatever MapLibre does next in this same frame sees the target
        // it actually expects.
        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

        const canvas = mapRef.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        // top=0, bottom=height (inverted from the usual math convention)
        // makes this camera's Y axis match screen/CSS-pixel convention
        // directly (0 at top, increasing downward) -- exactly what
        // map.project() already returns, so no manual flip needed below.
        // (See header comment for the winding-order consequence of this.)
        camera.left = 0;
        camera.right = width;
        camera.top = 0;
        camera.bottom = height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(width, height, false); // false: don't let Three touch the canvas's own size/style, MapLibre already owns that

        const time = performance.now() / 1000;
        const scale = zoomScaleFor(mapRef.getZoom());
        for (const { config, sprite } of spriteObjects) {
          const screen = mapRef.project([config.lng, config.lat]);
          const bob = Math.sin(time * 2 + (config.phase ?? 0)) * 6 * scale;
          sprite.position.set(screen.x, screen.y - HOVER_PIXELS * scale - bob, 0);
          const diameter = RADIUS_PIXELS * 2 * scale;
          sprite.scale.set(diameter, diameter, 1);
        }

        // MapLibre uses colorMask/scissor/stencil internally (e.g. for
        // fill/line antialiasing masks) and its CustomLayerInterface
        // contract expects a custom layer to reset whatever raw GL state
        // it needs, not just what Three itself manages -- resetState()
        // only resets things THREE tracks (blend/program/buffer
        // bindings), not these. Called both before AND after render()
        // since MapLibre's own draws mutate this same shared context in
        // between our frames -- resetting only after leaves the cache
        // stale for exactly the window that matters, going into the
        // NEXT render() call.
        gl.colorMask(true, true, true, true);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        renderer.resetState();
        renderer.render(scene, camera);
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        renderer.resetState();

        const glError = gl.getError();
        if (glError !== gl.NO_ERROR) {
          logger.log("error", "spriteLayer", `gl.getError() after render(): ${glError}`);
        }
      } catch (error) {
        logger.log("error", "spriteLayer", `render() failed: ${error.message}`);
      }
    },
  };
}
