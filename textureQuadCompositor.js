// Draws a texture as a positioned/sized quad directly onto the real
// screen -- the one place a glow-effect's offscreen output (see
// glowEffects.js) actually reaches the shared MapLibre canvas. Alpha is
// derived from the texture's own color brightness (max(r,g,b)) rather
// than trusted from its alpha channel -- correct uniformly for both a
// plain render (where a glyph's real footprint IS its bright pixels)
// and a bloomed render (whose alpha channel is not usable at all, see
// glowEffects.js's createBloomGlowEffect). Never calls clear() --
// composites over whatever MapLibre (or an earlier draw() this frame)
// already put on the shared framebuffer.

import * as THREE from "three";

export function createTextureQuadCompositor() {
  let scene, camera, material, mesh;

  function ensure() {
    if (scene) return;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1); // left/right/top/bottom set for real each draw(), from the real canvas size
    material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          // 1.0 - vUv.y, not vUv.y: this quad is drawn through the same
          // inverted-Y screen-space camera every layer in this sandbox
          // uses (see spriteLayer.js's header), so its local +Y (top of
          // the plane, PlaneGeometry's own uv.y=1) renders toward the
          // BOTTOM of the real screen, not the top. The source texture
          // was rendered normally (top content at framebuffer-top,
          // texture v=1), so sampling vUv.y directly showed the label's
          // top border at the screen's bottom and vice versa -- the
          // whole label upside down. Flipping the sampled V compensates
          // for exactly that mismatch.
          vec4 texel = texture2D(map, vec2(vUv.x, 1.0 - vUv.y));
          float alpha = max(texel.r, max(texel.g, texel.b));
          gl_FragColor = vec4(texel.rgb, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // this quad is drawn through the same inverted-Y screen-space camera convention as every other sprite in this sandbox -- see spriteLayer.js's header comment for why that flips winding
    });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(mesh);
  }

  return {
    // draw(renderer, texture, centerX, centerY, width, height, canvasWidth, canvasHeight)
    // -- centerX/centerY/width/height are all in the same screen-space
    // CSS-pixel units every other layer in this sandbox already uses.
    draw(renderer, texture, centerX, centerY, width, height, canvasWidth, canvasHeight) {
      ensure();
      camera.left = 0;
      camera.right = canvasWidth;
      camera.top = 0;
      camera.bottom = canvasHeight;
      camera.updateProjectionMatrix();

      material.uniforms.map.value = texture;
      mesh.position.set(centerX, centerY, 0);
      mesh.scale.set(width, height, 1);

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
    dispose() {
      material?.dispose();
      mesh?.geometry.dispose();
    },
  };
}
