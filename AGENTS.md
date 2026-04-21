# AGENTS.md — AWS Portal Account Names

A Chrome extension that injects friendly account names into the AWS SSO access portal
(`https://*.awsapps.com/start/*`). The portal lists accounts by their auto-generated
alias and 12-digit ID only; this extension overlays a human-readable name next to each
alias based on a user-configured mapping.

---

## Repository layout

```
aws-portal-account-names/
├── manifest.json          Chrome MV3 extension manifest
├── content.js             Content script — DOM injection logic
├── options.html           Settings page markup
├── options.js             Settings page logic
├── popup.html             Toolbar popup markup
├── popup.js               Toolbar popup logic
├── icons/
│   ├── icon16.png         Toolbar icon (16×16)
│   ├── icon48.png         Extensions-page icon (48×48)
│   └── icon128.png        Chrome Web Store icon (128×128)
└── portal-page-html/                        ⚠ NOT COMMITTED — see note below
    └── Accounts _ AWS access portal.html   Saved HTML snapshot of the target page
                                             (reference only — used to reverse-engineer
                                             the DOM structure; not part of the extension)
```

There is no build step, bundler, package manager, or transpilation. Every file is
loaded by Chrome directly as-is.

> **`portal-page-html/` is not committed to the repository.** The directory and its
> HTML snapshot are excluded from version control because they contain account IDs,
> email addresses, and other personally identifiable information from a real AWS
> environment.
>
> If you need the snapshot (e.g., to debug a broken DOM traversal after an AWS portal
> update), ask the user to regenerate it:
>
> 1. Log in and navigate to `https://d-XXXXXXXX.awsapps.com/start/#/`
>    so the full account list is visible.
> 2. Open the Chrome menu (⋮) → **Save and share** → **Save page as…**
> 3. In the save dialog, set the format to **Webpage, HTML Only** (`.html`, not
>    "Complete" — the complete format saves a folder of assets that are not needed).
> 4. Save the file into `portal-page-html/Accounts _ AWS access portal.html` inside
>    this repository directory.
>
> The file only needs to exist locally while debugging; do not commit it.

---

## Goals and non-goals

**Goals**
- Display a configurable friendly name next to each AWS account alias on the portal page
- Zero-friction UX: names appear automatically on page load with no user action required
- Mappings survive browser restarts and stay on-device via `chrome.storage.local`
- Settings page supports both row-by-row editing and bulk import/export

**Non-goals**
- No network requests; the extension never calls any external API
- No background service worker; all logic runs in the content script or extension pages
- No modification of the portal's own data or requests

---

## Architecture

The extension has three independent contexts that communicate only through
`chrome.storage.local`:

```
┌─────────────────────────────────┐     chrome.storage.local
│  Options page (options.html/js) │ ──────────────────────────┐
└─────────────────────────────────┘                           │
                                                              ▼
┌─────────────────────────────────┐     chrome.storage.local │
│  Popup (popup.html/js)          │ ──────────────────────────┤ { accountMappings: {...} }
└─────────────────────────────────┘                           │
                                                              │
┌─────────────────────────────────┐                           │
│  Content script (content.js)    │ ◄─────────────────────────┘
│  Runs inside the portal tab     │   reads on load + listens
└─────────────────────────────────┘   for storage changes
```

### content.js

The core of the extension. Injected into every page matching
`https://*.awsapps.com/start/*` at `document_idle`.

**Entry points:** `handlePotentialViewUpdate()` and `injectAccountNames()`.

- `ensureObserverStarted()` is called once at startup.
- `handlePotentialViewUpdate()` runs at startup, on `hashchange`, and after DOM
  mutations (debounced).

**Flow:**

1. Determine whether the current hash route is the Accounts view by parsing
   `location.hash`.
   - Accounts routes include `#/`, `#`, and `#/?tab=accounts`.
   - Non-Accounts routes include `#/?tab=applications` and `#/preferences`.
2. If on Accounts view:
   - call `injectAccountNames()` immediately, and
   - debounce observer-triggered reinjection (150 ms) so bursts of React mutations
     coalesce into a single pass.
3. If not on Accounts view, clear pending debounce timers and remove previously
   injected tags.
4. Listen on `hashchange` to toggle the behavior above as the SPA navigates between
   tabs.
5. Listen on `chrome.storage.onChanged` — if the user saves new mappings in the
   options page, update the in-memory mapping cache; only clear/reinject immediately
   when currently on Accounts view.
6. Guard against concurrent runs: while an injection pass is in-flight, additional
   requests set a flag so exactly one follow-up pass runs after the current pass.

The observer itself starts once and remains active for SPA updates:
- `ensureObserverStarted()` attaches a single `MutationObserver` on `document.body`
  (`childList + subtree`).

**`injectAccountNames()` algorithm:**

1. Exit early unless the current hash route resolves to the Accounts view.
2. Load `accountMappings` from `chrome.storage.local` once, then reuse an in-memory
   cache for subsequent passes.
3. Inject using **table/treegrid layout** selectors first:
   - Iterate `<tr>` rows.
   - Locate alias in row header (`th[scope="row"]`) via
     `[data-testid="account-list-cell"]`.
   - Find account ID in row data cells by matching `/^\d{12}$/`.
   - Append `<span class="aws-portal-account-name-tag">` to the alias element.
4. Inject using **legacy card layout** selectors as a fallback:
   - Find `<span>` with `/^\d{12}$/`.
   - Traverse through `<p>` and shared container to `<strong>` alias span.
   - Insert a name tag after the alias span.
5. In both paths, use `data-account-name-injected` on the alias element/span to
   prevent duplicate injection.

**De-duplication marker:** `data-account-name-injected` on the alias span.
**Injected element class:** `aws-portal-account-name-tag` (used for cleanup on re-inject).

### options.html / options.js

A full extension options page (`chrome_url_overrides` is not used; this is the
standard `options_page` entry in the manifest).

Features:
- **Row editor** — each mapping is a row with an account ID input (monospace, max 12
  chars, pattern `\d{12}`) and a name input (`maxlength=120`), plus a Remove button.
  Rows are sorted by account ID on load.
- **Save button** — reads all rows via `readMappingsFromUI()`, validates each ID with
  `/^\d{12}$/` and each name length (`<= 120`), then writes the entire
  `accountMappings` object to storage. Replaces (does not merge) the stored value.
- **Bulk import** — parses the textarea. Accepts `id = name`, `id,name`, or `id\tname`
  per line. Lines starting with `#` are treated as comments. Import validates name
  length (`<= 120`) and merges into the existing stored mappings (new keys win on
  conflict).
- **Bulk export** — writes the stored mappings to the textarea in `id = name` format,
  sorted by account ID.
- **Status bar** — auto-hides after 3 seconds; shows green on success, red on error.

### popup.html / popup.js

A minimal 320px-wide popup attached to the toolbar button.

- Reads `accountMappings` from storage and displays the count.
- **Open Settings** button calls `chrome.runtime.openOptionsPage()`.

---

## Target page DOM structure

The AWS portal uses AWS UI (CloudScape) React components. Class names contain a stable
semantic segment followed by a hash suffix that **may change** when AWS updates the
portal (e.g., `awsui_child_18582_whr0e_149`). The content script does **not** rely on
class names; it navigates by tag name and DOM position only.

### Current layout (observed live)

Each account entry renders as a table/treegrid row:

```
<tr>
  <th scope="row">                        ← alias cell
    ...
    <div data-testid="account-list-cell">
      cp-aws-xxxxxxxxxxxx                  ← account alias — we inject here
    </div>
  </th>
  <td>                                     ← account ID cell
    ...
    <span>123456789012</span>              ← 12-digit account ID
  </td>
  <td>
    <span>alias@example.org</span>
  </td>
</tr>
```

**Key traversal (current layout):**

```
tr
  → row.querySelector("th[scope='row'], th")
  → headerCell.querySelector("[data-testid='account-list-cell']")  = alias element
  → row.querySelectorAll("td span, td div, td") and match /^\d{12}$/ = account ID
```

### Legacy layout (still supported)

Older portal builds used this card-like structure:

```
<button>
  ...
  <div class="awsui_vertical_...">            ← shared container (2 levels above <p>)
    <div class="awsui_child_...">             ← child wrapper 1
      <strong>
        <div class="awsui_horizontal_s_...">
          <div class="awsui_child_...">
            <div>
              <span>cp-aws-xxxxxxxxxxxx</span>  ← account alias — we inject here
            </div>
          </div>
        </div>
      </strong>
    </div>
    <div class="awsui_child_...">             ← child wrapper 2
      <p>
        <div class="awsui_horizontal_xxs_...">
          <div class="awsui_child_...">
            <div>
              <span>123456789012</span>          ← 12-digit account ID — our anchor
            </div>
          </div>
          <div><div> | </div></div>
          <div class="awsui_child_...">
            <div>
              <span>alias@example.org</span>
            </div>
          </div>
        </div>
      </p>
    </div>
  </div>
</button>
```

**Key traversal (legacy layout):**

```
span (account ID)
  → span.closest("p")                    = the <p> element
  → p.parentElement                      = child wrapper 2 (div.awsui_child)
  → p.parentElement.parentElement        = shared container (div.awsui_vertical)
  → container.querySelector("strong")    = the alias <strong>
  → strong.querySelector("span")         = the alias <span>
```

Going only one level up from `<p>` (the original legacy bug) lands on child wrapper 2,
which does not contain `<strong>`, causing `querySelector("strong")` to return null.

The saved HTML snapshot in `portal-page-html/` can be used to re-verify this
structure if the traversal breaks after an AWS portal update.

---

## Storage schema

One key is stored in `chrome.storage.local`:

```json
{
  "accountMappings": {
    "111122223333": "my-production-account",
    "444455556666": "my-dev-account"
  }
}
```

`chrome.storage.local` has a much higher practical capacity than sync storage for this
use case. Each mapping entry is roughly 30–80 bytes, so the extension can comfortably
hold hundreds (or more) mappings without approaching limits in normal use.

---

## Permissions

| Permission | Declared | Used by | Purpose |
|---|---|---|---|
| `storage` | yes | content.js, options.js, popup.js | Read/write account mappings |

---

## Known fragility: AWS portal DOM changes

The content script supports both current table/treegrid and legacy card layouts, but
the AWS portal is a React SPA using CloudScape components and can change structure at
any time. If injection stops working, the most likely cause is either:

- a route behavior change (Accounts no longer at `#/` or `#/?tab=accounts`), or
- a DOM shape change in either row/header/cell or legacy `<p>/<strong>` traversal.

**Debugging steps:**
1. Open DevTools on the portal page → Console tab.
2. Confirm route detection by checking `location.hash` on the Accounts view.
3. Inspect one account row and verify:
   - alias is reachable from a row header (`th[scope='row']`) and
     `[data-testid='account-list-cell']`, and
   - account ID remains detectable as a 12-digit text node in row data cells.
4. If current row traversal fails, inspect whether the legacy `<p>/<strong>` path is
   present and still valid.
5. Update traversal logic in `content.js`, then update this file and the `content.js`
   header comment.
