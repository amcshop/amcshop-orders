# Backend contract

The page talks to one of two backends, picked in `web/config.js`:

```js
window.SHOP_CONFIG = { backend: "apps-script", api: "https://script.google.com/macros/s/…/exec" }; // lite
window.SHOP_CONFIG = { backend: "server", api: "api/", scripts: ["pro.js"] };                       // pro (Go)
```

`scripts` loads extra page scripts (pro's `pro.js`: promo pricing and the photo viewer); see `hooks.md`.

Both return the same JSON bodies. Only the transport differs, and `api` in `web/app.js` hides the difference: it hands every caller a `{status, data}` pair.

| | Apps Script (lite) | Go server (pro) |
|---|---|---|
| Load shop | `GET <url>?action=shop` → `{status, products, settings}` | `GET api/products` + `GET api/settings` |
| Place order | `POST <url>` with body `{"action":"order", …}`, sent as `text/plain` (so the browser skips the CORS preflight that Apps Script can't answer) | `POST api/orders`, `application/json` |
| Status code | Always HTTP 200; the real code is `status` in the body | Real HTTP status |
| Health | `GET <url>?action=ping` → `{status:200, ok:true, api:1}` | `GET api/products` |

## Product

```json
{"sku":"stickers-001","category":"Stickers","name":"Cat","description":"Glossy, 3 in","price":50,
 "photo":"img/a.jpg","thumb":"img/a.jpg","available":12,"new":true}
```

`price` is in pesos. `available` is never negative. `description`, `photo`, `thumb` and `new` are left out when empty. `photo`/`thumb` are URLs relative to the page (or absolute). Lite has a single size, so they're the same. When both are missing, the page falls back to `img/index.json` (written by `photos.sh`).

## Settings

```json
{"subheading":"…","notes":["…"],"formNote":"","orderNote":"","instagram":"myshop","messenger":"myshop","handles":["Instagram","Messenger"],"contactFields":["Email","Messenger","Instagram"],
 "theme":"default","themeColor":"#2f62c8","accentColor":"","submitColor":"","open":true,
 "closedMessage":"Pre-orders are closed. Thank you!","closesAt":"2026-12-01T16:00:00.000Z"}
```

`handles` lists which of `instagram`/`messenger` are set, in SETTINGS row order (when it's missing, as from an older pro server, the page shows just Instagram). `messenger` is a username/ID or an `https://` link. `contactFields` lists the contact options the form offers, in order (when it's missing, as from an older pro server, the page offers Email and Instagram). `theme` is `default`, `art-crafts` or `dark`, always sent (the page treats a missing or unknown one as `default`). `themeColor` is SETTINGS Primary Color. Colors are `#rrggbb` or `""`. `closesAt` is omitted without a deadline; an open page closes itself at that instant.

## Order

Request:

```json
{"name":"Ana","contactVia":"Email","email":"ana@example.com","instagram":"","mobile":"0917 123 4567",
 "items":[{"sku":"stickers-001","quantity":2}],"website":""}
```

`contactVia` is `Email`, `Messenger` or `Instagram`. A `messenger` field (Facebook username or profile link) is sent **only** when `contactVia` is `Messenger`, because the pro server rejects unknown fields. `website` is a honeypot. When it's filled, the reply is a fake 201 and nothing is saved.

| Status | Body | Meaning |
|---|---|---|
| 201 | `{orderId, total}` | Saved |
| 400 | `{error, field?}` | Invalid input; `field` names the form field (`name`, `email`, `messenger`, `instagram`, `mobile`, `contactVia`, `items`) |
| 403 | `{error, closed:true}` | Orders are closed; `error` is the closed message |
| 409 | `{error, sku, available}` | Not enough stock of `sku` |
| 429 | `{error}` | Rate limited (lite: over 20 orders/minute shop-wide; pro: per IP) |
| 503 | `{error}` | The sheet couldn't be read or written |

The server re-validates everything and prices items from the sheet, never from the client. Validation rules: name 1–100 chars, no control characters; `contactVia` must be one of the shop's Contact Fields; then an email (without `? & # % = / \`, which would add parameters to the owner's mailto: link), a Facebook username/ID (`[A-Za-z0-9.]{1,50}`) or a facebook.com / fb.com / m.me / messenger.com link (stored as `https://<host><path>`, at most 200 chars; the query string is dropped, except a `profile.php` link keeps its numeric `id`), or an Instagram username (`[A-Za-z0-9._]{1,30}`), with a leading `@` dropped from usernames; Philippine mobile (`09…`, `9…`, `639…`, `+639…`, stored as `09XXXXXXXXX`); 1–50 distinct products, 1–99 of each, checked both per entry and after duplicates are merged.

## Pro-only extensions (not in lite)

The Go server also has `POST api/quote` (promo pricing) and the frontend there has a photo viewer. A pro page detects them from config, never by probing. See `pro.md`.
