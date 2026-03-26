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
> 1. Log in and navigate to `https://d-XXXXXXXX.awsapps.com/start/#/?tab=accounts`
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

**Entry point:** `observeAndInject()` — called once at the bottom of the file.

**Flow:**

1. Call `injectAccountNames()` immediately.
2. Attach a `MutationObserver` on `document.body` (childList + subtree) to re-run
   `injectAccountNames()` whenever the DOM changes. This is necessary because the
   portal is a React SPA; accounts are rendered after the initial page load and the
   account list can be filtered/re-rendered dynamically.
3. Listen on `chrome.storage.onChanged` — if the user saves new mappings in the
   options page while the portal tab is open, strip all previously injected tags and
   run `injectAccountNames()` again with fresh data.

**`injectAccountNames()` algorithm:**

1. Fetch `accountMappings` from `chrome.storage.local`. Return early if empty.
2. Query all `<span>` elements on the page.
3. For each span whose trimmed text matches `/^\d{12}$/` (a 12-digit AWS account ID):
   - Look up the ID in the mappings object.
   - If no mapping exists for this ID, skip it.
   - Walk up the DOM to find the shared vertical container (see DOM structure below).
   - Find the `<strong>` element inside that container, which holds the account alias span.
   - If the alias span already has `data-account-name-injected` attribute, skip (prevents
     duplicate injection across MutationObserver callbacks).
   - Set `data-account-name-injected="true"` on the alias span as the de-duplication marker.
   - Insert a new `<span class="aws-portal-account-name-tag">` immediately after the alias
     span using `aliasSpan.after(nameTag)`.

**De-duplication marker:** `data-account-name-injected` on the alias span.
**Injected element class:** `aws-portal-account-name-tag` (used for cleanup on re-inject).

### options.html / options.js

A full extension options page (`chrome_url_overrides` is not used; this is the
standard `options_page` entry in the manifest).

Features:
- **Row editor** — each mapping is a row with an account ID input (monospace, max 12
  chars, pattern `\d{12}`) and a free-text name input, plus a Remove button.
  Rows are sorted by account ID on load.
- **Save button** — reads all rows via `readMappingsFromUI()`, validates each ID with
  `/^\d{12}$/`, then writes the entire `accountMappings` object to storage. Replaces
  (does not merge) the stored value.
- **Bulk import** — parses the textarea. Accepts `id = name`, `id,name`, or `id\tname`
  per line. Lines starting with `#` are treated as comments. Import *merges* into the
  existing stored mappings (new keys win on conflict).
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

Each account entry renders as:

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

**Key traversal (content.js:88–93):**

```
span (account ID)
  → span.closest("p")                    = the <p> element
  → p.parentElement                      = child wrapper 2 (div.awsui_child)
  → p.parentElement.parentElement        = shared container (div.awsui_vertical)
  → container.querySelector("strong")    = the alias <strong>
  → strong.querySelector("span")         = the alias <span>
```

Going only one level up from `<p>` (the original bug) landed on child wrapper 2,
which does not contain `<strong>`, causing `querySelector("strong")` to return null
and silently skip every account.

The saved HTML snapshot in `portal-page-html/` can be used to re-verify this
structure if the traversal breaks after an AWS portal update.

---

## Storage schema

One key is stored in `chrome.storage.local`:

```json
{
  "accountMappings": {
    "123456789012": "my-production-account",
    "987654321098": "my-dev-account"
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

The content script's traversal is based on the DOM structure observed in the saved
HTML snapshot and confirmed working as of the extension's creation. The AWS portal is
a React SPA using CloudScape components. If AWS updates the portal and the injection
stops working, the most likely cause is a change to the nesting depth between `<p>`
and the shared vertical container.

**Debugging steps:**
1. Open DevTools on the portal page → Console tab.
2. Run: `document.querySelectorAll("span")` and spot the account ID spans to confirm
   they are still plain `<span>` elements with only the ID as text content.
3. Click one of the account rows, inspect the element, and trace the path from the
   account ID `<span>` up to the nearest `<strong>`. Count the levels between `<p>`
   and their shared ancestor. Update the traversal in `content.js` accordingly.
4. Update the DOM diagram in this file and in the `content.js` header comment.
