// The tunable settings for ONE boxed label -- objectified so a single
// schema describes what's configurable, a single default set anchors
// every location's starting point, and a single pair of color-format
// converters is the only place that boundary lives. Pure, testable, no
// THREE/DOM dependency.
//
// labelSettingsPanel.js (the generic UI renderer) and boxedLabelLayer.js
// (the consumer that actually applies a change) both depend on THIS
// shape rather than knowing about each other -- that's what makes "add
// a location" or "add a setting" a data change, not new bespoke code in
// either of them (Open/Closed).

import { LINE_TYPES } from "./lineTypes.js";

export const LABEL_SETTINGS_SCHEMA = [
  { key: "color", label: "Border/text color", type: "color" },
  { key: "marqueeChar", label: "Marquee symbol", type: "select", options: ["♥", "♦", "♣", "♠"] },
  { key: "marqueeColor", label: "Marquee color", type: "color" },
  { key: "marqueeInterval", label: "Marquee spacing", type: "range", min: 1, max: 10, step: 1 },
  {
    key: "marqueeCycleSeconds",
    label: "Marquee speed (s/loop)",
    type: "range",
    min: 0.3,
    max: 5,
    step: 0.1,
  },
  {
    key: "marqueeTailLength",
    label: "Marquee tail length",
    type: "range",
    min: 0,
    max: 6,
    step: 1,
  },
  {
    key: "marqueeEmissiveIntensity",
    label: "Heart glow intensity",
    type: "range",
    min: 0.5,
    max: 5,
    step: 0.1,
  },
  { key: "bloomStrength", label: "Bloom strength", type: "range", min: 0, max: 3, step: 0.05 },
  { key: "bloomRadius", label: "Bloom radius", type: "range", min: 0, max: 1, step: 0.02 },
  { key: "bloomThreshold", label: "Bloom threshold", type: "range", min: 0, max: 1, step: 0.02 },
  {
    key: "tetherOpacity",
    label: "Ground tether opacity (0 = hidden)",
    type: "range",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "tetherThickness",
    label: "Ground tether thickness",
    type: "range",
    min: 1,
    max: 24,
    step: 1,
  },
  { key: "tetherLineType", label: "Ground tether line type", type: "select", options: LINE_TYPES },
];

const DEFAULT_LABEL_SETTINGS = {
  color: "#ffd966",
  marqueeChar: "♥",
  marqueeColor: "#ff4073",
  marqueeInterval: 3,
  marqueeCycleSeconds: 1.5,
  marqueeTailLength: 2,
  marqueeEmissiveIntensity: 2.2,
  bloomStrength: 0.8,
  bloomRadius: 0.5,
  bloomThreshold: 0.5,
  tetherOpacity: 0.8,
  tetherThickness: 9,
  tetherLineType: "glow",
};

export function createLabelSettings(overrides = {}) {
  return { ...DEFAULT_LABEL_SETTINGS, ...overrides };
}

// #rrggbb <-> [r, g, b] (0..1) -- the one boundary between
// <input type="color">'s hex strings and THREE.Color/this sandbox's own
// float-channel convention.
export function hexToRgb01(hex) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16) / 255;
  const g = parseInt(value.substring(2, 4), 16) / 255;
  const b = parseInt(value.substring(4, 6), 16) / 255;
  return [r, g, b];
}

export function rgb01ToHex([r, g, b]) {
  const toHex = (c) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
