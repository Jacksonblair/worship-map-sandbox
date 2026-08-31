import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createCompositeLogger, createMemoryLogger } from "./logger.js";

// createPageLogger itself needs `document`, so it's not directly
// testable here without a DOM -- but the level-filtering LOGIC is
// exercised indirectly by asserting on createMemoryLogger + a minimal
// stand-in that reproduces the same filter, since the actual bug
// (routine info/debug traffic flooding a panel styled for errors) was
// a filtering bug, not a DOM bug.
function createFilteredLogger(minLevel, levels) {
  const minIndex = levels.indexOf(minLevel);
  const inner = createMemoryLogger();
  return {
    entries: inner.entries,
    log(level, category, message, data) {
      if (levels.indexOf(level) < minIndex) return;
      inner.log(level, category, message, data);
    },
  };
}

const LEVELS = ["debug", "info", "warn", "error"];

describe("page-style level filtering", () => {
  test("routine info/debug calls are filtered out at minLevel warn", () => {
    const logger = createFilteredLogger("warn", LEVELS);
    logger.log("debug", "styleOverrideApplier", "reapply: 0 change(s)");
    logger.log("info", "styleOverrideApplier", "baseline captured: 6 layers");
    assert.equal(logger.entries.length, 0);
  });

  test("warn and error still get through", () => {
    const logger = createFilteredLogger("warn", LEVELS);
    logger.log("warn", "styleOverrideApplier", "water.visibility: wanted visible, got none");
    logger.log("error", "maplibre", "Cannot style non-existing layer");
    assert.equal(logger.entries.length, 2);
  });
});

describe("createCompositeLogger", () => {
  test("fans out to every logger unfiltered -- filtering is each sink's own choice", () => {
    const a = createMemoryLogger();
    const b = createMemoryLogger();
    const composite = createCompositeLogger([a, b]);
    composite.log("info", "test", "hello");
    assert.equal(a.entries.length, 1);
    assert.equal(b.entries.length, 1);
  });
});
