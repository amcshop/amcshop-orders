# Page hooks: extending app.js

`web/app.js` exposes a small API, `window.ShopPage`, so an extra script can add features to the page without changing `app.js`. The pro edition uses it: its `web/pro.js` (in the pro starter, not here) adds promo pricing and the photo viewer. Lite loads no extra scripts, so none of this changes how a lite page behaves.

This is a contract, like `sheet.md` and `api.md`. Every pro shop runs this repo's `app.js` with pro's `pro.js`, so a change here that breaks the API breaks every pro shop on its next pull. Add things freely, but don't rename, remove or change the meaning of anything below without raising `ShopPage.version` and updating `pro.js` in the same round.

## Loading extra scripts

```js
window.SHOP_CONFIG = { backend: "server", api: "api/", scripts: ["pro.js"] };
```

- `scripts` lists files in `web/` by bare name (`pro.js`, `my-thing.js`): letters, digits, `.`, `_`, `-`, ending in `.js`. Anything else (paths, `../`, URLs) is skipped with a console error. They load from the page's own origin, so a strict CSP allows them.
- They load in order, after `app.js` has defined `ShopPage`, and the first render waits for them (a script that fails to load is skipped). So hooks registered when a script runs see every card from the start.
- An extension adds its own CSS if it needs any (e.g. a `<link rel="stylesheet">` it appends).

## `window.ShopPage`

A frozen object.

| Member | What it does |
|---|---|
| `version` | `1`. Raised on any breaking change. |
| `config` | `window.SHOP_CONFIG` as `app.js` read it. |
| `on(name, fn)` | Registers a hook (below). Throws on an unknown name. |
| `setPricing(fn)` | Replaces how the cart is priced (below). |
| `product(sku)` | The product object as loaded (`sku`, `category`, `name`, `description`, `price`, `photo`, `thumb`, `available`, `new`), or `undefined`. Treat it as read-only. |
| `qty(sku)` | The quantity in the cart (0 if none). |
| `setQty(sku, n)` | Sets a quantity, clamped to 0…availability (max 99). Saves the cart and refreshes the cards, the cart bar, the order sheet and every tracked element. |
| `qtyClick(event)` | The click handler the cards use: handles a click on an `.add` button or a stepper `.step` inside the event's target. Returns `true` if it handled one. Attach it to an extension's own buy area. |
| `track(el)` | Makes `el` a live "buy area" like a card's: `el.dataset.sku` names the product, and `el` contains a `.stock` and a `.qty-slot`. It's filled now and refreshed (keeping keyboard focus) whenever that product changes. Change `el.dataset.sku` to point it at another product, then call `track(el)` again to fill it. |
| `fillSubline(el, category, description)` | Fills a "Category, Description" line as the cards do; hides `el` when both are empty. |
| `peso(n)` | Formats an amount as the page does (`₱1,234.50`). |

## Hooks

Registered with `ShopPage.on(name, fn)`. A hook that throws is logged to the console and skipped; the page carries on.

| Name | Arguments | When |
|---|---|---|
| `card` | `(el, product)` | After each product card is built, before it's added to the page. A New product has two cards. Cards are built a page at a time as the customer scrolls, and rebuilt for search results, so this can run long after `products` and more than once per card position. |
| `line` | `(li, product)` | After each order-sheet line is built. Lines are rebuilt on every cart change while the sheet is open. |
| `cart` | `()` | After any cart change has been rendered (including the cart being trimmed to availability or cleared after an order). |
| `products` | `()` | After the products have been (re)loaded and the first page of the catalog rendered: on load, after an order, and on retry. Not every product has a card yet; use `product(sku)` rather than looking for cards. |
| `closed` | `(message)` | When orders close (by settings, the `Close At` timer, or a 403 on submit). |

## Pricing

By default the page totals the cart at regular prices. `ShopPage.setPricing(fn)` hands that to `fn`:

```js
ShopPage.setPricing(async (items, signal) => {
  // items: [{ sku, quantity }, …]; pass signal to fetch so a stale request is cancelled
  return { total: 150, discounts: [{ label: "2 Sticker Sheets", amount: 10 }] };
});
```

- `app.js` calls `fn` 150 ms after the cart stops changing, cancels the previous call (`signal`), and caches the answer per cart.
- While an answer is pending, the cart bar total, the order-sheet total and the discount list are dimmed (`.pending`).
- The answer's `total` replaces the regular total; each discount is shown as a line above the total (`label`, then `−₱amount`). Discounts with a non-string `label` or a non-number `amount` are dropped.
- If `fn` throws or returns no number `total`, the page shows regular prices. The server re-prices every order anyway; the page's total is an estimate.
- `setPricing(null)` goes back to regular prices.
