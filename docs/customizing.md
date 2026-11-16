# Customizing a shop

Most of a shop's look is set by the owner in SETTINGS (text, colors). Everything else below is a per-site change in the shop's own repo, never in the starter.

## Keeping shops easy to update

Shops pull starter updates with `git pull --no-rebase starter main`. Git merges them automatically unless the starter and the shop changed the same lines. So, in a shop repo:

- **CSS goes only in `web/shop.css`.** It's this shop's own styles: empty in the starter, and starter updates never touch it. It loads after `style.css`, so it can override anything, e.g. `:root { --brand: #ffb700; }`, a different `body::before` background, or logo sizing. Leave `style.css` exactly as the starter has it.
- **`web/index.html`**: edit only what has to be per shop: `<head>` (title, description, `og:` tags, icons) and the name or logo in the masthead and top bar.
- **New files** (logo, icons, `share.jpg`, background images) never conflict.
- **Don't change `app.js` or `Code.gs` per shop.** If a shop needs a behavior, add it to the starter behind a SETTINGS row, so every shop gets it.

## Name and logo

- The name appears in `web/index.html` in `<title>`, `meta description`, the `og:` tags, `.shop-name` (masthead) and `.nav-logo` (the small name in the top bar once you scroll).
- To use a logo image instead of the text, add `web/logo.png` and:
  - masthead: `<h1><img class="logo" src="logo.png" alt="My Shop" width="280" height="…"></h1>`
  - top bar: `<a class="nav-logo" href="#" aria-label="Back to top"><img src="logo.png" alt="" width="44" height="…"></a>`
  
  Set the real height so the page doesn't jump while the logo loads. Trim and resize it first (around 560px wide is plenty).
- Favicon: replace `web/favicon.svg`, or add PNG/ICO icons and update the `<link rel="icon">`.
- Link previews (Facebook, Messenger): add `og:image` with an **absolute** URL, e.g. `https://<account>.github.io/<repo>/share.jpg` (1200×630).

## Colors and design

- SETTINGS **Theme** picks the page's look, set on `<html data-theme>`:
  - `default` (also when blank): clean and modern, one sans family (Instrument Sans, the shop name set condensed). Left-aligned masthead, photos on light grey tiles, category colors as small squares.
  - `art-crafts`: washi-tape category bar and headings, a light dot grid (`body::before`, `--pattern`), Young Serif headings with Hanken Grotesk text, centered masthead.
  - `dark`: the default layout on a near-black page. `--brand` stays a fill with dark text (`--on-light`), so a light or mid Primary Color works best. SETTINGS Accent Color is ignored, since it's chosen to read on white; `--accent` is the brand lightened instead. The footer gets a dark version of its colors.
  
  In `web/style.css` the unscoped rules are art-crafts, the `:is([data-theme="default"], [data-theme="dark"])` rules at the end override them, and the `[data-theme="dark"]` rules then recolor. A new theme is another `[data-theme="…"]` block, plus its name in `THEMES` (`Code.gs`, `app.js`, `web/theme.js`) and in pro's `shop.Themes`. `web/theme.js` re-applies the theme the visitor last saw before the page draws, so it doesn't flash while settings load. In `shop.css`, override a theme's own variables with the same selector, e.g. `:root[data-theme="default"] { --tile: #f4f4f4; }`.
- All brand tones derive from `--brand` (fills: buttons, stepper, cart bar). Each theme has its own default (`--theme-brand` in `web/style.css`): blue `#2f62c8` with white text for `default` and `dark`, orange `#f4a259` with dark text for `art-crafts`. A shop's own default goes in `web/shop.css` as `:root { --brand: …; }` (add `--on-brand: #ffffff;` if the color is dark), and applies whatever the theme. SETTINGS **Primary Color** overrides both, and picks white or dark text by itself. `--accent` (links, Add buttons) is derived from it to stay readable on white, unless SETTINGS **Accent Color** sets it.
- Category tints cycle through `--tape-1…6` in the order categories first appear in INVENTORY. The "New" section uses `--tape-new`.
- To give a category its own color, set `--tint` in `web/shop.css` on `[data-category]`. The value is the category's slug: lowercase, with every run of other characters turned into `-` (`Stickers & Pins` → `stickers-pins`). It's on the category's section, its link in the category bar and its group in the order sheet, so one rule colors all three:

  ```css
  [data-category="stickers-pins"] { --tint: #d7332e; }
  [data-category$="-red"] { --tint: #d7332e; }
  ```

  The second form matches every category whose name ends in "Red". No `!important` is needed: the automatic tint (`--auto-tint`) applies at zero specificity.
- On screens 52rem (832px) and wider, the category bar wraps onto more rows instead of scrolling sideways (a mouse can't scroll it). `app.js` keeps `--nav-h` equal to the bar's real height, so the page and the jump-to-category offset follow. To change the bar's height, set `--nav-row` (one row, default `3.5rem`), not `--nav-h`.
- The footer credits the developer and keeps its own colors (`--dev-*`).

## Philippines-specific defaults

These are hard-coded in three places. Change all of them together:

| What | `apps-script/Code.gs` | `web/app.js` | Sheet |
|---|---|---|---|
| Currency ₱ | `CURRENCY`, `MONEY_FORMAT`, and `"₱"` in `FORMULAS.message` | `peso()` | Existing sheets: edit the ORDERS `Message` header formula and the money number formats |
| Mobile numbers | `MOBILE_RE` and its error message | placeholder in `index.html` | — |
| Timezone | `appsscript.json` `timeZone` | — | File ▸ Settings ▸ Time zone (used for timestamps and Close At) |

## Contact options

The form can offer Email, Messenger and Instagram. Each shop picks which ones in SETTINGS ▸ **Contact Fields**, so no code change is needed. Adding a *new* method (e.g. Viber) touches `index.html` (radio, icon and field), `CONTACT_METHODS` and `normalize()` in `Code.gs`, `CONTACT_PHRASE` in `app.js`, the ORDERS columns and the Contact Link formula, so plan it as a starter change, not a per-shop tweak.
