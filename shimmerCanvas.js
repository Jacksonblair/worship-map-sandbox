// Independent water-shimmer canvas ------------------------------------
// Deliberately its own <canvas>, own WebGL context, own rAF loop -- NOT
// a MapLibre CustomLayerInterface. A CustomLayerInterface effect can
// only animate by calling map.triggerRepaint(), which forces MapLibre's
// *entire* scene to redraw every frame (confirmed against real
// maplibre-gl-js issues, e.g. #7629/#7591 -- one dev's shader dropped
// from 60fps/4% CPU standalone to 15fps/40% CPU once it needed
// per-frame triggerRepaint). This canvas sits on top of the map as a
// transparent overlay and redraws itself independently, so the
// shimmer's cost is just its own tiny draw call -- MapLibre's own
// render loop never wakes up for it.

import { mercXY, ringsFromGeometry, polygonToTriangles } from "./geometry.js";
import { queryCategoryFeatures } from "./mapFeatureSource.js";
import { showPageError } from "./debugPanel.js";

const VERTEX_SRC = `
  attribute vec2 aPosition;
  uniform vec2 uResolution;
  uniform vec2 uOrigin;
  uniform float uScale;
  void main() {
    vec2 screenPx = uOrigin + aPosition * uScale;
    vec2 clip = (screenPx / uResolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;
const FRAGMENT_SRC = `
  precision mediump float;
  uniform float uTime;
  void main() {
    float wave = sin(gl_FragCoord.x * 0.05 + uTime * 1.5) * 0.5 + 0.5;
    wave *= sin(gl_FragCoord.y * 0.07 - uTime * 1.1) * 0.5 + 0.5;
    gl_FragColor = vec4(1.0, 1.0, 1.0, wave * 0.18);
  }
`;

export function createShimmerCanvas(map) {
  const canvas = document.getElementById("shimmer");
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
  if (!gl) {
    showPageError("Shimmer canvas: WebGL context creation failed.");
    return { setActive() {} };
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);
  resize();

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shimmer shader compile failed: ${info}`);
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERTEX_SRC));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shimmer program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const aPosition = gl.getAttribLocation(program, "aPosition");
  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uOrigin = gl.getUniformLocation(program, "uOrigin");
  const uScale = gl.getUniformLocation(program, "uScale");
  const uTime = gl.getUniformLocation(program, "uTime");
  const positionBuffer = gl.createBuffer();

  // Geometry is stored as small Mercator-space deltas relative to a
  // fixed origin captured at extraction time -- not raw absolute
  // Mercator coordinates. Web Mercator's screen mapping is a uniform
  // scale+translate (no rotation/pitch in this app), but the absolute
  // scale factor (512 * 2^zoom) is large enough that GPU float32 math
  // on raw absolute positions loses sub-pixel precision. Deltas from a
  // nearby origin stay tiny, so precision is fine; uOrigin/uScale below
  // are recomputed every frame from a single map.project() + getZoom()
  // call to re-anchor those deltas to the current pan/zoom.
  const scene = { originLngLat: null, vertexCount: 0 };

  function extract() {
    const originLngLat = map.getCenter();
    const originMerc = mercXY(originLngLat);
    const positions = [];
    for (const feature of queryCategoryFeatures(map, "water")) {
      for (const rings of ringsFromGeometry(feature.geometry)) {
        const tri = polygonToTriangles(rings);
        for (let i = 0; i < tri.length; i += 2) {
          positions.push(tri[i] - originMerc.x, tri[i + 1] - originMerc.y);
        }
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    scene.originLngLat = originLngLat;
    scene.vertexCount = positions.length / 2;
  }

  let active = false;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!active || scene.vertexCount === 0 || !scene.originLngLat) return;

    const originScreenPx = map.project(scene.originLngLat);
    const worldPxPerMercUnit = 512 * Math.pow(2, map.getZoom());

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform2f(uOrigin, originScreenPx.x * dpr, originScreenPx.y * dpr);
    gl.uniform1f(uScale, worldPxPerMercUnit * dpr);
    gl.uniform1f(uTime, performance.now() / 1000);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, scene.vertexCount);
  }

  // Untamed rAF loop -- no throttling needed, since this never touches
  // map.triggerRepaint() or MapLibre's own render pipeline at all.
  function loop() {
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  map.on("sourcedata", (e) => {
    if (active && e.isSourceLoaded) extract();
  });
  map.on("idle", () => {
    if (active) extract();
  });

  return {
    setActive(value) {
      active = value;
      if (active) extract();
    },
  };
}
