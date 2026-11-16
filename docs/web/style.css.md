# web/style.css

Leave this file as the starter has it; a shop's own CSS goes in `web/shop.css`, which loads after it (see [customizing.md](../customizing.md)).

## Layout of the file

The unscoped rules at the top are the base styles and the `art-crafts` theme (washi tape, serif headings). The themes section at the end overrides them:

- `default` (SETTINGS Theme blank or `default`): clean, modern, one sans family. Its rules are scoped to `:is([data-theme="default"], [data-theme="dark"])`.
- `dark`: the default layout in dark colors. It shares the `default` rules, then recolors with `:root[data-theme="dark"]`.

app.js sets `<html data-theme>` (and `web/theme.js` sets it early from the last visit).

## :root

- Each theme sets its own default `--theme-brand`. A shop's `web/shop.css` may set `--brand` itself, and SETTINGS Primary Color overrides both.
- `--on-light` is dark text for light fills, whatever the theme. Use it for text on a `--brand` fill, never `--ink` (which is light in `dark`).

## Category tints

`--tint` comes from `:where(.tape, .category, .line-group) { --tint: var(--auto-tint); }`. `app.js` sets `--auto-tint` inline. The `:where` gives the rule zero specificity, so a shop's `[data-category…] { --tint: … }` wins without `!important`.

## Discounts and pending

`.discounts` is the list of discount lines above the order sheet's total, filled only when an extension prices the cart (see [hooks.md](../hooks.md#pricing)); lite never shows it. `.pending` dims totals while a price is being worked out.

## Nav tools and search

`.nav-tools` holds the search (`.finder`) and the cart button at the right of the nav. It's `align-self: flex-start` with the height of one nav row, as is `.nav-logo`, so when many categories wrap onto several rows both stay on the top row instead of centering on the block.

- From 52rem up, the search field (`.finder-field`) is always shown, 15rem wide.
- Below 52rem only the magnifier (`.finder-open`) shows. `.tapes.finding` hides the logo and categories and lets the field and its Cancel button (`.finder-close`) take the row.
- `.finder-clear` is the round × inside the field, shown while there's text. The browser's own search clear button is hidden everywhere (Firefox has none, so it would be inconsistent). The input has `width: 0` and grows by flex, because an input's default width would otherwise push the Cancel button under the cart on narrow phones.
- The input is 16px so iOS doesn't zoom on focus.
- `mark` (search matches on result cards) is a 40% `--brand` tint behind inherited text, so it reads in every theme.

## Default theme sections

- **Masthead**: left-aligned; the shop name is the one loud thing.
- **Nav**: plain text tabs; a category's color shows as a small swatch. From 52rem up, the tabs wrap instead of scrolling (in every theme); see [app.js.md](app.js.md#watchnavheight) for how `--nav-h` follows.
- **Categories**.
- **Products**: photo on a soft tile, text below with no box.
- **Order sheet**.

## dark

The default layout on a dark page. `--brand` stays a fill with dark text, so a light or mid Primary Color works best. SETTINGS Accent Color is ignored (it's chosen for white); `--accent` is the brand lightened instead.
