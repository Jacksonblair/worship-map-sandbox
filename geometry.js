// Pure geometry math -- no DOM, no MapLibre types beyond the global
// `maplibregl.MercatorCoordinate` helper. Nothing here depends on how
// the data was fetched or how it gets drawn, so this is the most
// directly portable module if any of this logic needs to run inside
// the phone app later (same math, whatever supplies the input points).

export function mercXY(lngLat) {
  const m = maplibregl.MercatorCoordinate.fromLngLat(lngLat);
  return { x: m.x, y: m.y };
}

export function mercatorUnitsPerPixel(map) {
  // maplibregl.MercatorCoordinate's documented convention: 1 unit spans
  // the full projected world, and the world is 512 * 2^zoom CSS px wide
  // -- exact, not an empirical approximation.
  return 1 / (512 * Math.pow(2, map.getZoom()));
}

export function ringsFromGeometry(geometry) {
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polys.map((rings) => rings.map((ring) => ring.map(mercXY)));
}

export function linesFromGeometry(geometry) {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  return lines.map((line) => line.map(mercXY));
}

export function polygonToTriangles(rings) {
  const flat = [];
  const holeIndices = [];
  for (const ring of rings) {
    if (flat.length > 0) holeIndices.push(flat.length / 2);
    for (const p of ring) flat.push(p.x, p.y);
  }
  const indices = earcut(flat, holeIndices);
  const positions = [];
  for (const index of indices) positions.push(flat[index * 2], flat[index * 2 + 1]);
  return positions;
}

// Thick-line expansion in Mercator space -- a fixed Mercator width
// naturally renders as more screen pixels the further you zoom in
// (the same sliver of world fills more of the screen), which matches
// how real cartographic line/casing widths are meant to behave.
export function lineToTriangles(points, width) {
  const positions = [];
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-12;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    positions.push(
      a.x + nx,
      a.y + ny,
      a.x - nx,
      a.y - ny,
      b.x + nx,
      b.y + ny,
      b.x - nx,
      b.y - ny,
      b.x + nx,
      b.y + ny,
      a.x - nx,
      a.y - ny,
    );
  }
  return positions;
}

// lineToTriangles draws each segment as its own independent rectangle --
// no miter/round joins -- so at any real-world bend sharper than a
// gentle curve it either gapes open (convex side) or overlaps (concave
// side). Running the points through a Catmull-Rom spline first (passes
// through every original point, just adds many closely-spaced
// interpolated points between them) makes the angle between consecutive
// segments tiny enough that the no-join approach looks seamless anyway.
function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function catmullRomSpline(points, subdivisionsPerSegment) {
  if (points.length < 3) return points; // a single segment has no bend to smooth
  const n = points.length;
  const result = [points[0]];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    for (let s = 1; s <= subdivisionsPerSegment; s += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, s / subdivisionsPerSegment));
    }
  }
  return result; // ends exactly on the last original point (t=1 => p2)
}

// A point sequence as a gl.LINES vertex list -- [p0,p1, p1,p2, p2,p3, ...]
// rather than gl.LINE_STRIP. Every road's segments can then batch into
// one shared buffer/one draw call (LINE_STRIP can't be batched this way
// without primitive-restart support, which WebGL1 doesn't have).
export function pointsToLineSegments(points) {
  const positions = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    positions.push(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
  }
  return positions;
}

// Reduces a world position to a small-magnitude UV before it ever
// touches a Float32Array. Absolute Mercator positions are ~0.5 in
// magnitude; dividing by a tiny tile size blows that up to the
// millions, and float32 only has ~7 significant digits -- storing that
// directly would visibly jitter/stair-step as you pan. Subtracting an
// integer multiple of 1024 is exact in JS's float64 (no precision lost)
// and keeps the stored value small, since only the fractional part
// matters for a REPEAT-wrapped texture sample anyway.
export function tiledUV(worldPos, tileSize) {
  const raw = worldPos / tileSize;
  return raw - Math.round(raw / 1024) * 1024;
}

export function withRepeated(values, count) {
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = values[i % values.length];
  return out;
}
