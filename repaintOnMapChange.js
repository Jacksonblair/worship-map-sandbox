// Requests exactly one repaint per real map-state change (MapLibre's
// "move" event fires for pan/zoom/rotate/pitch alike) instead of the
// unconditional-every-frame requestAnimationFrame loop every custom
// layer used to run -- confirmed live via logcat that an idle map (no
// camera movement, nobody touching the settings panel) was triggering
// a full repaint, and inside it a full bloom-pipeline re-render per
// label, 60 times a second for identical output. Deliberately has no
// THREE/DOM import so it can be unit tested directly, unlike the layer
// files that use it (see main.js's own header comment on that
// boundary).
export function repaintOnMapChange(map, requestRepaint) {
  const handler = () => requestRepaint();
  map.on("move", handler);
  return () => map.off("move", handler);
}
