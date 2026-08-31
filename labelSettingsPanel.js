// Generic, schema-driven settings UI -- given ANY settings object
// shaped like labelSettings.js's schema and a container element, builds
// the input controls and wires them to mutate that object live, calling
// onChange(key) after each edit. Works for however many locations exist
// without modification: adding a field to LABEL_SETTINGS_SCHEMA or a
// new location in main.js needs zero changes here (Open/Closed) -- this
// module only knows "how to render one settings object," never which
// location it belongs to.

import { LABEL_SETTINGS_SCHEMA } from "./labelSettings.js";

export function renderLabelSettingsPanel(container, settings, onChange) {
  container.innerHTML = "";

  for (const field of LABEL_SETTINGS_SCHEMA) {
    const label = document.createElement("label");
    label.style.cssText = "display:block;margin-top:6px;";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${field.label} `;
    const valueSpan = document.createElement("span");
    valueSpan.style.color = "#4da6ff";

    let input;
    if (field.type === "color") {
      input = document.createElement("input");
      input.type = "color";
      input.value = settings[field.key];
      input.style.cssText =
        "width:100%;height:22px;vertical-align:middle;border:none;background:none;padding:0;";
    } else if (field.type === "select") {
      input = document.createElement("select");
      input.style.width = "100%";
      for (const option of field.options) {
        const optionEl = document.createElement("option");
        optionEl.value = option;
        optionEl.textContent = option;
        if (option === settings[field.key]) optionEl.selected = true;
        input.appendChild(optionEl);
      }
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.value = String(settings[field.key]);
      input.style.width = "100%";
    }

    const refreshValueLabel = () => {
      valueSpan.textContent = field.type === "range" ? Number(settings[field.key]).toFixed(2) : "";
    };
    refreshValueLabel();

    input.addEventListener("input", () => {
      settings[field.key] = field.type === "range" ? Number(input.value) : input.value;
      refreshValueLabel();
      onChange(field.key);
    });

    label.appendChild(nameSpan);
    label.appendChild(valueSpan);
    label.appendChild(document.createElement("br"));
    label.appendChild(input);
    container.appendChild(label);
  }
}
