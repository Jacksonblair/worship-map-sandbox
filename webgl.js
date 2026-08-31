// Tiny shared shader-compile/link helpers -- every layer factory in
// this sandbox had its own private copy of these; consolidated since
// none of them differ.

export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

export function linkProgram(gl, vertexSrc, fragmentSrc) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

export function uploadBuffer(gl, data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return buf;
}

// A GL buffer that's created ONCE and re-filled in place via bufferData
// on every re-extraction, instead of calling uploadBuffer (which
// allocates a brand new gl.createBuffer() every time and never frees
// the old one). Code review flagged this as a real, confirmed leak:
// every custom layer wired to both "sourcedata" and "idle" re-extracts
// on every tile that lands, so a single pan at a real zoom can trigger
// dozens of extracts -- each one orphaning every buffer from the call
// before it, since nothing ever called gl.deleteBuffer. Left running
// long enough this exhausts GPU memory and the context is lost, with
// no thrown JS error at all (shimmerCanvas.js already did this
// correctly with one hand-rolled buffer; this generalizes that pattern
// for reuse across every layer instead of leaving it a one-off).
// Loads an image URL into a GL texture. Returns immediately with a
// usable (1x1 white pixel) texture -- decoding an <img> is async, and a
// texture bound/sampled before its first real upload is otherwise
// "incomplete" and throws GL errors -- plus a `ready` promise that
// resolves once the real image has replaced that placeholder, so a
// caller can log/gate on it without the sandbox stalling on network
// latency. NEAREST filtering + CLAMP_TO_EDGE: this sandbox only ever
// uses this for pixel-art glyph atlases, where linear filtering would
// blur crisp pixel edges and wrapping would bleed neighboring glyphs in.
export function loadImageTexture(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const ready = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Flips the image vertically on upload so texture v=1 ends up as
      // the TOP of the source PNG (standard WebGL convention for
      // "looks right-side-up under normal v-increases-upward
      // sampling") -- matters here since glyphUVRect (iconSpriteLayer.js)
      // assumes exactly this.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      resolve();
    };
    image.onerror = () => reject(new Error(`loadImageTexture: failed to load ${url}`));
    image.src = url;
  });

  return { texture, ready };
}

export function createReusableBuffer(gl) {
  const handle = gl.createBuffer();
  return {
    handle,
    update(data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, handle);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    },
    destroy() {
      gl.deleteBuffer(handle);
    },
  };
}
