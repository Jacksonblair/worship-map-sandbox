// Forest base + differentiated roads -----------------------------------
// Sidesteps the whole "which categories count as land" classification
// problem: don't identify land polygons at all. Cover the ENTIRE
// viewport in the bush texture as a base, then draw water opaquely on
// top (so it pokes through), then roads on top of that as real
// gl.LINES primitives along a spline through each road's own points --
// not a filled thick-line mesh (WebGL doesn't reliably support line
// widths above 1px across GPUs/browsers, so class differentiation here
// is by color only, not width).

import {
  mercXY,
  ringsFromGeometry,
  linesFromGeometry,
  polygonToTriangles,
  catmullRomSpline,
  pointsToLineSegments,
  tiledUV,
  withRepeated,
} from "./geometry.js";
import { queryCategoryFeatures } from "./mapFeatureSource.js";
import { linkProgram, uploadBuffer } from "./webgl.js";
import {
  BUSH_VERTEX_SRC,
  BUSH_FRAGMENT_SRC,
  BUSH_TILE_WORLD_SIZE,
  createBushTexture,
} from "./bushTexture.js";
import { debugState } from "./debugPanel.js";

const FLAT_COLOR_VERTEX_SRC = `
  attribute vec2 aPosition;
  attribute vec4 aColor;
  uniform mat4 uMatrix;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = uMatrix * vec4(aPosition, 0.0, 1.0);
  }
`;
const FLAT_COLOR_FRAGMENT_SRC = `
  precision mediump float;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

const WATER_COLOR = [0.243, 0.616, 0.847, 1];

// Color differentiation by class -- brighter for arterial roads, duller
// (and slightly transparent, like packed dirt) for paths/tracks.
// Anything not listed (a class this style's schema uses that we haven't
// named) falls back to ROAD_STYLE_DEFAULT rather than silently not
// rendering. widthPx is currently unused -- kept as the documented
// intent for whenever real thick-line-with-joins geometry replaces the
// current gl.LINES approach.
const ROAD_STYLES = {
  motorway: { widthPx: 7, color: [0.95, 0.78, 0.35, 1] },
  trunk: { widthPx: 6.5, color: [0.9, 0.72, 0.4, 1] },
  primary: { widthPx: 5.5, color: [0.85, 0.68, 0.45, 1] },
  secondary: { widthPx: 4.5, color: [0.78, 0.66, 0.5, 1] },
  tertiary: { widthPx: 3.5, color: [0.72, 0.62, 0.5, 1] },
  minor: { widthPx: 2.5, color: [0.65, 0.58, 0.48, 1] },
  service: { widthPx: 1.8, color: [0.58, 0.52, 0.44, 1] },
  path: { widthPx: 1.2, color: [0.5, 0.46, 0.38, 0.75] },
  track: { widthPx: 1.2, color: [0.5, 0.46, 0.38, 0.75] },
};
const ROAD_STYLE_DEFAULT = { widthPx: 2, color: [0.6, 0.55, 0.45, 1] };

// OpenMapTiles' "transportation" source-layer isn't just car roads --
// ferries and railways are stored as the same kind of line geometry,
// just tagged with a different "class". Left unfiltered, those fell
// through to ROAD_STYLE_DEFAULT and rendered indistinguishable from a
// real road (a ferry route across the harbour looked like a road over
// water). Excluded outright for now rather than styled distinctly.
const EXCLUDED_TRANSPORTATION_CLASSES = new Set([
  "ferry",
  "rail",
  "transit",
  "aerialway",
  "shuttle_train",
  "funicular",
]);

// Interpolated points added per original road segment before it's split
// into gl.LINES pairs -- see catmullRomSpline's comment for why.
const ROAD_SPLINE_SUBDIVISIONS = 6;

export function createForestRoadsLayer() {
  let gl;
  let bushProgram, bushAPosition, bushAUV, bushUMatrix, bushUTexture, bushTexture;
  let flatProgram, flatAPosition, flatAColor, flatUMatrix;
  let forestBuffers = null; // { position, uv, count }
  let waterBuffers = null; // { position, color, count }
  let roadBuffers = null; // { position, color, count }

  // A quad covering the current viewport plus a 30% margin (so a small
  // pan before the next "idle" re-extraction doesn't reveal a bare
  // edge). Small enough in world-space that the same tiledUV()
  // mod-1024 reduction used for individual polygons elsewhere stays
  // valid here too -- a literal whole-world quad would span so many
  // tile repeats that per-vertex UV interpolation across just 2 giant
  // triangles would break down; a viewport-sized one doesn't.
  function buildForestQuad(map) {
    const bounds = map.getBounds();
    const nw = mercXY(bounds.getNorthWest());
    const se = mercXY(bounds.getSouthEast());
    const marginX = (se.x - nw.x) * 0.3;
    const marginY = (se.y - nw.y) * 0.3;
    const minX = nw.x - marginX,
      maxX = se.x + marginX;
    const minY = nw.y - marginY,
      maxY = se.y + marginY;
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const positions = [];
    const uvs = [];
    for (const c of corners) {
      positions.push(c.x, c.y);
      uvs.push(tiledUV(c.x, BUSH_TILE_WORLD_SIZE), tiledUV(c.y, BUSH_TILE_WORLD_SIZE));
    }
    return { positions, uvs };
  }

  function extract(map) {
    const forestGeom = buildForestQuad(map);
    forestBuffers = {
      position: uploadBuffer(gl, forestGeom.positions),
      uv: uploadBuffer(gl, forestGeom.uvs),
      count: forestGeom.positions.length / 2,
    };

    const waterPositions = [];
    const waterColors = [];
    for (const feature of queryCategoryFeatures(map, "water")) {
      for (const rings of ringsFromGeometry(feature.geometry)) {
        const tri = polygonToTriangles(rings);
        waterPositions.push(...tri);
        waterColors.push(...withRepeated(WATER_COLOR, (tri.length / 2) * 4));
      }
    }
    waterBuffers = {
      position: uploadBuffer(gl, waterPositions),
      color: uploadBuffer(gl, waterColors),
      count: waterPositions.length / 2,
    };

    const roadPositions = [];
    const roadColors = [];
    for (const feature of queryCategoryFeatures(map, "transportation")) {
      const featureClass = feature.properties?.class;
      if (EXCLUDED_TRANSPORTATION_CLASSES.has(featureClass)) continue;
      const style = ROAD_STYLES[featureClass] ?? ROAD_STYLE_DEFAULT;
      for (const line of linesFromGeometry(feature.geometry)) {
        const smoothed = catmullRomSpline(line, ROAD_SPLINE_SUBDIVISIONS);
        const segments = pointsToLineSegments(smoothed);
        roadPositions.push(...segments);
        roadColors.push(...withRepeated(style.color, (segments.length / 2) * 4));
      }
    }
    roadBuffers = {
      position: uploadBuffer(gl, roadPositions),
      color: uploadBuffer(gl, roadColors),
      count: roadPositions.length / 2,
    };

    debugState.forestRoadsVertexCount =
      forestBuffers.count + waterBuffers.count + roadBuffers.count;
  }

  return {
    id: "forest-roads-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, glContext) {
      gl = glContext;
      bushProgram = linkProgram(gl, BUSH_VERTEX_SRC, BUSH_FRAGMENT_SRC);
      bushAPosition = gl.getAttribLocation(bushProgram, "aPosition");
      bushAUV = gl.getAttribLocation(bushProgram, "aUV");
      bushUMatrix = gl.getUniformLocation(bushProgram, "uMatrix");
      bushUTexture = gl.getUniformLocation(bushProgram, "uTexture");
      bushTexture = createBushTexture(gl);

      flatProgram = linkProgram(gl, FLAT_COLOR_VERTEX_SRC, FLAT_COLOR_FRAGMENT_SRC);
      flatAPosition = gl.getAttribLocation(flatProgram, "aPosition");
      flatAColor = gl.getAttribLocation(flatProgram, "aColor");
      flatUMatrix = gl.getUniformLocation(flatProgram, "uMatrix");

      this.reextract = () => extract(map);
      this.reextract();

      this._onSourceData = (e) => {
        if (e.isSourceLoaded) this.reextract();
      };
      this._onIdle = () => this.reextract();
      map.on("sourcedata", this._onSourceData);
      map.on("idle", this._onIdle);
    },

    onRemove(map) {
      map.off("sourcedata", this._onSourceData);
      map.off("idle", this._onIdle);
    },

    render(gl, matrix) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (forestBuffers && forestBuffers.count > 0) {
        gl.useProgram(bushProgram);
        gl.uniformMatrix4fv(bushUMatrix, false, matrix);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bushTexture);
        gl.uniform1i(bushUTexture, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, forestBuffers.position);
        gl.enableVertexAttribArray(bushAPosition);
        gl.vertexAttribPointer(bushAPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, forestBuffers.uv);
        gl.enableVertexAttribArray(bushAUV);
        gl.vertexAttribPointer(bushAUV, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, forestBuffers.count);
      }

      function drawFlat(buffers, mode) {
        if (!buffers || buffers.count === 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.enableVertexAttribArray(flatAPosition);
        gl.vertexAttribPointer(flatAPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
        gl.enableVertexAttribArray(flatAColor);
        gl.vertexAttribPointer(flatAColor, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(mode, 0, buffers.count);
      }
      gl.useProgram(flatProgram);
      gl.uniformMatrix4fv(flatUMatrix, false, matrix);
      drawFlat(waterBuffers, gl.TRIANGLES); // over the forest
      drawFlat(roadBuffers, gl.LINES); // real line primitives, over both
    },
  };
}
