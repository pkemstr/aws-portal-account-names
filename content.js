/**
 * AWS Portal Account Names - Content Script
 *
 * Scans the AWS SSO portal page for account entries and appends
 * friendly names based on user-configured account ID -> name mappings.
 *
 * The portal DOM structure per account (from the live page):
 *
 *   <button>
 *     ...
 *     <div class="awsui_vertical_...">              <-- shared container
 *       <div class="awsui_child_...">               <-- child wrapper 1
 *         <strong>
 *           <div class="awsui_horizontal_s_...">
 *             <div class="awsui_child_...">
 *               <div><span>{account-alias}</span></div>  <-- append name here
 *             </div>
 *           </div>
 *         </strong>
 *       </div>
 *       <div class="awsui_child_...">               <-- child wrapper 2
 *         <p>
 *           <div class="awsui_horizontal_xxs_...">
 *             <div class="awsui_child_...">
 *               <div><span>{12-digit-id}</span></div>  <-- we find this
 *             </div>
 *             <div>...</div>  (pipe separator)
 *             <div>...</div>  (email)
 *           </div>
 *         </p>
 *       </div>
 *     </div>
 *   </button>
 */

const MARKER_ATTR = "data-account-name-injected";
const REINJECT_DEBOUNCE_MS = 150;

let cachedMappings = {};
let mappingsLoaded = false;
let injectInFlight = false;
let injectRequestedWhileRunning = false;
let debounceTimerId = null;
let observer = null;

function isAccountsView() {
  const rawHash = window.location.hash || "";
  const hashWithoutPound = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const queryStartIndex = hashWithoutPound.indexOf("?");

  if (queryStartIndex === -1) {
    return false;
  }

  const query = hashWithoutPound.slice(queryStartIndex + 1);
  const params = new URLSearchParams(query);
  return params.get("tab") === "accounts";
}

/**
 * Retrieve the account mappings from chrome.storage.local.
 * Returns an object like { "123456789012": "my-friendly-name", ... }
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

function injectAccountNamesFromCache() {
  if (!cachedMappings || Object.keys(cachedMappings).length === 0) {
    return;
  }

  // Find all <span> elements and filter to those containing a 12-digit account ID
  const allSpans = document.querySelectorAll("span");

  for (const span of allSpans) {
    const text = span.textContent.trim();

    // Match a 12-digit AWS account ID
    if (!/^\d{12}$/.test(text)) {
      continue;
    }

    const accountId = text;
    const friendlyName = cachedMappings[accountId];

    if (!friendlyName) {
      continue;
    }

    // Navigate up to the shared container that holds both the alias and the ID.
    //
    // From the account ID <span>, the path upward is:
    //   span > div > div.child > div.horizontal > p > div.child > div.vertical
    //
    // The <p> wrapping the ID line and the <strong> wrapping the alias
    // are each inside their own <div class="awsui_child_..."> wrapper.
    // Both wrappers are children of a shared <div class="awsui_vertical_...">.
    // So from <p> we must go up TWO levels to reach the shared container.
    const pElement = span.closest("p");
    if (!pElement) continue;

    // p -> div.child (wrapper) -> div.vertical (shared container)
    const container = pElement.parentElement?.parentElement;
    if (!container) continue;

    const strongElement = container.querySelector("strong");
    if (!strongElement) continue;

    // The alias span is inside: <strong> > div.horizontal > div.child > div > span
    const aliasSpan = strongElement.querySelector("span");
    if (!aliasSpan) continue;

    // Avoid injecting twice
    if (aliasSpan.hasAttribute(MARKER_ATTR)) continue;
    aliasSpan.setAttribute(MARKER_ATTR, "true");

    // Append the friendly name next to the alias text.
    // Insert into the same <div> as the alias span so it flows inline.
    const nameTag = document.createElement("span");
    nameTag.className = "aws-portal-account-name-tag";
    nameTag.textContent = ` (${friendlyName})`;
    nameTag.style.cssText =
      "color: #0972d3; font-weight: bold;";

    // aliasSpan is inside <div><span>alias</span></div>
    // Append to the same parent div so it appears right after the alias
    aliasSpan.after(nameTag);
  }
}

/**
 * Find all 12-digit account ID spans on the page and inject
 * the friendly name into the associated account alias element.
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
 * The AWS portal is a single-page app that loads account tiles dynamically.
 * We use a MutationObserver to re-run injection whenever the DOM changes.
 */
function startObserverAndInject() {
  if (observer) {
    scheduleInjectAccountNames();
    return;
  }

  injectAccountNames();

  observer = new MutationObserver(() => {
    scheduleInjectAccountNames();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopObserverAndCleanup() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (debounceTimerId !== null) {
    clearTimeout(debounceTimerId);
    debounceTimerId = null;
  }

  clearInjectedAccountNames();
}

function updateInjectionForCurrentView() {
  if (isAccountsView()) {
    startObserverAndInject();
  } else {
    stopObserverAndCleanup();
  }
}

// Also re-inject when the user updates mappings from the options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.accountMappings) {
    cachedMappings = changes.accountMappings.newValue || {};
    mappingsLoaded = true;

    if (!isAccountsView()) {
      return;
    }

    // Remove existing injected tags so they get re-created with new names
    clearInjectedAccountNames();
    scheduleInjectAccountNames();
  }
});

// Start
updateInjectionForCurrentView();
window.addEventListener("hashchange", updateInjectionForCurrentView);
