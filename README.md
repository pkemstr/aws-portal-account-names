# AWS Portal Account Names

A Chrome extension that adds friendly names to your AWS SSO access portal so you can tell your accounts apart at a glance.

## The problem

The AWS access portal lists your accounts like this:

> **cp-aws-9z0kh6bqbvno81khsiwz**
> 980921727418 | cp-aws-9z0kh6bqbvno81khsiwz@example.org

When you have six accounts that all look like that, it's hard to know which one to click.

## What this extension does

It reads a mapping of account IDs to names that you configure, then injects the friendly name directly into the page next to each account alias:

> **cp-aws-9z0kh6bqbvno81khsiwz (my-production-account)**
> 980921727418 | cp-aws-9z0kh6bqbvno81khsiwz@example.org

Names appear automatically every time you load the portal — no extra clicks required.

## How it works

The extension runs a content script on `*.awsapps.com/start/*`, but it only activates
its injection behavior when the portal hash route is on the Accounts tab
(`tab=accounts`). When active, the script:

1. Reads your configured mappings from local Chrome extension storage
2. Scans the page for spans containing 12-digit AWS account IDs
3. Walks up the DOM to find the account alias element sitting above each ID
4. Injects the friendly name in parentheses right after the alias

Because the portal is a React single-page app that renders content dynamically, the script watches for DOM changes via a `MutationObserver` and re-runs injection whenever the account list updates (e.g. after filtering). If you update your mappings while the portal tab is open, the page updates immediately without a reload.

The script also listens for hash-route changes. Entering the Accounts tab starts observation and injection; leaving that tab disconnects the observer and removes previously injected name tags.

To reduce unnecessary work on React-heavy updates, observer-triggered passes are debounced and coalesced. The content script also caches mappings in memory after first load and refreshes that cache only when `chrome.storage.local` changes.

Your mappings are stored in `chrome.storage.local`, so they persist across browser restarts on the same device and are not synced to other devices.

See `PRIVACY_POLICY.md` for full privacy details.

## Installation

There is no build step. Load the extension directly from the source folder.

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked** and select the repository folder
5. The extension icon will appear in your toolbar

## Configuration

Before the extension can label anything, you need to tell it which account IDs map to which names.

1. Click the extension icon in the toolbar
2. Click **Open Settings**
3. Add your mappings — one account ID and one name per row
4. Click **Save**

Friendly names are limited to 120 characters.

You can also bulk-import mappings by pasting into the import box using the format:

```
111122223333 = example-production-account
444455556666 = example-dev-account
```

Lines starting with `#` are treated as comments and ignored. The importer also accepts comma-separated (`id,name`) and tab-separated (`id\tname`) formats.

To back up or copy your mappings to another machine, use the **Export** button to dump them as text, then paste into the import box on the other machine.

## After making changes

If you edit any source file, reload the extension before testing:

1. Go to `chrome://extensions/`
2. Click the refresh icon on the **AWS Portal Account Names** card
3. Hard-reload the portal tab
