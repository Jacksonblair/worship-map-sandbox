// On-page diagnostics -- any uncaught error/rejection shows up in the
// page itself, not just devtools. The whole point of this panel is to
// not need devtools to see what's happening.

export function showPageError(message) {
  const el = document.getElementById("pageError");
  el.textContent = (el.textContent ? el.textContent + "\n" : "") + message;
}
window.addEventListener("error", (e) => showPageError(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => showPageError(`rejection: ${e.reason}`));

// Shared mutable state that layers write into and the stats loop reads
// from -- deliberately plain, no event system; this is a debug panel,
// not app state.
export const debugState = {
  classificationSourceLayers: [],
  classificationVertexCount: 0,
  forestRoadsVertexCount: 0,
};
