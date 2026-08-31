// Minimal preset: building + water + "major" roads only ---------------
// Mirrors OpenFreeMap Positron's own "highway_major_inner" layer
// (found by inspecting its style.json in Maputnik) -- its filter groups
// primary/secondary/tertiary/trunk as one class, so that's the exact
// road set used here. Everything else this style would normally draw
// (land, minor roads, ferries/rail, labels) is hidden entirely by
// main.js's styleOverrideApplier (via opacity, not visibility -- see
// styleOverrides.js's module comment for why that distinction is what
// keeps this layer's own data actually loading).

import {
  ringsFromGeometry,
  linesFromGeometry,
  polygonToTriangles,
  catmullRomSpline,
  pointsToLineSegments,
  withRepeated,
} from "./geometry.js";
import { queryCategoryFeatures } from "./mapFeatureSource.js";
import { linkProgram, createReusableBuffer } from "./webgl.js";
import { createNoopLogger } from "./logger.js";

const VERTEX_SRC = `
  attribute vec2 aPosition;
  attribute vec4 aColor;
  uniform mat4 uMatrix;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = uMatrix * vec4(aPosition, 0.0, 1.0);
  }
`;
const FRAGMENT_SRC = `
  precision mediump float;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

const WATER_COLOR = [0.243, 0.616, 0.847, 1];
const BUILDING_COLOR = [0.925, 0.749, 0.494, 1];
const MAJOR_ROAD_COLOR = [0.9, 0.72, 0.4, 1];

// Exactly highway_major_inner's own filter -- primary/secondary/
// tertiary/trunk treated as one undifferentiated "major road" class.
const MAJOR_ROAD_CLASSES = new Set(["primary", "secondary", "tertiary", "trunk"]);

// Same spline-then-gl.LINES approach as forestRoadsLayer.js, for the
// same reason -- a naive per-segment thick line has no joins and looks
// broken at real-world bends; splining first hides that with no need
// for real join geometry.
const ROAD_SPLINE_SUBDIVISIONS = 6;

// createMinimalPresetLayer(logger) -- logger is injected (ILogger, see
// logger.js) rather than hardcoded to showPageError, so this layer's
// errors reach the same composite log (page + remote file) everything
// else does, and so it's testable/constructible without any page DOM
// at all. Defaults to a no-op logger if omitted.
export function createMinimalPresetLayer(logger = createNoopLogger()) {
  let gl, program, aPosition, aColor, uMatrix;
  let waterBuffers = null; // { position: ReusableBuffer, color: ReusableBuffer, count }
  let buildingBuffers = null;
  let roadBuffers = null;
  let contextLost = false;
  const debugInfo = { waterFeatures: 0, buildingFeatures: 0, roadFeatures: 0, lastError: null };

  function extractCategory(map, sourceLayer, color, buffers) {
    const positions = [];
    const colors = [];
    const features = queryCategoryFeatures(map, sourceLayer);
    for (const feature of features) {
      for (const rings of ringsFromGeometry(feature.geometry)) {
        const tri = polygonToTriangles(rings);
        positions.push(...tri);
        colors.push(...withRepeated(color, (tri.length / 2) * 4));
      }
    }
    buffers.position.update(positions);
    buffers.color.update(colors);
    buffers.count = positions.length / 2;
    return features.length;
  }

  function extractMajorRoads(map, buffers) {
    const positions = [];
    const colors = [];
    const allFeatures = queryCategoryFeatures(map, "transportation");
    const majorFeatures = allFeatures.filter((f) => MAJOR_ROAD_CLASSES.has(f.properties?.class));
    for (const feature of majorFeatures) {
      for (const line of linesFromGeometry(feature.geometry)) {
        const smoothed = catmullRomSpline(line, ROAD_SPLINE_SUBDIVISIONS);
        const segments = pointsToLineSegments(smoothed);
        positions.push(...segments);
        colors.push(...withRepeated(MAJOR_ROAD_COLOR, (segments.length / 2) * 4));
      }
    }
    buffers.position.update(positions);
    buffers.color.update(colors);
    buffers.count = positions.length / 2;
    return majorFeatures.length;
  }

  function createBuffers() {
    waterBuffers = {
      position: createReusableBuffer(gl),
      color: createReusableBuffer(gl),
      count: 0,
    };
    buildingBuffers = {
      position: createReusableBuffer(gl),
      color: createReusableBuffer(gl),
      count: 0,
    };
    roadBuffers = { position: createReusableBuffer(gl), color: createReusableBuffer(gl), count: 0 };
  }

  function extract(map) {
    if (contextLost) return;
    try {
      debugInfo.waterFeatures = extractCategory(map, "water", WATER_COLOR, waterBuffers);
      debugInfo.buildingFeatures = extractCategory(
        map,
        "building",
        BUILDING_COLOR,
        buildingBuffers,
      );
      debugInfo.roadFeatures = extractMajorRoads(map, roadBuffers);
      debugInfo.lastError = null;
    } catch (error) {
      debugInfo.lastError = error.message;
      logger.log("error", "minimalPresetLayer", `extract() failed: ${error.message}`);
      throw error;
    }
  }

  return {
    id: "minimal-preset-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, glContext) {
      gl = glContext;
      contextLost = false;
      program = linkProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
      aPosition = gl.getAttribLocation(program, "aPosition");
      aColor = gl.getAttribLocation(program, "aColor");
      uMatrix = gl.getUniformLocation(program, "uMatrix");
      createBuffers();

      this.reextract = () => extract(map);
      this.reextract();

      // Only "idle" -- not "sourcedata" -- re-extracts. "sourcedata"
      // fires once PER TILE, so at a real zoom a single pan could
      // trigger dozens of extracts (each allocating fresh buffers
      // under the old design); "idle" fires once movement/loading
      // actually settles, which is what every extraction in this
      // sandbox actually needs.
      this._onIdle = () => this.reextract();
      map.on("idle", this._onIdle);

      // CustomLayerInterface's own docs call for handling context loss;
      // nothing in this codebase did before. Without this, a lost
      // context leaves render() calling GL methods against invalid
      // handles -- MapLibre swallows the resulting GL errors, so this
      // would otherwise be one more way to go silently blank.
      this._canvas = map.getCanvas();
      this._onContextLost = (e) => {
        e.preventDefault();
        contextLost = true;
        logger.log("warn", "minimalPresetLayer", "WebGL context lost");
      };
      this._onContextRestored = () => {
        contextLost = false;
        logger.log(
          "info",
          "minimalPresetLayer",
          "WebGL context restored, rebuilding program and buffers",
        );
        program = linkProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
        aPosition = gl.getAttribLocation(program, "aPosition");
        aColor = gl.getAttribLocation(program, "aColor");
        uMatrix = gl.getUniformLocation(program, "uMatrix");
        createBuffers();
        this.reextract();
      };
      this._canvas.addEventListener("webglcontextlost", this._onContextLost, false);
      this._canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
    },

    onRemove(map) {
      map.off("idle", this._onIdle);
      this._canvas?.removeEventListener("webglcontextlost", this._onContextLost);
      this._canvas?.removeEventListener("webglcontextrestored", this._onContextRestored);
      waterBuffers?.position.destroy();
      waterBuffers?.color.destroy();
      buildingBuffers?.position.destroy();
      buildingBuffers?.color.destroy();
      roadBuffers?.position.destroy();
      roadBuffers?.color.destroy();
    },

    getDebugInfo() {
      return {
        ...debugInfo,
        waterVertices: waterBuffers?.count ?? 0,
        buildingVertices: buildingBuffers?.count ?? 0,
        roadVertices: roadBuffers?.count ?? 0,
      };
    },

    render(gl, matrix) {
      if (contextLost) return;
      try {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(program);
        gl.uniformMatrix4fv(uMatrix, false, matrix);

        function draw(buffers, mode) {
          if (!buffers || buffers.count === 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position.handle);
          gl.enableVertexAttribArray(aPosition);
          gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color.handle);
          gl.enableVertexAttribArray(aColor);
          gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
          gl.drawArrays(mode, 0, buffers.count);
        }
        draw(waterBuffers, gl.TRIANGLES);
        draw(buildingBuffers, gl.TRIANGLES);
        draw(roadBuffers, gl.LINES);
      } catch (error) {
        // render() runs inside MapLibre's own per-frame render loop --
        // an exception here may not reach window's error handler the
        // same way a normal uncaught exception does, so record it
        // somewhere getDebugInfo() can surface it either way.
        debugInfo.lastError = `render(): ${error.message}`;
        logger.log("error", "minimalPresetLayer", `render() failed: ${error.message}`);
      }
    },
  };
}
