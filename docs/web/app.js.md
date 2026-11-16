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

## Paging (`feed`, `startFeed`, `renderMore`, `fillFold`, `watchFeed`, `revealSection`)

The catalog isn't rendered all at once. `feed.items` is the flat list of (group, product) cards in page order (New first, then each category); sections are created as their first card is reached.

- `fillFold` renders `FOLD_STEP` cards at a time until the last one is below the bottom of the screen, then `PAGE_SIZE` (20) more.
- `watchFeed` watches the card `LOAD_AHEAD` (10) from the end of what's rendered; when it comes within a quarter screen of view, `renderMore(PAGE_SIZE)` adds the next 20. Without `IntersectionObserver` everything is rendered.
- `revealSection(id)` renders everything up to a section plus a page, so the nav tapes, the picker and a `#c-…` link on load can scroll to a section that wasn't rendered yet. The tape's click handler calls it before the browser follows the hash. Picking a category while searching clears the search first.
- `updateProduct` only touches cards that exist; a card rendered later is built from the current cart and stock.
- `watchSections` takes the section ids in order and is handed each section as it's created (`sectionObserver.observe` in `feedSection`).

## Search (`search`, `tokenScore`, `typos`, `applySearch`)

Front end only, over name, category and description (weights 3, 2, 1). Text is folded (lowercase, accents removed) and split into words. Every query word must match one of the fields:

- a word starting with it (an exact word scores a little more), else
- a substring anywhere (2+ letters), else
- a typo match against a word or the word's prefix of the same length (so a half-typed word with a typo still matches): 1 typo from 4 letters, 2 from 8, counting a swap of two neighbours as one (`typos` is an optimal string alignment distance that gives up past the limit).

Results are sorted by score, then catalog order, and shown as one "Search results" section through the same feed, with categories shown on the cards; the New duplicates aren't repeated. The query's words are highlighted on each result card with `<mark>` (`markMatches`/`matchRanges`, the same rules per word; a typo match marks the whole word). `matchRanges` maps positions in the folded text back to the original, so accented letters are marked whole.

Input is debounced by `SEARCH_DELAY`; Enter searches now and closes the keyboard, Escape clears. `.finder-clear` (the × inside the field) shows while there's text and clears the search, keeping the field open and focused. When the query changes and the catalog's top is above the screen or below its middle (a tall masthead on a phone), the page jumps to it, so the results are always in view. `.finder-status` (visually hidden, `aria-live`) announces the count. The query survives `loadShop` (after an order the results are re-run).

The field lives in the nav's `.nav-tools`, before the cart button. Below 52rem only the magnifier (`.finder-open`) shows; `openFinder` adds `.finding` to the nav, which hides the logo and categories and gives the field the row, and `closeFinder` (Cancel, Escape, or leaving an empty field) clears the search and closes it.

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
