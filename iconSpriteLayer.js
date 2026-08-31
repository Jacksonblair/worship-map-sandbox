// Same screen-space billboard/bob/zoom-scale mechanic as spriteLayer.js
// (see that file's header comment for why screen-space + Three.js
// instead of MapLibre's mercator matrix, and for the winding-order/
// back-face-culling bug that camera convention causes -- every material
// below sets side: THREE.DoubleSide for the same reason), but the icon
// itself samples a glyph out of apps/mobile's dungeonmode font instead
// of drawing a flat orb, and each icon gets its own pulsing additive-
// blended glow behind it using the same shared glow texture
// spriteLayer.js's orbs use.
//
// Glyph sheet layout / UV math (glyphAtlas.js's glyphUVRect) is
// unchanged from the raw-WebGL version -- it was already pure codepoint
// math with zero GL dependency. What DOES change: a loaded
// THREE.Texture's own `.offset`/`.repeat` crop the shared atlas image
// to one glyph cell per sprite (via `.clone()`, each clone pointing at
// the same underlying image but its own crop rect) instead of a
// hand-written UV-remapping vertex shader -- and the precision-mismatch
// bug that broke the old GLSL halo can't recur at all, since there's no
// hand-written shader source left in this file to mismatch.
//
// Each icon also gets a glowing ground tether, via the exact same
// glowLineDrawer.js reused as-is from boxedLabelLayer.js -- one shared
// drawer instance, called once per icon per frame from the real ground
// point (mapRef.project's raw result) up to the icon's own bobbed
// screen position. Deliberately NOT configurable per-icon the way each
// boxed label's tether is (that panel is already dense for 3 labels;
// this sandbox now has 10 plain icons, so fixed constants below instead
// of 10 more settings blocks) -- each icon's own color still carries
// through, so tethers read as "this icon's own glow", not one flat color.

import * as THREE from "three";
import { createGlowTexture } from "./glowTexture.js";
import { glyphUVRect } from "./glyphAtlas.js";
import { zoomScaleFor } from "./zoomScale.js";
import { createGlowLineDrawer } from "./glowLineDrawer.js";
import { createNoopLogger } from "./logger.js";

const RADIUS_PIXELS = 16;
const HOVER_PIXELS = 34;
const HALO_RADIUS_MULTIPLIER = 2.4;
const GLYPHS_PER_ROW = 16;
const GLYPH_ROWS = 16;
const TETHER_THICKNESS_PIXELS = 4;
const TETHER_OPACITY = 0.7;

// createIconSpriteLayer(sprites, textureUrl, logger) -- sprites:
// [{ id, lng, lat, color: [r,g,b,a], code, phase }]. `code` is a
// dungeon-mode glyph codepoint (0-255); textureUrl points at the mask
// PNG. Same DI shape as the raw-WebGL version.
export function createIconSpriteLayer(sprites, textureUrl, logger = createNoopLogger()) {
  let renderer, scene, camera, glowLineDrawer;
  let mapRef = null;
  let contextLost = false;
  let rafHandle = null;
  let textureReady = false;
  const objects = []; // { config, iconSprite, iconMaterial, haloSprite, haloMaterial }

  function buildScene(gl) {
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
    renderer = new THREE.WebGLRenderer({
      canvas: mapRef.getCanvas(),
      context: gl,
      antialias: true,
      alpha: true,
    });
    renderer.autoClear = false;
    glowLineDrawer = createGlowLineDrawer();

    objects.length = 0;
    textureReady = false;

    const glowTexture = createGlowTexture();
    const loader = new THREE.TextureLoader();
    loader.load(
      textureUrl,
      (baseTexture) => {
        baseTexture.magFilter = THREE.NearestFilter; // crisp pixel-art glyphs, not blurred
        baseTexture.minFilter = THREE.NearestFilter;
        baseTexture.wrapS = THREE.ClampToEdgeWrapping; // don't bleed into neighboring atlas cells at the crop rect's edge
        baseTexture.wrapT = THREE.ClampToEdgeWrapping;
        baseTexture.generateMipmaps = false;

        for (const config of sprites) {
          // .clone() copies magFilter/minFilter/wrapS/wrapT from
          // baseTexture already set above; only offset/repeat differ
          // per sprite, cropping this clone to exactly one glyph cell.
          const glyphTexture = baseTexture.clone();
          glyphTexture.needsUpdate = true;
          const rect = glyphUVRect(config.code);
          // Negative Y-repeat + vTop-as-offset (instead of the "obvious"
          // vBottom + positive repeat) compensates for this layer's
          // screen-space camera using an inverted top/bottom convention
          // (see render()'s comment) -- a sprite's local Y ends up
          // rendering toward the OPPOSITE screen direction than Three
          // normally assumes, so the V sampling direction has to flip
          // too, or every glyph renders upside down. Confirmed as a
          // real bug via a "backwards" text report: rotationally
          // symmetric icon shapes (e.g. the cross) hid it completely,
          // letters couldn't.
          glyphTexture.repeat.set(1 / GLYPHS_PER_ROW, -1 / GLYPH_ROWS);
          glyphTexture.offset.set(rect.u0, rect.vTop);

          const color = new THREE.Color(config.color[0], config.color[1], config.color[2]);

          const haloMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            opacity: (config.color[3] ?? 1) * 0.9,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending, // brightens what's behind it rather than covering it -- what actually reads as "glowing" against a dark basemap
            side: THREE.DoubleSide, // see header comment -- the mirrored screen-space camera flips winding, which would otherwise back-face-cull every sprite
          });
          const haloSprite = new THREE.Sprite(haloMaterial);
          scene.add(haloSprite);

          const iconMaterial = new THREE.SpriteMaterial({
            map: glyphTexture,
            color,
            opacity: config.color[3] ?? 1,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const iconSprite = new THREE.Sprite(iconMaterial);
          scene.add(iconSprite);

          objects.push({ config, iconSprite, iconMaterial, haloSprite, haloMaterial });
        }
        textureReady = true;
        logger.log("info", "iconSpriteLayer", `glyph texture loaded: ${textureUrl}`);
      },
      undefined,
      (error) =>
        logger.log("error", "iconSpriteLayer", `texture load failed: ${error?.message ?? error}`),
    );
  }

  return {
    id: "icon-sprite-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, gl) {
      logger.log("info", "iconSpriteLayer", "onAdd called");
      mapRef = map;
      contextLost = false;
      buildScene(gl);

      const loop = () => {
        map.triggerRepaint();
        rafHandle = requestAnimationFrame(loop);
      };
      rafHandle = requestAnimationFrame(loop);

      this._canvas = map.getCanvas();
      this._onContextLost = (e) => {
        e.preventDefault();
        contextLost = true;
        logger.log("warn", "iconSpriteLayer", "WebGL context lost");
      };
      this._onContextRestored = () => {
        contextLost = false;
        logger.log(
          "info",
          "iconSpriteLayer",
          "WebGL context restored, rebuilding Three.js scene and reloading texture",
        );
        buildScene(gl);
      };
      this._canvas.addEventListener("webglcontextlost", this._onContextLost, false);
      this._canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
    },

    onRemove() {
      // Kept permanently, not just for debugging -- low frequency (once
      // per add/remove, not per-frame) and directly useful if a layer
      // ever gets removed unexpectedly again: the stack's 2nd line is
      // whoever called it.
      logger.log("warn", "iconSpriteLayer", "onRemove called", {
        stack: new Error().stack?.split("\n").slice(0, 4).join(" | "),
      });
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      rafHandle = null;
      mapRef = null;
      this._canvas?.removeEventListener("webglcontextlost", this._onContextLost);
      this._canvas?.removeEventListener("webglcontextrestored", this._onContextRestored);
      for (const obj of objects) {
        obj.iconMaterial.map?.dispose(); // the per-glyph cloned crop texture -- NOT the shared glow texture (never disposed here, see glowTexture.js) and NOT the shared base atlas image
        obj.iconMaterial.dispose();
        obj.haloMaterial.dispose();
      }
      objects.length = 0;
      glowLineDrawer?.dispose();
      renderer?.dispose();
    },

    // `gl` (from MapLibre's render(gl, matrix) call) is needed for the
    // framebuffer/GL-state handling below; `matrix` stays unused, see
    // spriteLayer.js.
    render(gl) {
      if (contextLost || !textureReady || !mapRef) return;
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
        camera.left = 0;
        camera.right = width;
        camera.top = 0;
        camera.bottom = height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(width, height, false);

        const time = performance.now() / 1000;
        const scale = zoomScaleFor(mapRef.getZoom());
        for (const { config, iconSprite, haloSprite } of objects) {
          const screen = mapRef.project([config.lng, config.lat]);
          const bob = Math.sin(time * 2 + (config.phase ?? 0)) * 6 * scale;
          const x = screen.x;
          const y = screen.y - HOVER_PIXELS * scale - bob;

          // Drawn as its own immediate render() call, BEFORE the shared
          // icon/halo scene renders once below -- see this file's header
          // for why this reuses glowLineDrawer.js as-is rather than
          // going through the batched `scene`.
          glowLineDrawer.draw(
            renderer,
            x,
            y,
            screen.x,
            screen.y,
            {
              color: [config.color[0], config.color[1], config.color[2], TETHER_OPACITY],
              thickness: TETHER_THICKNESS_PIXELS * scale,
            },
            width,
            height,
          );

          const iconDiameter = RADIUS_PIXELS * 2 * scale;
          iconSprite.position.set(x, y, 0);
          iconSprite.scale.set(iconDiameter, iconDiameter, 1);

          const haloDiameter = iconDiameter * HALO_RADIUS_MULTIPLIER;
          const pulse = 0.65 + 0.35 * Math.sin(time * 3 + (config.phase ?? 0) * 1.7);
          haloSprite.position.set(x, y, 0);
          haloSprite.scale.set(haloDiameter, haloDiameter, 1);
          haloSprite.material.opacity = (config.color[3] ?? 1) * 0.9 * pulse;
        }

        // See spriteLayer.js's render() for why colorMask/scissor/
        // stencil are reset and resetState() is called both before AND
        // after render().
        gl.colorMask(true, true, true, true);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        renderer.resetState();
        renderer.render(scene, camera);
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        renderer.resetState();

        const glError = gl.getError();
        if (glError !== gl.NO_ERROR) {
          logger.log("error", "iconSpriteLayer", `gl.getError() after render(): ${glError}`);
        }
      } catch (error) {
        logger.log("error", "iconSpriteLayer", `render() failed: ${error.message}`);
      }
    },
  };
}
