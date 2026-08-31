import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { repaintOnMapChange } from "./repaintOnMapChange.js";

function createFakeMap() {
  const listeners = new Map();
  return {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
    },
    fire(event) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  };
}

describe("repaintOnMapChange", () => {
  // The actual regression this guards against: the previous
  // implementation called triggerRepaint() unconditionally, every
  // frame, forever -- an idle map (no pan/zoom/rotate, no settings
  // change) would still cost a full repaint 60 times a second. This
  // would fail against that old behavior; it only passes because a
  // repaint is now requested exclusively in response to a real event.
  test("an idle map (no move event) requests zero repaints", () => {
    const map = createFakeMap();
    let repaints = 0;
    repaintOnMapChange(map, () => repaints++);
    assert.equal(repaints, 0);
  });

  test("requests exactly one repaint per move event", () => {
    const map = createFakeMap();
    let repaints = 0;
    repaintOnMapChange(map, () => repaints++);
    map.fire("move");
    map.fire("move");
    map.fire("move");
    assert.equal(repaints, 3);
  });

  test("stops requesting repaints once the returned cleanup runs", () => {
    const map = createFakeMap();
    let repaints = 0;
    const cleanup = repaintOnMapChange(map, () => repaints++);
    cleanup();
    map.fire("move");
    assert.equal(repaints, 0);
  });
});
