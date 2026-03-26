/**
 * AWS Portal Account Names - Popup Script
 */

// Show mapping count
chrome.storage.local.get({ accountMappings: {} }, (result) => {
  const mappings = result.accountMappings || {};
  const count = Object.keys(mappings).length;
  document.getElementById("count").textContent = count;
});

// Open settings page
document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
