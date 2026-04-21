/**
 * AWS Portal Account Names - Content Script
 *
 * Scans the AWS SSO portal page for account entries and appends
 * friendly names based on user-configured account ID -> name mappings.
 *
 * The portal has used two account-list layouts:
 *
 * 1) Current layout (table/treegrid):
 *      tr
 *       - th[scope="row"] contains account alias
 *       - td contains account ID and email
 *
 * 2) Legacy layout (card-like):
 *      button > div.awsui_vertical_...
 *       - <strong> branch contains alias
 *       - <p> branch contains account ID
 *
 * We support both layouts to stay resilient across AWS portal updates.
 */

const MARKER_ATTR = "data-account-name-injected";
const REINJECT_DEBOUNCE_MS = 150;
const ACCOUNT_ID_RE = /^\d{12}$/;

let cachedMappings = {};
let mappingsLoaded = false;
let injectInFlight = false;
let injectRequestedWhileRunning = false;
let debounceTimerId = null;
let observer = null;
let wasAccountsView = null;

function isAccountsView() {
  const rawHash = window.location.hash || "";
  const hashWithoutPound = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const queryStartIndex = hashWithoutPound.indexOf("?");

  if (queryStartIndex === -1) {
    const route = hashWithoutPound;
    return route === "/" || route === "";
  }

  const route = hashWithoutPound.slice(0, queryStartIndex);
  const query = hashWithoutPound.slice(queryStartIndex + 1);
  const params = new URLSearchParams(query);
  const tab = params.get("tab");

  if (tab === "accounts") {
    return true;
  }

  if (!tab) {
    return route === "/" || route === "";
  }

  return false;
}

/**
 * Retrieve the account mappings from chrome.storage.local.
 * Returns an object like { "111122223333": "my-friendly-name", ... }
 */
function getAccountMappings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ accountMappings: {} }, (result) => {
      resolve(result.accountMappings || {});
    });
  });
}

async function ensureMappingsLoaded() {
  if (mappingsLoaded) {
    return;
  }

  cachedMappings = await getAccountMappings();
  mappingsLoaded = true;
}

function clearInjectedAccountNames() {
  document.querySelectorAll(".aws-portal-account-name-tag").forEach((el) => el.remove());
  document.querySelectorAll(`[${MARKER_ATTR}]`).forEach((el) => el.removeAttribute(MARKER_ATTR));
}

function createNameTag(friendlyName) {
  const nameTag = document.createElement("span");
  nameTag.className = "aws-portal-account-name-tag";
  nameTag.textContent = ` (${friendlyName})`;
  nameTag.style.cssText = "color: #0972d3; font-weight: bold;";
  return nameTag;
}

function injectAccountNamesForTableLayout() {
  const rows = document.querySelectorAll("tr");

  for (const row of rows) {
    const headerCell = row.querySelector("th[scope='row'], th");
    if (!headerCell) {
      continue;
    }

    const idCandidateElements = row.querySelectorAll("td span, td div, td");
    let accountId = null;

    for (const candidate of idCandidateElements) {
      const text = candidate.textContent.trim();
      if (ACCOUNT_ID_RE.test(text)) {
        accountId = text;
        break;
      }
    }

    if (!accountId) {
      continue;
    }

    const friendlyName = cachedMappings[accountId];
    if (!friendlyName) {
      continue;
    }

    const aliasElement =
      headerCell.querySelector("[data-testid='account-list-cell']") ||
      headerCell.querySelector("span, strong, div");

    if (!aliasElement) {
      continue;
    }

    if (aliasElement.hasAttribute(MARKER_ATTR)) {
      continue;
    }
    aliasElement.setAttribute(MARKER_ATTR, "true");

    aliasElement.appendChild(createNameTag(friendlyName));
  }
}

function injectAccountNamesForLegacyCardLayout() {
  const allSpans = document.querySelectorAll("span");

  for (const span of allSpans) {
    const text = span.textContent.trim();
    if (!ACCOUNT_ID_RE.test(text)) {
      continue;
    }

    const accountId = text;
    const friendlyName = cachedMappings[accountId];

    if (!friendlyName) {
      continue;
    }

    const pElement = span.closest("p");
    if (!pElement) continue;

    const container = pElement.parentElement?.parentElement;
    if (!container) continue;

    const strongElement = container.querySelector("strong");
    if (!strongElement) continue;

    const aliasSpan = strongElement.querySelector("span");
    if (!aliasSpan) continue;

    if (aliasSpan.hasAttribute(MARKER_ATTR)) continue;
    aliasSpan.setAttribute(MARKER_ATTR, "true");

    aliasSpan.after(createNameTag(friendlyName));
  }
}

function injectAccountNamesFromCache() {
  if (!cachedMappings || Object.keys(cachedMappings).length === 0) {
    return;
  }

  injectAccountNamesForTableLayout();
  injectAccountNamesForLegacyCardLayout();
}

/**
 * Inject friendly names for account IDs in the current Accounts view.
 * Supports both current table/treegrid rows and legacy card layout.
 */
async function injectAccountNames() {
  if (!isAccountsView()) {
    return;
  }

  if (injectInFlight) {
    injectRequestedWhileRunning = true;
    return;
  }

  injectInFlight = true;

  try {
    await ensureMappingsLoaded();

    do {
      injectRequestedWhileRunning = false;
      injectAccountNamesFromCache();
    } while (injectRequestedWhileRunning);
  } finally {
    injectInFlight = false;
  }
}

function scheduleInjectAccountNames() {
  if (debounceTimerId !== null) {
    clearTimeout(debounceTimerId);
  }

  debounceTimerId = setTimeout(() => {
    debounceTimerId = null;
    injectAccountNames();
  }, REINJECT_DEBOUNCE_MS);
}

/**
 * The AWS portal is a React SPA that updates the account list dynamically.
 * Keep one observer active and debounce reinjection on mutation bursts.
 */
function ensureObserverStarted() {
  if (observer) {
    return;
  }

  const observerTarget = document.body || document.documentElement;
  if (!observerTarget) {
    return;
  }

  observer = new MutationObserver(() => {
    handlePotentialViewUpdate();
  });

  observer.observe(observerTarget, {
    childList: true,
    subtree: true,
  });
}

function handlePotentialViewUpdate() {
  const onAccountsView = isAccountsView();

  if (onAccountsView !== wasAccountsView) {
    wasAccountsView = onAccountsView;

    if (!onAccountsView) {
      if (debounceTimerId !== null) {
        clearTimeout(debounceTimerId);
        debounceTimerId = null;
      }

      clearInjectedAccountNames();
      return;
    }
  }

  if (onAccountsView) {
    scheduleInjectAccountNames();
  }
}

// Re-inject when mappings are updated in extension storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.accountMappings) {
    cachedMappings = changes.accountMappings.newValue || {};
    mappingsLoaded = true;

    if (!isAccountsView()) {
      return;
    }

    // Replace any existing injected tags with updated names.
    clearInjectedAccountNames();
    scheduleInjectAccountNames();
  }
});

// Initialize route handling and observer wiring.
ensureObserverStarted();
handlePotentialViewUpdate();
window.addEventListener("hashchange", handlePotentialViewUpdate);
