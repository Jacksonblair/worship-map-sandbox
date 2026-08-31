// The canonical list of tether line-style names. Pure and THREE-free
// (unlike lineStyles.js, which builds actual textures) specifically so
// labelSettings.js can list these as a select field's options without
// pulling THREE into a module node --test needs to import directly --
// same reasoning as lineTransform.js/boxLayout.js/etc. lineStyles.js
// imports this same list rather than redeclaring it, so the settings
// schema and the actual implemented styles can never drift apart.
export const LINE_TYPES = ["glow", "dashed", "dotted"];
