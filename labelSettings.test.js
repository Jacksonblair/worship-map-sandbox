import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createLabelSettings,
  hexToRgb01,
  rgb01ToHex,
  LABEL_SETTINGS_SCHEMA,
} from "./labelSettings.js";

describe("createLabelSettings", () => {
  test("with no overrides, returns the full default set", () => {
    const settings = createLabelSettings();
    for (const field of LABEL_SETTINGS_SCHEMA) {
      assert.ok(field.key in settings, `missing default for ${field.key}`);
    }
  });

  test("overrides replace only the given keys, leaving the rest at default", () => {
    const defaults = createLabelSettings();
    const settings = createLabelSettings({ marqueeChar: "♠" });
    assert.equal(settings.marqueeChar, "♠");
    assert.equal(settings.color, defaults.color);
    assert.equal(settings.bloomStrength, defaults.bloomStrength);
  });

  test("every schema field has a matching default", () => {
    const settings = createLabelSettings();
    const missing = LABEL_SETTINGS_SCHEMA.map((f) => f.key).filter(
      (key) => settings[key] === undefined,
    );
    assert.deepEqual(missing, []);
  });
});

describe("hexToRgb01 / rgb01ToHex", () => {
  test("round-trips pure red/green/blue exactly", () => {
    assert.deepEqual(hexToRgb01("#ff0000"), [1, 0, 0]);
    assert.deepEqual(hexToRgb01("#00ff00"), [0, 1, 0]);
    assert.deepEqual(hexToRgb01("#0000ff"), [0, 0, 1]);
  });

  test("rgb01ToHex is the inverse of hexToRgb01 for exact byte values", () => {
    assert.equal(rgb01ToHex(hexToRgb01("#ff4073")), "#ff4073");
    assert.equal(rgb01ToHex(hexToRgb01("#4da6ff")), "#4da6ff");
  });

  test("rgb01ToHex clamps out-of-range channels instead of producing invalid hex", () => {
    assert.equal(rgb01ToHex([1.5, -0.5, 0.5]), "#ff0080");
  });

  test("hexToRgb01 tolerates a leading #", () => {
    assert.deepEqual(hexToRgb01("ffffff"), [1, 1, 1]);
  });
});
