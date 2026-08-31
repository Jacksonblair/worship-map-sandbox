// Deterministic jitter for scattering icon-only markers around a real
// center point (a suburb centroid) -- used when we want visual DENSITY
// across a city area without claiming each individual point is a real,
// individually geocoded venue (unlike SPRITE_PLACES' hand-picked
// landmarks in main.js, which are). Seeded (not Math.random()) so
// reloading the sandbox never reshuffles a marker's position -- the
// same (seed, index) always produces the same offset. Pure/THREE-free
// like zoomScale.js/glyphAtlas.js/etc, so node --test can import it
// directly.

function hashSeed(str) {
  // FNV-1a -- small, fast, good-enough distribution for this (not a
  // cryptographic use), and dependency-free.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// scatterPoints(seed, centerLng, centerLat, count, radiusDegrees) --
// `count` deterministic points jittered around (centerLng, centerLat),
// each within radiusDegrees of it. The radius draw uses sqrt(rand())
// rather than rand() directly, so points land with uniform density
// across the disc's AREA instead of clustering near the center (a
// disc's area grows with r^2, so sampling r uniformly over-weights
// small radii). `seed` should be unique per call site (e.g.
// `${suburbId}:${category}`) so two different scatters never land on
// identical offsets.
export function scatterPoints(seed, centerLng, centerLat, count, radiusDegrees) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const rand = mulberry32(hashSeed(`${seed}:${i}`));
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * radiusDegrees;
    points.push({
      lng: centerLng + Math.cos(angle) * radius,
      lat: centerLat + Math.sin(angle) * radius,
    });
  }
  return points;
}
