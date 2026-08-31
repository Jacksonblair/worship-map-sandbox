// A small, procedurally-generated, seamlessly-tiling bush texture --
// no image asset. UV is computed from world (Mercator) position, not
// authored per-polygon, so it tiles consistently across arbitrary
// shapes with zero UV-unwrapping work (see geometry.js's tiledUV).

export const BUSH_VERTEX_SRC = `
  attribute vec2 aPosition;
  attribute vec2 aUV;
  uniform mat4 uMatrix;
  varying vec2 vUV;
  void main() {
    vUV = aUV;
    gl_Position = uMatrix * vec4(aPosition, 0.0, 1.0);
  }
`;
export const BUSH_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 vUV;
  uniform sampler2D uTexture;
  void main() {
    gl_FragColor = texture2D(uTexture, vUV);
  }
`;

// One tile = this many Mercator world-units. Mercator x spans [0,1] for
// the whole Earth's circumference, so this is a fixed real-world tile
// size -- like a real ground texture, it gets visibly bigger on screen
// as you zoom in, rather than staying a constant screen-pixel size.
// Picked so a tile reads as roughly two dozen screen px around zoom 16.
export const BUSH_TILE_WORLD_SIZE = 7e-7;

export function createBushTexture(gl) {
  // Power-of-two so WebGL1 allows REPEAT wrapping + mipmaps.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2f5a34";
  ctx.fillRect(0, 0, size, size);

  // Small deterministic PRNG -- no reason for this to differ between
  // reloads, and it keeps this self-contained with no extra dependency.
  let seed = 1337;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  function drawBlobWrapped(x, y, r, color) {
    ctx.fillStyle = color;
    // A blob straddling an edge needs its wraparound copy drawn bleeding
    // in from the opposite edge, or the tile seams would be visible.
    for (const dx of [0, -size, size]) {
      for (const dy of [0, -size, size]) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const blobLayers = [
    { color: "#3c7a43", count: 10, minR: 10, maxR: 18 },
    { color: "#2a5230", count: 14, minR: 6, maxR: 12 },
    { color: "#4f9052", count: 8, minR: 3, maxR: 6 },
  ];
  for (const { color, count, minR, maxR } of blobLayers) {
    for (let i = 0; i < count; i += 1) {
      drawBlobWrapped(rand() * size, rand() * size, minR + rand() * (maxR - minR), color);
    }
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}
