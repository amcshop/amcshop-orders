# CLAUDE.md

Guidance for Claude Code in GS2Preorder repositories. This file is common to every one of them: the lite starter, the pro starter and every shop repo, which all share it through `git pull`.

## Where the notes are

Read each of these that exists in this repo:

- `CLAUDE.md` (this file): what's common to every repo.
- `LITE.md`: the lite edition (Apps Script backend, GitHub Pages).
- `PRO.md`: the pro edition (Go server, watermark tool, promos, photo viewer, VPS deploy). Present only in the pro starter and pro shops; when it's there, this is a pro repo and `LITE.md`'s backend and hosting notes don't apply.
- `SHOP.md`: one shop's own facts (sheet ID, live URL, current settings, design choices). Present only in a shop repo.

## What GS2Preorder is

A pre-order site for small shops where a Google Sheet is the whole database and the owner's admin screen. Customers browse the catalog, fill a cart and send a pre-order; the owner works through the orders in the sheet.

- **INVENTORY** (owner edits): the catalog and stock. Reserved/Sold/Available are formula columns.
- **ORDERS**: one row per order, written by the backend. The owner changes only `Status`: `Pending` → `Verified` → `Paid`, or `Cancelled` / `Out of Stock`. Only Pending and Verified reserve stock and only Paid counts as sold, so stock follows the status and a change back undoes it.
- **ORDER_ITEMS**: one row per product per order, backend only; its `Status` is looked up from ORDERS.
- **TEMPLATES**: the messages the owner sends per status; ORDERS' `Subject`/`Message`/`Contact Link` columns fill in from it.
- **SETTINGS**: storefront text, switches, theme and colors.
- **PROMOS** (pro only): bundle prices.

The contract shared by both editions is in `docs/sheet.md` (tabs and columns), `docs/api.md` (JSON bodies) and `docs/hooks.md` (the page's extension API, used by pro's `pro.js`).

## Repos and updates

```
GS2Preorder (lite starter) ──pull──► lite shop repos (public, GitHub Pages)
        │
        └──pull──► GS2Preorder-Pro (pro starter) ──pull──► pro shop repos (private, VPS)
```

Shops pull with `git pull --no-rebase starter main`; the pro starter pulls lite with `git pull --no-rebase lite main`. Never `--rebase`: it rewrites commits that are already pushed.

## Rules

- **No tenant data in starter files, ever.** The lite starter's history is public in every lite shop repo, and the pro starter's in every pro shop repo. In the starters, and in any shared file of a shop repo, never commit shop names, logos, photos, product lists or prices, sheet IDs or deployment URLs, owner or customer names, emails, phone numbers or handles, or GitHub usernames and site URLs, not even in a test or an example. Use the placeholders ("My Shop", `<owner>`, `<tenant>`, `stickers-001`). A shop's facts go in its `SHOP.md` and its own files. If tenant data was ever committed to a starter, tell the user; deleting the file doesn't remove it from history.
- **Per-shop changes stay mergeable.** In a shop repo, CSS goes only in `web/shop.css`, `index.html` changes stay limited to `<head>` and the name/logo, `web/config.js` holds the backend settings, and new files (logo, icons, `share.jpg`, `web/img/`) are free. `app.js`, `style.css` and `theme.js` aren't changed per shop, and neither is `Code.gs`. A shop's need becomes a starter feature behind a SETTINGS row. In the starters, `web/shop.css` must stay empty, or every shop's update conflicts.
- **Header-row formulas**: every computed column is one formula in its header cell. The backend writes only the plain columns; writing anything, even `""`, into a formula column breaks it with `#REF!`. Customer text is always stored as plain text, never parsed, which blocks formula injection and keeps leading zeros.
- **Never trust the client**: the backend re-validates everything, re-reads inventory for each stock check under a lock, and prices from the sheet.
- **Frontend** (`web/`, plain HTML/CSS/vanilla JS, no build step):
  - Build DOM with `textContent`/`<template>`, never `innerHTML` with data. Relative URLs only.
  - `localStorage` keys are per path (`cart-v1:<pathname>`, `theme-v1:<pathname>`), because several shops can share one origin.
  - In `app.js`, every backend call goes through the `api` object (`backend: "apps-script"` or `"server"`). The page must keep working against older pro servers: treat a missing `contactFields` as Email + Instagram, and send `messenger` only when it's chosen.
  - `window.ShopPage` is a contract (`docs/hooks.md`): don't rename, remove or change the meaning of a member or hook without raising its `version` and updating `pro.js`.
  - Files in `web/` carry **no comments** (HTML, CSS or JS): they're served as is, and pro's deploy refuses them. Notes go in `docs/web/<file>.md`, which is never deployed.
  - Design: all brand colors derive from `--brand` via `color-mix`, and `--brand` is only a fill. SETTINGS `Theme` picks the look via `<html data-theme>`: unscoped CSS is art-crafts, the default rules (shared with `dark`) override it, and `dark` then recolors. Text on a `--brand` fill uses `--on-light`, never `--ink`. The theme list is in `Code.gs`, `app.js`, `web/theme.js` and pro's `shop.Themes`; keep them in step. Nav and cart bar use `position: fixed`, not sticky (Firefox for Android bug).
- **Photos**: unprocessed photos stay out of git (`photos/` is ignored); only web-ready copies in `web/img/` are committed.
- **PH defaults** (₱, Manila time, PH mobile numbers) are hard-coded and listed in `docs/customizing.md`. Change them everywhere at once.

## Checking frontend changes

```bash
node --check web/app.js && node --check web/theme.js
grep -rnE --include='*.html' '<!--' web                                            # no comments in web/:
grep -rnE --include='*.css' --include='*.js' '/\*|(^|[^:])//' web                    # both must print nothing
```

Then load the page and check the browser console. `LITE.md` and `PRO.md` add their own checks.

The user makes all git commits. Suggest commit messages and don't run `git commit`.
