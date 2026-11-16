# web/app.js

## Constants

- `CONFIGURED`: the page counts as connected when `backend` is `"server"`, or when `api` is an Apps Script URL (`https://script.google.com/…`). Otherwise it shows "not connected".
- `THEMES`: the first entry is used when settings name no theme (or an unknown one). `web/theme.js` lists them too; keep them in step with `Code.gs` and pro's `shop.Themes`.
- `THEME_KEY`: read early by `web/theme.js`, before app.js runs, to avoid a theme flash.

## Pricing (`pricing`, `requestPricing`, `renderTotals`)

Totals are regular prices unless an extension calls `ShopPage.setPricing` (see [hooks.md](../hooks.md#pricing)). Then `updateCartbar` calls `requestPricing`, which debounces by `PRICING_DELAY`, aborts the previous request and caches the answer by `cartKey()` (the sorted cart). `renderTotals` dims the totals and the discount list (`.pending`) while `pricing.busy` and no fresh quote exist; while pending, it updates only the item count in the cart bar. A failed or malformed answer means regular prices; the next cart change retries. `loadShop` drops the cached quote, because prices may have changed.

## Hooks and `window.ShopPage`

The extension API is documented in [hooks.md](../hooks.md); this is how it's wired:

- `emit(name, …)` runs a hook's functions, each in its own `try`, so a broken extension can't break the page.
- `card` is emitted in `productCard`, `line` in `cartLine`, `cart` at the end of `updateCartbar` (every cart change ends there), `products` at the end of `loadShop`, `closed` in `closeShop`.
- `tracked` holds the elements passed to `ShopPage.track`; `updateProduct` refreshes the connected ones whose `data-sku` matches, with the same focus handling as cards.
- `setPricing` re-renders the totals only once products are loaded: `cartTotals` needs every cart SKU's price, and a cart restored from `localStorage` can name products that haven't loaded yet.
- `loadScripts` appends each `SHOP_CONFIG.scripts` file as a non-async `<script>` (so they run in order) and resolves when all have loaded or failed. `loadShop` awaits it (`scriptsLoaded`) alongside the data, so hooks are in place before the first render. Only bare filenames are accepted: the scripts must come from the page's own origin.

## Categories (`renderShop`, `renderLines`)

Each category gets a slug key (`slug(category)`, or `new` for the New section). It's the section's `id` (`c-<key>`), and `data-category` on the section, its nav link and its cart group, so a shop's CSS can color a category by name (see [customizing.md](../customizing.md#colors-and-design)). The automatic tint is set inline as `--auto-tint`, never as `--tint`: an inline `--tint` would beat any stylesheet rule.

## watchNavHeight

The nav is `position: fixed`, so the page reserves `--nav-h` for it (body padding, `scroll-padding-top`). On wide screens the category bar wraps, so the bar's height varies; a `ResizeObserver` on `.tapes-row` writes its real height into `--nav-h` on `<html>`. The row's own minimum is `--nav-row`, not `--nav-h`, so the measurement can't feed back into itself. With the shop closed the nav is hidden (height 0) and the value is left alone.

## HANDLE_LINK

The shop's own links under the notes: maps a SETTINGS handle kind to `[href, text]` for its value. A Messenger value that's already an `https://` URL is linked as is; otherwise it's treated as a page name for `m.me`.

## applyHandles

Shows the filled-in handles in SETTINGS row order. Older pro servers send no `handles`; then only Instagram is shown.

## DEFAULT_CONTACTS / applyContactFields

Shows only the contact options the shop offers, in its order. With a single option there's no choice to make, so the chooser is hidden.

Older pro servers don't send `contactFields`; they take Email and Instagram, so a missing list falls back to `DEFAULT_CONTACTS`. `applyContactFields()` is also called once at startup with no list, so the form is usable until the settings arrive.

## submitOrder

`messenger` is added to the body only when Messenger is the chosen contact method: older pro servers reject fields they don't know.

## applySettings

SETTINGS Accent Color is chosen for a white page, so it's ignored in the `dark` theme (see [style.css.md](style.css.md#dark)).
