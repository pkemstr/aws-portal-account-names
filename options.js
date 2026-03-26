/**
 * AWS Portal Account Names - Options Page Script
 *
 * Manages the UI for configuring account ID -> friendly name mappings.
 * Supports individual row editing and bulk import/export.
 */

const mappingsList = document.getElementById("mappings-list");
const statusEl = document.getElementById("status");

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
function createRow(accountId = "", name = "") {
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

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(idInput);
  row.appendChild(nameInput);
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
    if (id && name) {
      if (!/^\d{12}$/.test(id)) {
        throw new Error(`Invalid account ID "${id}" - must be exactly 12 digits`);
      }
      mappings[id] = name;
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

    for (const [id, name] of entries) {
      createRow(id, name);
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
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Support formats: "id = name", "id,name", "id\tname"
    const match = trimmed.match(/^(\d{12})\s*[=,\t]\s*(.+)$/);
    if (match) {
      mappings[match[1]] = match[2].trim();
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
    const text = entries.map(([id, name]) => `${id} = ${name}`).join("\n");
    document.getElementById("bulk-text").value = text;
    showStatus(`Exported ${entries.length} mapping(s)`);
  });
}

/** Import mappings from bulk text (merges with existing) */
function importMappings() {
  const text = document.getElementById("bulk-text").value;
  const newMappings = parseBulkText(text);
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
loadMappings();
