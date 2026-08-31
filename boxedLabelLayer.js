// A place's name wrapped in a real box-drawn border (textBox.js), each
// character rendered as its own billboarded glyph sprite -- border
// characters (┌─┐│└┘) sampled from apps/mobile's dungeon-437 font
// (confirmed to have real box-drawing glyphs at those codepoints, see
// boxLayout.js), everything else from dungeon-mode (the same font
// iconSpriteLayer.js already uses).
//
// Glow: an injected glow-effect FACTORY (glowEffects.js), one
// independent instance PER LABEL, seeded from that label's OWN
// settings.bloomStrength/Radius/Threshold. Each label's glyphs live in
// their own small local THREE.Scene, positioned relative to a fixed
// local origin that depends only on the current zoom (via `cell`) --
// never on the label's real screen position or its bob offset. That
// local scene is what the glow effect actually processes
// (glowEffect.renderToTexture), producing a texture;
// textureQuadCompositor.js then draws THAT texture as a simple quad at
// the label's real, bobbing screen location. Bloom itself never sees
// the motion -- confirmed live that feeding it content that moved every
// frame made the glow visibly flicker (small content is extremely
// sensitive to exact pixel alignment through UnrealBloomPass's
// multi-mip blur), and this decoupling is the actual fix, not a
// smaller/slower bob working around it. See glowEffects.js's header for
// the full reasoning.
//
// Same screen-space camera / DoubleSide / GL-hygiene / negative-Y-repeat
// texture fix as every other Three.js layer in this sandbox -- see
// spriteLayer.js's header comment for the winding-order bug those
// address, and iconSpriteLayer.js's for the upside-down-glyph bug the
// Y-repeat fix addresses.
//
// Marquee lights: a ring of card-suit glyphs (♥♦♣♠, real CP437
// codepoints in the SAME dungeon-mode atlas text uses -- see
// boxLayout.js's decorationCharCode) studded around the box's full
// perimeter, chasing in sequence like bulbs on a casino sign. WHERE
// they sit and WHEN each one is lit both come from marqueeLayout.js's
// two pure functions. Rendered as a SEPARATE overlay sprite per light,
// drawn on top of an otherwise completely plain, unbroken box -- not
// baked into the box's own content string via textBox.js's
// `decorations` (confirmed live that was the wrong tool: a decoration
// REPLACES the character at that cell, so an unlit/dim light left a
// visible gap where the border dash used to be). An overlay sprite,
// positioned at the same cell and given a HIGHER renderOrder so it
// always draws after/on top of the border regardless of scene-graph
// order, keeps the border always fully intact underneath.
//
// Every visual knob here -- border/text color, marquee symbol/color/
// spacing/speed/tail/emissive-intensity, this label's own bloom
// strength/radius/threshold -- is a field on ONE settings object per
// label (labelSettings.js), not scattered constants. That's what makes
// updateLabelSettings() below possible: a caller (main.js's UI panel)
// mutates the shared settings object and tells this layer which key
// changed; this layer decides HOW to apply it (a live material.color
// mutation, a texture UV update, a full marquee-overlay rebuild, or a
// glow-effect call), and every other piece of code -- the settings
// schema, the panel that renders it -- never needs to know which of
// those four apply to which key.

import * as THREE from "three";
import { glyphUVRect } from "./glyphAtlas.js";
import { drawTextBox } from "./textBox.js";
import { classifyBoxRow, decorationCharCode } from "./boxLayout.js";
import { marqueePositions, marqueeBrightness } from "./marqueeLayout.js";
import { hexToRgb01 } from "./labelSettings.js";
import { zoomScaleFor } from "./zoomScale.js";
import { createNoGlowEffect } from "./glowEffects.js";
import { createTextureQuadCompositor } from "./textureQuadCompositor.js";
import { createGlowLineDrawer } from "./glowLineDrawer.js";
import { createNoopLogger } from "./logger.js";
import { repaintOnMapChange } from "./repaintOnMapChange.js";

const CELL_PIXELS = 14;
const HOVER_PIXELS = 100; // clears the icon/orb markers' own hover+halo
const GLYPHS_PER_ROW = 16;
const GLYPH_ROWS = 16;
// Extra margin around each label's own local render target, purely so
// a glow effect that spreads beyond the glyphs' own edges (bloom) has
// room to do that without being clipped at the target's border.
const GLOW_PADDING_PIXELS = 40;
// The local render target's width/height are rounded up to a multiple
// of this, not to a bare pixel -- see the comment at its one use site
// (render()) for why: a target size that changes every single pixel
// during a zoom gesture rebuilds the whole bloom pipeline that often,
// and bloom's own look is resolution-dependent, so that read as the
// glow flickering/jittering in sync with zoom. Kept comfortably smaller
// than GLOW_PADDING_PIXELS so the bucket rounding never eats more than
// a fraction of the padding margin, even at the smallest zoom scale.
const TARGET_SIZE_BUCKET = 8;
// Fully dark between marquee sweeps -- lights are a separate overlay on
// top of an always-intact border, so there's no gap to paper over by
// keeping them faintly visible.
const MARQUEE_MIN_OPACITY_FRACTION = 0;

function cropGlyphTexture(baseTexture, code) {
  const texture = baseTexture.clone();
  texture.needsUpdate = true;
  const rect = glyphUVRect(code);
  applyGlyphUV(texture, rect);
  return texture;
}

// Split out from cropGlyphTexture so updateLabelSettings() can re-point
// an EXISTING cloned texture at a different glyph (a marqueeChar change)
// without cloning/disposing anything.
function applyGlyphUV(texture, rect) {
  // See iconSpriteLayer.js's comment on the identical lines -- negative
  // Y-repeat + vTop-as-offset compensates for this layer's inverted-Y
  // screen-space camera, or every glyph renders upside down.
  texture.repeat.set(1 / GLYPHS_PER_ROW, -1 / GLYPH_ROWS);
  texture.offset.set(rect.u0, rect.vTop);
}

function marqueeThreeColor(settings) {
  const [r, g, b] = hexToRgb01(settings.marqueeColor);
  const intensity = settings.marqueeEmissiveIntensity;
  // Deliberately NOT clamped to [0,1] -- see glowEffects.js's
  // createBloomGlowEffect comment (fix #4) for why an overbright color,
  // preserved end to end by that effect's HalfFloatType render target,
  // is what makes this bloom independently of the border/text.
  return new THREE.Color(r * intensity, g * intensity, b * intensity);
}

// createBoxedLabelLayer(labels, textFontUrl, borderFontUrl,
// createGlowEffect, logger) -- labels: [{ id, lng, lat, name, phase,
// settings }], settings from labelSettings.js's createLabelSettings().
// createGlowEffect: a FACTORY (glowEffects.js's createNoGlowEffect or
// createBloomGlowEffect), called once PER LABEL with that label's own
// { strength, radius, threshold } (from settings.bloomStrength/Radius/
// Threshold) to build its own independent glow-effect instance --
// defaults to the no-op factory, so opting into bloom is explicit at
// the call site (main.js), never a side effect of this layer's own
// code.
export function createBoxedLabelLayer(
  labels,
  textFontUrl,
  borderFontUrl,
  createGlowEffect = createNoGlowEffect,
  logger = createNoopLogger(),
) {
  let renderer;
  let quadCompositor;
  let glowLineDrawer;
  let mapRef = null;
  let contextLost = false;
  let unsubscribeRepaint = null;
  let textBaseTexture = null;
  let borderBaseTexture = null;
  const labelObjects = []; // { id, config, settings, boxWidth, boxHeight, cellSprites, marqueeSprites, localScene, localCamera, glowEffect }

  function buildCellSprites(config, localScene) {
    const settings = config.settings;
    const boxRows = drawTextBox([config.name.toUpperCase()]); // plain -- no decorations; the marquee is a separate overlay, see header comment
    const [r, g, b] = hexToRgb01(settings.color);
    const color = new THREE.Color(r, g, b);

    const cellSprites = [];
    boxRows.forEach((row, rowIndex) => {
      for (const cell of classifyBoxRow(row)) {
        const baseTexture = cell.atlas === "border" ? borderBaseTexture : textBaseTexture;
        const glyphTexture = cropGlyphTexture(baseTexture, cell.code);
        const material = new THREE.SpriteMaterial({
          map: glyphTexture,
          color,
          opacity: 1,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const sprite = new THREE.Sprite(material);
        localScene.add(sprite);
        cellSprites.push({ sprite, material, col: cell.col, row: rowIndex });
      }
    });

    return { cellSprites, boxWidth: boxRows[0].length, boxHeight: boxRows.length };
  }

  function buildMarqueeSprites(config, localScene) {
    const settings = config.settings;
    const marqueeCode = decorationCharCode(settings.marqueeChar) ?? decorationCharCode("♥");
    const color = marqueeThreeColor(settings);
    const positions = marqueePositions(
      config.name.toUpperCase().length,
      1,
      settings.marqueeInterval,
    );

    return positions.map((position, index) => {
      const glyphTexture = cropGlyphTexture(textBaseTexture, marqueeCode);
      const material = new THREE.SpriteMaterial({
        map: glyphTexture,
        color,
        opacity: 0,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 1; // draws after/on top of every cellSprite (renderOrder 0, the default), regardless of scene-graph order
      localScene.add(sprite);
      return { sprite, material, col: position.col, row: position.row, marqueeIndex: index };
    });
  }

  function disposeSprites(sprites, localScene) {
    for (const { sprite, material } of sprites) {
      localScene.remove(sprite);
      material.map?.dispose();
      material.dispose();
    }
  }

  function buildLabelsIfReady() {
    if (!textBaseTexture || !borderBaseTexture) return;

    for (const config of labels) {
      const localScene = new THREE.Scene();
      const localCamera = new THREE.OrthographicCamera(-1, 1, -1, 1, -1, 1); // real bounds set per-frame in render(), from the current zoom scale

      const { cellSprites, boxWidth, boxHeight } = buildCellSprites(config, localScene);
      const marqueeSprites = buildMarqueeSprites(config, localScene);

      const settings = config.settings;
      labelObjects.push({
        id: config.id,
        config,
        settings,
        boxWidth,
        boxHeight,
        cellSprites,
        marqueeSprites,
        localScene,
        localCamera,
        glowEffect: createGlowEffect({
          strength: settings.bloomStrength,
          radius: settings.bloomRadius,
          threshold: settings.bloomThreshold,
        }),
      });
    }
    logger.log("info", "boxedLabelLayer", `built ${labelObjects.length} boxed label(s)`);
  }

  function buildScene(gl) {
    renderer = new THREE.WebGLRenderer({
      canvas: mapRef.getCanvas(),
      context: gl,
      antialias: true,
      alpha: true,
    });
    renderer.autoClear = false;
    quadCompositor = createTextureQuadCompositor();
    glowLineDrawer = createGlowLineDrawer();

    labelObjects.length = 0;
    textBaseTexture = null;
    borderBaseTexture = null;

    function loadAtlas(url, onReady) {
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.generateMipmaps = false;
          onReady(texture);
          buildLabelsIfReady();
        },
        undefined,
        (error) =>
          logger.log(
            "error",
            "boxedLabelLayer",
            `atlas load failed (${url}): ${error?.message ?? error}`,
          ),
      );
    }
    loadAtlas(textFontUrl, (texture) => (textBaseTexture = texture));
    loadAtlas(borderFontUrl, (texture) => (borderBaseTexture = texture));
  }

  return {
    id: "boxed-label-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, gl) {
      logger.log("info", "boxedLabelLayer", "onAdd called");
      mapRef = map;
      contextLost = false;
      buildScene(gl);

      unsubscribeRepaint = repaintOnMapChange(map, () => map.triggerRepaint());

      this._canvas = map.getCanvas();
      this._onContextLost = (e) => {
        e.preventDefault();
        contextLost = true;
        logger.log("warn", "boxedLabelLayer", "WebGL context lost");
      };
      this._onContextRestored = () => {
        contextLost = false;
        logger.log(
          "info",
          "boxedLabelLayer",
          "WebGL context restored, rebuilding Three.js scene and reloading atlases",
        );
        buildScene(gl);
      };
      this._canvas.addEventListener("webglcontextlost", this._onContextLost, false);
      this._canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
    },

    onRemove() {
      logger.log("warn", "boxedLabelLayer", "onRemove called", {
        stack: new Error().stack?.split("\n").slice(0, 4).join(" | "),
      });
      unsubscribeRepaint?.();
      unsubscribeRepaint = null;
      mapRef = null;
      this._canvas?.removeEventListener("webglcontextlost", this._onContextLost);
      this._canvas?.removeEventListener("webglcontextrestored", this._onContextRestored);
      for (const label of labelObjects) {
        disposeSprites(label.cellSprites, label.localScene);
        disposeSprites(label.marqueeSprites, label.localScene);
        label.glowEffect.dispose?.();
      }
      labelObjects.length = 0;
      quadCompositor?.dispose();
      glowLineDrawer?.dispose();
      renderer?.dispose();
    },

    // Applies a single settings-object change to an already-built
    // label, live -- called by main.js's UI panel after it mutates
    // settings[key] in place. Dispatches to whichever mechanism that
    // particular key actually needs:
    //   - bloomStrength/Radius/Threshold: the glow-effect instance's own
    //     live setters (glowEffects.js -- no rebuild, takes effect next
    //     frame).
    //   - color: mutate each cellSprite material's THREE.Color in
    //     place.
    //   - marqueeColor/marqueeEmissiveIntensity: same, for
    //     marqueeSprites (both feed the same overbright-color
    //     computation, so both are handled identically here).
    //   - marqueeChar: re-point each marquee sprite's ALREADY-cloned
    //     texture at a different glyph's UV rect -- no new texture, no
    //     rebuild.
    //   - marqueeInterval: the one change that actually needs a rebuild
    //     (a different light COUNT/positions), scoped to just the
    //     marquee overlay, not the border/text.
    //   - marqueeCycleSeconds/marqueeTailLength: nothing to do here --
    //     render() already reads these fresh from `settings` every
    //     frame.
    updateLabelSettings(labelId, key) {
      const label = labelObjects.find((l) => l.id === labelId);
      if (!label) return;
      const settings = label.settings;

      if (key === "bloomStrength") label.glowEffect.setStrength(settings.bloomStrength);
      else if (key === "bloomRadius") label.glowEffect.setRadius(settings.bloomRadius);
      else if (key === "bloomThreshold") label.glowEffect.setThreshold(settings.bloomThreshold);
      else if (key === "color") {
        const [r, g, b] = hexToRgb01(settings.color);
        for (const { material } of label.cellSprites) material.color.setRGB(r, g, b);
      } else if (key === "marqueeColor" || key === "marqueeEmissiveIntensity") {
        const color = marqueeThreeColor(settings);
        for (const { material } of label.marqueeSprites) material.color.copy(color);
      } else if (key === "marqueeChar") {
        const code = decorationCharCode(settings.marqueeChar) ?? decorationCharCode("♥");
        const rect = glyphUVRect(code);
        for (const { sprite } of label.marqueeSprites) applyGlyphUV(sprite.material.map, rect);
      } else if (key === "marqueeInterval") {
        disposeSprites(label.marqueeSprites, label.localScene);
        label.marqueeSprites = buildMarqueeSprites(label.config, label.localScene);
      }
      // A settings change isn't a "move" event, so repaintOnMapChange's
      // subscription won't pick it up on its own -- this used to work
      // by accident, via the old unconditional-every-frame rAF loop
      // picking it up on whichever frame came next.
      mapRef?.triggerRepaint();
    },

    render(gl) {
      if (contextLost || !mapRef || labelObjects.length === 0) return;
      try {
        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

        const canvas = mapRef.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(width, height, false);

        const time = performance.now() / 1000;
        const scale = zoomScaleFor(mapRef.getZoom());
        // Deliberately fractional/smooth, NOT rounded -- an earlier
        // version rounded this to a whole pixel to fix a real
        // character-spacing gap bug, but that gap bug was actually
        // caused by rounding each glyph's POSITION independently (see
        // below) while cell itself was fractional, not by cell being
        // fractional per se. Un-rounded positions computed from the
        // SAME continuous cell are mathematically exact -- col2's left
        // edge equals col1's right edge with no rounding error to drift
        // -- so leaving cell smooth here and simply never rounding
        // individual positions fixes the gaps AND keeps font size
        // scaling continuously with zoom, instead of snapping between
        // whole-pixel sizes.
        const cell = CELL_PIXELS * scale;

        // See spriteLayer.js's render() for why colorMask/scissor/
        // stencil are reset and resetState() is called both before AND
        // after this frame's rendering. Once per frame is enough --
        // this isn't about MapLibre's state changing again mid-frame,
        // just going into our first render call of it.
        gl.colorMask(true, true, true, true);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        renderer.resetState();

        for (const {
          settings,
          boxWidth,
          boxHeight,
          cellSprites,
          marqueeSprites,
          localScene,
          localCamera,
          glowEffect,
          config,
        } of labelObjects) {
          // Positioned relative to a fixed local origin -- depends only
          // on `cell` (zoom), never on this label's real screen
          // position or its bob offset. NOT rounded: the flicker this
          // sandbox hit earlier came from feeding bloom content that
          // moved every frame (the bob) -- this local scene never sees
          // that motion at all now (that's the whole point of the
          // local-scene restructure, see this file's header comment),
          // so there's nothing left for position-rounding to protect
          // against, only font-size smoothness for it to cost.
          const positionCell = (sprite, col, row) => {
            const localX = (col + 0.5 - boxWidth / 2) * cell;
            const localY = (row - (boxHeight - 1) / 2) * cell;
            sprite.position.set(localX, localY, 0);
            sprite.scale.set(cell, cell, 1);
          };

          for (const { sprite, col, row } of cellSprites) positionCell(sprite, col, row);

          // The marquee lights' OPACITY animates continuously every
          // frame, but that's a fundamentally different thing from the
          // bob-driven flicker fixed earlier: their POSITIONS never
          // move (fixed relative to this same local origin, same as
          // every cellSprite above), so there's no pixel-alignment
          // sensitivity for a multi-mip blur to react to -- only a
          // stable pixel's intensity is changing, which bloom is
          // supposed to react to (that reaction, glow flashing in sync
          // with the chase, is the actual point). cycleSeconds/
          // tailLength are read fresh from `settings` here, not a
          // separately-stored copy -- that's what makes those two
          // sliders live with no extra plumbing.
          for (const { sprite, material, col, row, marqueeIndex } of marqueeSprites) {
            positionCell(sprite, col, row);
            const brightness = marqueeBrightness(marqueeIndex, marqueeSprites.length, time, {
              cycleSeconds: settings.marqueeCycleSeconds,
              tailLength: settings.marqueeTailLength,
            });
            material.opacity =
              MARQUEE_MIN_OPACITY_FRACTION + (1 - MARQUEE_MIN_OPACITY_FRACTION) * brightness;
          }

          // Rounded UP to the nearest TARGET_SIZE_BUCKET -- a WebGL
          // render target's dimensions have to be whole numbers
          // regardless (the content within it doesn't -- see the
          // un-rounded positions above), and bucketing rather than
          // rounding to a bare pixel means the target only actually
          // resizes every ~TARGET_SIZE_BUCKET px of zoom instead of on
          // nearly every frame of a zoom gesture. That matters because
          // glowEffect treats ANY (width,height) change as "rebuild the
          // whole bloom pipeline at this new resolution" (see
          // glowEffects.js's ensure()), and UnrealBloomPass's multi-mip
          // blur genuinely looks different at different resolutions --
          // rebuilding on every pixel of size change was making the
          // glow's own character visibly shift in sync with zoom. The
          // padding margin absorbs the gap between actual content size
          // and the bucketed target size.
          const padding = GLOW_PADDING_PIXELS * scale;
          const localWidth =
            Math.ceil((boxWidth * cell + padding * 2) / TARGET_SIZE_BUCKET) * TARGET_SIZE_BUCKET;
          const localHeight =
            Math.ceil((boxHeight * cell + padding * 2) / TARGET_SIZE_BUCKET) * TARGET_SIZE_BUCKET;
          localCamera.left = -localWidth / 2;
          localCamera.right = localWidth / 2;
          localCamera.top = -localHeight / 2;
          localCamera.bottom = localHeight / 2;
          localCamera.updateProjectionMatrix();

          const texture = glowEffect.renderToTexture(
            renderer,
            localScene,
            localCamera,
            localWidth,
            localHeight,
          );

          // Only HERE does the bob/real screen position ever apply --
          // to where the already-rendered texture gets drawn, not to
          // anything the glow effect itself computed. Left un-rounded
          // deliberately -- this is a single plain textured-quad draw,
          // not a multi-mip blur, so it has none of bloom's alignment
          // sensitivity; rounding it would only make the bob motion
          // itself look steppier for no benefit.
          const screen = mapRef.project([config.lng, config.lat]);
          const bob = Math.sin(time * 2 + (config.phase ?? 0)) * 6 * scale;
          const centerX = screen.x;
          const centerY = screen.y - HOVER_PIXELS * scale - bob;

          // A glowing tether from the box's own bottom edge (NOT the
          // padded local render target's edge -- boxHeight*cell is the
          // real content height) down to the actual ground point
          // (screen.x/y, the raw projection with no hover/bob applied).
          // Drawn BEFORE the box's own quad so the box sits crisply on
          // top of it, and via glowLineDrawer -- a plain additive glow,
          // deliberately NOT bloom-processed, since this line's own
          // endpoints move every frame (see glowLineDrawer.js's header
          // for why that specifically rules out routing it through the
          // same bloom pipeline the box itself uses).
          if (settings.tetherOpacity > 0) {
            const [r, g, b] = hexToRgb01(settings.color);
            const boxBottomY = centerY + (boxHeight * cell) / 2;
            glowLineDrawer.draw(
              renderer,
              centerX,
              boxBottomY,
              screen.x,
              screen.y,
              {
                color: [r, g, b, settings.tetherOpacity],
                thickness: settings.tetherThickness * scale,
                lineType: settings.tetherLineType,
              },
              width,
              height,
            );
          }

          quadCompositor.draw(
            renderer,
            texture,
            centerX,
            centerY,
            localWidth,
            localHeight,
            width,
            height,
          );
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        renderer.resetState();

        const glError = gl.getError();
        if (glError !== gl.NO_ERROR) {
          logger.log("error", "boxedLabelLayer", `gl.getError() after render(): ${glError}`);
        }
      } catch (error) {
        logger.log("error", "boxedLabelLayer", `render() failed: ${error.message}`);
      }
    },
  };
}
