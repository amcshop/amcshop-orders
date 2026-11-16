# SHOP.md

This shop's own facts. Common notes are in `CLAUDE.md` and `LITE.md`.

## Shop

- Name: **AMCShop** (One Piece TCG singles)
- Edition: lite (GitHub Pages + Apps Script)
- Repo: `amcshop/amcshop-orders` (owner's, public); starter remote `starter` → `Inggo/GS2Preorder`
- Site: https://amcshop.github.io/amcshop-orders/
- Sheet ID: `1eV1O7PVV_guTKGsqAL-MiNWB1jVCLfwkWM6Ta6n6Szg`
- Web app URL: in `web/config.js`

## Design

- Logo: `web/logo.webp` (masthead, 560px, background removed, emblem interior kept white), `web/emblem.webp` (emblem only, top bar), `web/favicon.png`, `web/apple-touch-icon.png`. Source: owner's 1408×768 JPEG on white.
- Brand colors from the logo: orange `#ed7b2c` (set as `--brand` in `web/shop.css`, dark text on it), teal `#2c5a60` (the wordmark).
- Category colors follow the card color at the end of the category name (`OP10 - Red` → red): `--op-*` and `[data-category$="-red"]`-style rules in `web/shop.css` (the starter's `data-category` hook, see `docs/customizing.md`). A new card color needs a new rule there.
- The category bar wraps on desktop (starter behavior from 52rem up); with 26 categories that's about 4 rows at 1280px.
- Theme: `default`. The wordmark is dark teal, so the `dark` theme would need a light version of the logo.

## Catalog

- SKUs are card numbers (`OP10-081`, `EB03-014`, `ST16-003`…); categories are `<set> - <color>`.
- Photos come from the owner as one folder per category with `<SKU>.png` card scans (600×838 or 868×1213). Copy them flat into `photos/` and run `./photos.sh`.
- Reprints share the original card number (e.g. a PRB02 reprint of `OP10-018`). They need their own SKU in INVENTORY and a photo named after that SKU.
