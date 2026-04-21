/**
 * AWS Portal Account Names - Options Page Script
 *
 * Manages the UI for configuring account ID -> friendly name mappings.
 * Supports individual row editing and bulk import/export.
 */

const mappingsList = document.getElementById("mappings-list");
const statusEl = document.getElementById("status");
const colorPickerModal = document.getElementById("color-picker-modal");
const colorWheelCanvas = document.getElementById("color-wheel-canvas");
const colorHexInput = document.getElementById("color-hex-input");
const colorPreview = document.getElementById("color-preview");
const colorCopyBtn = document.getElementById("color-copy");
const colorPasteBtn = document.getElementById("color-paste");
const colorApplyBtn = document.getElementById("color-apply");
const colorCancelBtn = document.getElementById("color-cancel");
const MAX_FRIENDLY_NAME_LENGTH = 120;
const DEFAULT_NAME_COLOR = "#0972d3";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const COLOR_WHEEL_SIZE = 220;
const COLOR_WHEEL_RADIUS = 106;

let activeColorRow = null;
let activeColorHex = DEFAULT_NAME_COLOR;
let wheelImageData = null;
let wheelPointerDown = false;
let colorModalReturnFocusEl = null;

function validateFriendlyName(name, contextLabel) {
  if (!name) {
    throw new Error(`${contextLabel} cannot be empty`);
  }

  if (name.length > MAX_FRIENDLY_NAME_LENGTH) {
    throw new Error(
      `${contextLabel} is too long (${name.length}/${MAX_FRIENDLY_NAME_LENGTH} chars max)`
    );
  }
}

function validateColor(color, contextLabel) {
  if (!HEX_COLOR_RE.test(color)) {
    throw new Error(`${contextLabel} must be a valid hex color (for example #0972d3)`);
  }
}

function normalizeHexColor(rawColor) {
  const value = rawColor.trim();
  const withHash = value.startsWith("#") ? value : `#${value}`;
  const normalized = withHash.toLowerCase();

  if (!HEX_COLOR_RE.test(normalized)) {
    return null;
  }

  return normalized;
}

function hexToRgb(hexColor) {
  return {
    r: parseInt(hexColor.slice(1, 3), 16),
    g: parseInt(hexColor.slice(3, 5), 16),
    b: parseInt(hexColor.slice(5, 7), 16),
  };
}

function rgbToHex(r, g, b) {
  const channelToHex = (channel) => channel.toString(16).padStart(2, "0");
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r;
  let g;
  let b;

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === red) {
      h = ((green - blue) / delta) % 6;
    } else if (max === green) {
      h = (blue - red) / delta + 2;
    } else {
      h = (red - green) / delta + 4;
    }
    h /= 6;
    if (h < 0) {
      h += 1;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

function updateRowColorSwatch(row, colorHex) {
  const swatch = row.querySelector(".account-color-swatch");
  if (!swatch) {
    return;
  }

  swatch.style.backgroundColor = colorHex;
  swatch.title = `Display color: ${colorHex}`;
}

function buildColorWheelImageData() {
  const context = colorWheelCanvas.getContext("2d");
  const imageData = context.createImageData(COLOR_WHEEL_SIZE, COLOR_WHEEL_SIZE);
  const center = COLOR_WHEEL_SIZE / 2;

  for (let y = 0; y < COLOR_WHEEL_SIZE; y += 1) {
    for (let x = 0; x < COLOR_WHEEL_SIZE; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const pixelIndex = (y * COLOR_WHEEL_SIZE + x) * 4;

      if (distance > COLOR_WHEEL_RADIUS) {
        imageData.data[pixelIndex + 3] = 0;
        continue;
      }

      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const hue = angle / (Math.PI * 2);
      const saturation = Math.min(distance / COLOR_WHEEL_RADIUS, 1);
      const rgb = hsvToRgb(hue, saturation, 1);

      imageData.data[pixelIndex] = rgb.r;
      imageData.data[pixelIndex + 1] = rgb.g;
      imageData.data[pixelIndex + 2] = rgb.b;
      imageData.data[pixelIndex + 3] = 255;
    }
  }

  wheelImageData = imageData;
}

function drawColorWheelMarker() {
  const context = colorWheelCanvas.getContext("2d");

  if (!wheelImageData) {
    buildColorWheelImageData();
  }

  context.putImageData(wheelImageData, 0, 0);

  const rgb = hexToRgb(activeColorHex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const center = COLOR_WHEEL_SIZE / 2;
  const markerRadius = Math.min(hsv.s * COLOR_WHEEL_RADIUS, COLOR_WHEEL_RADIUS);
  const angle = hsv.h * Math.PI * 2;
  const markerX = center + Math.cos(angle) * markerRadius;
  const markerY = center + Math.sin(angle) * markerRadius;

  context.beginPath();
  context.arc(markerX, markerY, 6, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.beginPath();
  context.arc(markerX, markerY, 8, 0, Math.PI * 2);
  context.lineWidth = 1;
  context.strokeStyle = "#000000";
  context.stroke();
}

function setActiveModalColor(colorHex) {
  activeColorHex = colorHex;
  colorHexInput.value = colorHex;
  colorPreview.style.backgroundColor = colorHex;
  drawColorWheelMarker();
}

function closeColorPickerModal() {
  const activeElement = document.activeElement;
  const shouldRestoreFocus = activeElement instanceof HTMLElement && colorPickerModal.contains(activeElement);

  if (shouldRestoreFocus) {
    const fallbackRowButton = activeColorRow?.querySelector(".account-color-swatch");
    const returnFocusEl =
      colorModalReturnFocusEl instanceof HTMLElement && document.contains(colorModalReturnFocusEl)
        ? colorModalReturnFocusEl
        : fallbackRowButton;

    if (returnFocusEl instanceof HTMLElement) {
      returnFocusEl.focus();
    }
  }

  colorPickerModal.classList.remove("open");
  colorPickerModal.setAttribute("aria-hidden", "true");
  activeColorRow = null;
  colorModalReturnFocusEl = null;
}

function openColorPickerModal(row) {
  colorModalReturnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeColorRow = row;
  const colorInput = row.querySelector(".account-color");
  const colorHex = normalizeHexColor(colorInput.value) || DEFAULT_NAME_COLOR;

  colorPickerModal.classList.add("open");
  colorPickerModal.setAttribute("aria-hidden", "false");
  setActiveModalColor(colorHex);
  colorHexInput.focus();
  colorHexInput.select();
}

function applyColorFromWheelPosition(clientX, clientY) {
  const rect = colorWheelCanvas.getBoundingClientRect();
  const scaleX = colorWheelCanvas.width / rect.width;
  const scaleY = colorWheelCanvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const center = COLOR_WHEEL_SIZE / 2;
  let dx = x - center;
  let dy = y - center;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > COLOR_WHEEL_RADIUS) {
    const clampedScale = COLOR_WHEEL_RADIUS / distance;
    dx *= clampedScale;
    dy *= clampedScale;
    distance = COLOR_WHEEL_RADIUS;
  }

  const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  const hue = angle / (Math.PI * 2);
  const saturation = Math.min(distance / COLOR_WHEEL_RADIUS, 1);
  const rgb = hsvToRgb(hue, saturation, 1);
  setActiveModalColor(rgbToHex(rgb.r, rgb.g, rgb.b));
}

function initializeColorPicker() {
  colorWheelCanvas.width = COLOR_WHEEL_SIZE;
  colorWheelCanvas.height = COLOR_WHEEL_SIZE;
  buildColorWheelImageData();
  setActiveModalColor(DEFAULT_NAME_COLOR);

  colorWheelCanvas.addEventListener("pointerdown", (event) => {
    wheelPointerDown = true;
    applyColorFromWheelPosition(event.clientX, event.clientY);
  });

  colorWheelCanvas.addEventListener("pointermove", (event) => {
    if (!wheelPointerDown) {
      return;
    }

    applyColorFromWheelPosition(event.clientX, event.clientY);
  });

  const clearPointerState = () => {
    wheelPointerDown = false;
  };

  colorWheelCanvas.addEventListener("pointerup", clearPointerState);
  colorWheelCanvas.addEventListener("pointercancel", clearPointerState);
  colorWheelCanvas.addEventListener("pointerleave", clearPointerState);

  colorHexInput.addEventListener("change", () => {
    const normalized = normalizeHexColor(colorHexInput.value);
    if (!normalized) {
      showStatus("Color must be a 6-digit hex value like #0972d3", "error");
      colorHexInput.value = activeColorHex;
      return;
    }

    setActiveModalColor(normalized);
  });

  colorCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(activeColorHex);
      showStatus(`Copied ${activeColorHex} to clipboard`);
    } catch (_error) {
      showStatus("Unable to copy color to clipboard", "error");
    }
  });

  colorPasteBtn.addEventListener("click", async () => {
    try {
      const pastedText = await navigator.clipboard.readText();
      const normalized = normalizeHexColor(pastedText);

      if (!normalized) {
        showStatus("Clipboard does not contain a valid hex color", "error");
        return;
      }

      setActiveModalColor(normalized);
      showStatus(`Pasted ${normalized}`);
    } catch (_error) {
      showStatus("Unable to read color from clipboard", "error");
    }
  });

  colorApplyBtn.addEventListener("click", () => {
    if (!activeColorRow) {
      closeColorPickerModal();
      return;
    }

    const colorInput = activeColorRow.querySelector(".account-color");
    colorInput.value = activeColorHex;
    updateRowColorSwatch(activeColorRow, activeColorHex);
    closeColorPickerModal();
  });

  colorCancelBtn.addEventListener("click", closeColorPickerModal);

  colorPickerModal.addEventListener("click", (event) => {
    if (event.target === colorPickerModal) {
      closeColorPickerModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && colorPickerModal.classList.contains("open")) {
      closeColorPickerModal();
    }
  });
}

/** Show a status message that auto-hides after 3 seconds */
function showStatus(message, type = "success") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  clearTimeout(statusEl._timeout);
  statusEl._timeout = setTimeout(() => {
    statusEl.className = "status";
  }, 3000);
}

/** Create a single mapping row in the UI */
function createRow(accountId = "", name = "", color = DEFAULT_NAME_COLOR, hidden = false) {
  const row = document.createElement("div");
  row.className = "mapping-row";

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.className = "account-id";
  idInput.placeholder = "Account ID";
  idInput.value = accountId;
  idInput.maxLength = 12;
  idInput.pattern = "\\d{12}";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "account-name";
  nameInput.placeholder = "Friendly name";
  nameInput.value = name;
  nameInput.maxLength = MAX_FRIENDLY_NAME_LENGTH;

  const colorInput = document.createElement("input");
  colorInput.type = "hidden";
  colorInput.className = "account-color";
  colorInput.value = HEX_COLOR_RE.test(color) ? color : DEFAULT_NAME_COLOR;

  const colorButton = document.createElement("button");
  colorButton.type = "button";
  colorButton.className = "account-color-swatch";
  colorButton.textContent = "Color";
  colorButton.style.backgroundColor = colorInput.value;
  colorButton.title = `Display color: ${colorInput.value}`;
  colorButton.addEventListener("click", () => openColorPickerModal(row));

  const hiddenLabel = document.createElement("label");
  hiddenLabel.className = "account-hidden-label";

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "checkbox";
  hiddenInput.className = "account-hidden";
  hiddenInput.checked = hidden;
  hiddenInput.title = "Hide this account by default";

  const hiddenText = document.createElement("span");
  hiddenText.textContent = "Hide";

  hiddenLabel.appendChild(hiddenInput);
  hiddenLabel.appendChild(hiddenText);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-row-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(idInput);
  row.appendChild(nameInput);
  row.appendChild(colorButton);
  row.appendChild(colorInput);
  row.appendChild(hiddenLabel);
  row.appendChild(removeBtn);
  mappingsList.appendChild(row);
}

/** Read all mapping rows from the UI into an object */
function readMappingsFromUI() {
  const mappings = {};
  const rows = mappingsList.querySelectorAll(".mapping-row");
  for (const row of rows) {
    const id = row.querySelector(".account-id").value.trim();
    const name = row.querySelector(".account-name").value.trim();
    const color = row.querySelector(".account-color").value;
    const hidden = row.querySelector(".account-hidden").checked;
    if (id && name) {
      if (!/^\d{12}$/.test(id)) {
        throw new Error(`Invalid account ID "${id}" - must be exactly 12 digits`);
      }
      validateFriendlyName(name, `Friendly name for ${id}`);
      validateColor(color, `Color for ${id}`);
      mappings[id] = {
        name,
        color,
        hidden,
      };
    }
  }
  return mappings;
}

/** Load saved mappings from storage and populate the UI */
function loadMappings() {
  chrome.storage.local.get({ accountMappings: {} }, (result) => {
    mappingsList.innerHTML = "";
    const mappings = result.accountMappings || {};
    const entries = Object.entries(mappings);

    // Sort by account ID for consistent display
    entries.sort(([a], [b]) => a.localeCompare(b));

    for (const [id, mappingEntry] of entries) {
      const name = typeof mappingEntry === "string" ? mappingEntry : mappingEntry?.name || "";
      const color =
        typeof mappingEntry === "string" ? DEFAULT_NAME_COLOR : mappingEntry?.color || DEFAULT_NAME_COLOR;
      const hidden = typeof mappingEntry === "string" ? false : mappingEntry?.hidden === true;
      createRow(id, name, color, hidden);
    }
  });
}

/** Save mappings to storage */
function saveMappings() {
  try {
    const mappings = readMappingsFromUI();
    chrome.storage.local.set({ accountMappings: mappings }, () => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
      } else {
        showStatus(`Saved ${Object.keys(mappings).length} mapping(s)`);
      }
    });
  } catch (e) {
    showStatus(e.message, "error");
  }
}

/** Parse bulk text into mappings object */
function parseBulkText(text) {
  const mappings = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Support formats: "id = name", "id,name", "id\tname"
    const match = trimmed.match(/^(\d{12})\s*[=,\t]\s*(.+)$/);
    if (match) {
      const accountId = match[1];
      const friendlyName = match[2].trim();
      validateFriendlyName(friendlyName, `Friendly name for ${accountId} on line ${i + 1}`);
      mappings[accountId] = {
        name: friendlyName,
        color: DEFAULT_NAME_COLOR,
        hidden: false,
      };
    }
  }
  return mappings;
}

/** Export current mappings to bulk text format */
function exportMappings() {
  chrome.storage.local.get({ accountMappings: {} }, (result) => {
    const mappings = result.accountMappings || {};
    const entries = Object.entries(mappings);
    entries.sort(([a], [b]) => a.localeCompare(b));
    const text = entries
      .map(([id, mappingEntry]) => {
        const name = typeof mappingEntry === "string" ? mappingEntry : mappingEntry?.name || "";
        return `${id} = ${name}`;
      })
      .join("\n");
    document.getElementById("bulk-text").value = text;
    showStatus(`Exported ${entries.length} mapping(s)`);
  });
}

/** Import mappings from bulk text (merges with existing) */
function importMappings() {
  const text = document.getElementById("bulk-text").value;
  let newMappings;

  try {
    newMappings = parseBulkText(text);
  } catch (e) {
    showStatus(e.message, "error");
    return;
  }

  const count = Object.keys(newMappings).length;

  if (count === 0) {
    showStatus("No valid mappings found in text", "error");
    return;
  }

  chrome.storage.local.get({ accountMappings: {} }, (result) => {
    const existingMappings = result.accountMappings || {};
    const merged = { ...existingMappings, ...newMappings };
    chrome.storage.local.set({ accountMappings: merged }, () => {
      if (chrome.runtime.lastError) {
        showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
      } else {
        showStatus(`Imported ${count} mapping(s) (${Object.keys(merged).length} total)`);
        loadMappings();
      }
    });
  });
}

// Event listeners
document.getElementById("add-row").addEventListener("click", () => createRow());
document.getElementById("save").addEventListener("click", saveMappings);
document.getElementById("bulk-import").addEventListener("click", importMappings);
document.getElementById("bulk-export").addEventListener("click", exportMappings);

// Initial load
initializeColorPicker();
loadMappings();
