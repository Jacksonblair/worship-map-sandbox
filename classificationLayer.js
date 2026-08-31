// Classification check: highlight non-road/non-water areas -----------
// Own program, own buffers, own toggle -- no coupling to any other
// layer. Purpose: verify we can correctly identify "everything that
// isn't road or water," not stylize it. Discovers every fill-ish
// polygon layer in the CURRENT style dynamically (findFillSourceLayers),
// so it surfaces categories nothing else queries by name (e.g. CARTO's
// "landuse", which turned out to span almost the entire residential
// area, continuously, right through roads -- real OSM data: zoning
// polygons aren't cut by streets).

import { ringsFromGeometry, polygonToTriangles, tiledUV } from "./geometry.js";
import { findFillSourceLayers, queryCategoryFeatures } from "./mapFeatureSource.js";
import { linkProgram, uploadBuffer } from "./webgl.js";
import {
  BUSH_VERTEX_SRC,
  BUSH_FRAGMENT_SRC,
  BUSH_TILE_WORLD_SIZE,
  createBushTexture,
} from "./bushTexture.js";
import { debugState } from "./debugPanel.js";

const FLAT_VERTEX_SRC = `
  attribute vec2 aPosition;
  uniform mat4 uMatrix;
  void main() {
    gl_Position = uMatrix * vec4(aPosition, 0.0, 1.0);
  }
`;
const FLAT_FRAGMENT_SRC = `
  precision mediump float;
  void main() {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 0.45); // unmissable, semi-transparent magenta
  }
`;

// Source-layers to exclude even though some styles give them a fill/
// fill-extrusion layer -- "water" is obviously excluded, and
// "transportation" is excluded too because some styles render
// pedestrian plazas/paths as filled polygons on that same source-layer;
// those still count as "road", not "everything else".
const EXCLUDED_SOURCE_LAYERS = new Set(["water", "transportation"]);

export function createClassificationOverlayLayer() {
  let gl;
  let flatProgram, flatAPosition, flatUMatrix;
  let bushProgram, bushAPosition, bushAUV, bushUMatrix, bushUTexture, bushTexture;
  let buffers = null; // { position, uv, count }
  let useBushTexture = false;
  let selection = "__off__"; // "__off__" | "__all__" | a specific source-layer name

  function extract(map) {
    if (selection === "__off__") {
      debugState.classificationSourceLayers = [];
      debugState.classificationVertexCount = 0;
      buffers = null;
      return;
    }
    const allSourceLayers = findFillSourceLayers(map, EXCLUDED_SOURCE_LAYERS);
    const sourceLayers =
      selection === "__all__" ? allSourceLayers : allSourceLayers.filter((l) => l === selection);
    const positions = [];
    const uvs = [];
    const seenSourceLayers = [];
    for (const sourceLayer of sourceLayers) {
      const features = queryCategoryFeatures(map, sourceLayer);
      if (features.length > 0) seenSourceLayers.push(`${sourceLayer} (${features.length})`);
      for (const feature of features) {
        for (const rings of ringsFromGeometry(feature.geometry)) {
          const tri = polygonToTriangles(rings);
          positions.push(...tri);
          for (let i = 0; i < tri.length; i += 2) {
            uvs.push(
              tiledUV(tri[i], BUSH_TILE_WORLD_SIZE),
              tiledUV(tri[i + 1], BUSH_TILE_WORLD_SIZE),
            );
          }
        }
      }
    }
    debugState.classificationSourceLayers = seenSourceLayers;
    debugState.classificationVertexCount = positions.length / 2;
    buffers = {
      position: uploadBuffer(gl, positions),
      uv: uploadBuffer(gl, uvs),
      count: positions.length / 2,
    };
  }

  return {
    id: "classification-overlay-layer",
    type: "custom",
    renderingMode: "2d",

    onAdd(map, glContext) {
      gl = glContext;
      flatProgram = linkProgram(gl, FLAT_VERTEX_SRC, FLAT_FRAGMENT_SRC);
      flatAPosition = gl.getAttribLocation(flatProgram, "aPosition");
      flatUMatrix = gl.getUniformLocation(flatProgram, "uMatrix");

      bushProgram = linkProgram(gl, BUSH_VERTEX_SRC, BUSH_FRAGMENT_SRC);
      bushAPosition = gl.getAttribLocation(bushProgram, "aPosition");
      bushAUV = gl.getAttribLocation(bushProgram, "aUV");
      bushUMatrix = gl.getUniformLocation(bushProgram, "uMatrix");
      bushUTexture = gl.getUniformLocation(bushProgram, "uTexture");
      bushTexture = createBushTexture(gl);

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

    setBushTexture(value) {
      useBushTexture = value;
    },

    setSelection(value) {
      selection = value;
      this.reextract?.();
    },

    render(gl, matrix) {
      if (!buffers || buffers.count === 0) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (useBushTexture) {
        gl.useProgram(bushProgram);
        gl.uniformMatrix4fv(bushUMatrix, false, matrix);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bushTexture);
        gl.uniform1i(bushUTexture, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.enableVertexAttribArray(bushAPosition);
        gl.vertexAttribPointer(bushAPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        gl.enableVertexAttribArray(bushAUV);
        gl.vertexAttribPointer(bushAUV, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.useProgram(flatProgram);
        gl.uniformMatrix4fv(flatUMatrix, false, matrix);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.enableVertexAttribArray(flatAPosition);
        gl.vertexAttribPointer(flatAPosition, 2, gl.FLOAT, false, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    },
  };
}
