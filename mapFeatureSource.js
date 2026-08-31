// The "what data can I get out of the map" boundary. Every layer in
// this sandbox goes through here instead of calling
// map.querySourceFeatures() directly -- one real reason: a future React
// Native port would query the exact same shape of data through a
// completely different call (a VectorSource ref's async
// querySourceFeatures(), not a sync map method). Keeping every call
// site behind these few functions means porting is "write one new
// implementation of this file", not "find and rewrite every call site."
//
// (@maplibre/maplibre-react-native v11+ -- already what the phone app
// uses -- does expose querySourceFeatures on a VectorSource ref, so this
// extraction approach is not web-only; confirmed against its docs.)

// The vector source's id is NOT a stable "openmaptiles" constant across
// base styles -- CARTO's dark-matter/voyager styles serve the same
// OpenMapTiles source-layer schema (water/building/park/landcover/
// transportation) but under a source id of "carto", not "openmaptiles"
// (confirmed by fetching their style.json directly). Resolve the real
// id from whichever style layer already references the source-layer we
// want, instead of hardcoding one.
export function findVectorSourceId(map, sourceLayer) {
  // map.getStyle() can transiently lack a usable .layers array -- e.g.
  // queried right at map construction before MapLibre confirms the
  // style is actually ready, or mid setStyle() during a base-style
  // swap. Treat that the same as "nothing found yet" rather than
  // crashing; callers already expect null to mean "no source for this
  // source-layer right now."
  const style = map.getStyle();
  if (!style?.layers) return null;
  const layer = style.layers.find((l) => l["source-layer"] === sourceLayer);
  return layer ? layer.source : null;
}

// Every fill/fill-extrusion source-layer the CURRENT style actually
// uses, minus whatever's excluded -- discovers real categories (e.g.
// CARTO's "landuse") instead of only the ones we already knew to name.
export function findFillSourceLayers(map, excludedSourceLayers = new Set()) {
  const found = new Set();
  const style = map.getStyle();
  for (const layer of style?.layers ?? []) {
    const sourceLayer = layer["source-layer"];
    if (!sourceLayer || excludedSourceLayers.has(sourceLayer)) continue;
    if (layer.type === "fill" || layer.type === "fill-extrusion") found.add(sourceLayer);
  }
  return [...found];
}

// The one real "get me this category's features" call, used by every
// layer in this sandbox -- resolves the source id, queries, and
// swallows the two ways this can harmlessly fail (no layer references
// that source-layer in this style; the query itself throws) into a
// plain empty array, so callers never need their own try/catch.
export function queryCategoryFeatures(map, sourceLayer) {
  const sourceId = findVectorSourceId(map, sourceLayer);
  if (!sourceId) return [];
  try {
    return map.querySourceFeatures(sourceId, { sourceLayer });
  } catch (error) {
    return [];
  }
}
