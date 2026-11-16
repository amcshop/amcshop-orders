/**
 * GS2Preorder backend: a web app bound to the shop's Google Sheet.
 *
 *   GET  ?action=shop    products + storefront settings
 *   GET  ?action=ping    health check
 *   POST {action:"order", ...}   place a pre-order
 *
 * Apps Script can't set HTTP status codes, so every reply is HTTP 200 with
 * the real status in the body: {"status": 409, "error": "...", ...}.
 * The contract (shared with the Go "pro" server) is in docs/api.md.
 *
 * The sheet menu "GS2Preorder" adds "Set up sheet" (builds missing tabs) and
 * "Check setup". The tabs are described in docs/sheet.md.
 */

const API_VERSION = 1;

const TAB = {
  inventory: "INVENTORY",
  orders: "ORDERS",
  items: "ORDER_ITEMS",
  settings: "SETTINGS",
  templates: "TEMPLATES",
};
const STATUSES = ["Pending", "Verified", "Paid", "Cancelled", "Out of Stock"];
// Ways a customer can be reached, in ORDERS column order. SETTINGS "Contact Fields" picks which the form offers.
const CONTACT_METHODS = ["Email", "Messenger", "Instagram"];

const CURRENCY = "₱";
const MAX_LINE_QTY = 99;
const MAX_LINES = 50;
const MAX_NAME = 100;
const MAX_EMAIL = 254;

const CACHE_KEY = "shop-v1";
const CACHE_SECONDS = 30;
// Across all customers: the script has no client IPs to limit per person.
const ORDERS_PER_MINUTE = 20;

const DEFAULT_CLOSED = "Pre-orders are closed. Thank you!";

// Also refuses ? & # % = / \, which are legal in an address but would add parameters
// (cc, bcc, body) to the owner's mailto: link in ORDERS.
const EMAIL_RE = /^[^\s@<>()",;:?&#%=\/\\]+@[^\s@<>()",;:?&#%=\/\\]+\.[^\s@<>()",;:?&#%=\/\\]+$/;
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;
// A Facebook username or numeric ID (opened as m.me/<it>), or a link to a profile on these hosts
// (kept as an https:// link, because "Copy link" in the Facebook app gives facebook.com/share/… links).
// The query string is dropped (see parseMessenger), so a link can't carry a redirect target.
const MESSENGER_USER_RE = /^[A-Za-z0-9.]{1,50}$/;
const MESSENGER_URL_RE = /^(?:https?:\/\/)?(?:(?:www|m|web)\.)?(facebook\.com|fb\.com|m\.me|messenger\.com)(\/[A-Za-z0-9._~\-\/%]+)(?:\?([A-Za-z0-9._~\-=&%]*))?$/i;
const MESSENGER_ID_RE = /(?:^|&)id=(\d{1,20})(?:&|$)/;
const MAX_MESSENGER = 200;
// 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX (Philippine mobiles).
const MOBILE_RE = /^(?:\+?63|0)?(9\d{9})$/;
const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;
const THEMES = ["default", "art-crafts", "dark"]; // the first is used when SETTINGS Theme is blank
const ORDER_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// ---------------------------------------------------------------- web app

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "shop";
  try {
    if (action === "shop") return reply(200, shopData());
    if (action === "ping") return reply(200, { ok: true, api: API_VERSION });
    return reply(404, { error: "Unknown action." });
  } catch (err) {
    console.error("shop data:", err);
    return reply(503, { error: "The shop is unavailable right now. Please try again shortly." });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply(400, { error: "Invalid request." });
  }
  if (!body || body.action !== "order") return reply(404, { error: "Unknown action." });
  try {
    const [status, data] = placeOrder(body);
    return reply(status, data);
  } catch (err) {
    console.error("placing order:", err);
    return reply(503, { error: "We couldn't place your order right now. Please try again shortly." });
  }
}

function reply(status, data) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: status }, data)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Products and public settings, cached for CACHE_SECONDS. */
function shopData() {
  const cache = CacheService.getScriptCache();
  let raw = null;
  const hit = cache.get(CACHE_KEY);
  if (hit) {
    try {
      raw = JSON.parse(hit);
    } catch (err) {}
  }
  if (!raw) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    raw = { products: readInventory(ss).map(publicProduct), settings: readSettings(ss) };
    try {
      cache.put(CACHE_KEY, JSON.stringify(raw), CACHE_SECONDS);
    } catch (err) {
      console.warn("not caching shop data:", err); // over the 100 KB value limit
    }
  }
  // "open" is worked out per request, so Close At takes effect on time.
  return { products: raw.products, settings: publicSettings(raw.settings, Date.now()) };
}

// ---------------------------------------------------------------- orders

/** Returns [status, body]. */
function placeOrder(body) {
  if (body.website) {
    console.warn("honeypot triggered");
    return [201, { orderId: "", total: 0 }]; // look successful so the bot doesn't adapt
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const st = readSettings(ss);
  if (!isOpen(st, Date.now())) return [403, { error: st.closedMessage || DEFAULT_CLOSED, closed: true }];

  const req = normalize(body, contactMethods(st));
  if (req.field) return [400, { error: req.error, field: req.field }];

  // One order at a time, so two customers can't both take the last unit.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return [503, { error: "The shop is busy. Please try again in a moment." }];
  let order;
  try {
    if (!takeRateSlot()) {
      return [429, { error: "Too many orders right now. Please try again in a few minutes." }];
    }

    const inventory = readInventory(ss);
    const bySku = new Map(inventory.map((p) => [p.sku, p]));
    const rank = catalogRank(inventory);
    req.items.sort((a, b) => (rank.get(a.sku) || 0) - (rank.get(b.sku) || 0));

    const lines = [];
    for (const it of req.items) {
      const p = bySku.get(it.sku);
      if (!p) {
        return [400, { error: "A product in your order no longer exists. Please refresh the page.", field: "items" }];
      }
      if (p.available < it.quantity) {
        const left = Math.max(p.available, 0);
        const msg = left <= 0 ? `${p.name} is sold out.` : `Only ${left} of ${p.name} left.`;
        return [409, { error: msg, sku: p.sku, available: left }];
      }
      lines.push({ sku: p.sku, name: p.name, category: p.category, quantity: it.quantity, unit: p.price });
    }

    order = { id: newOrderId(), placedAt: new Date(), customer: req.customer, lines: lines };
    saveOrder(ss, order);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  CacheService.getScriptCache().remove(CACHE_KEY); // availability changed
  try {
    notifyOwner(ss, st, order);
  } catch (err) {
    console.error("notifying owner:", err); // the order is saved; only log
  }
  return [201, { orderId: order.id, total: orderTotal(order) / 100 }];
}

/** Validates and normalizes the request: {customer, items} or {field, error}. */
function normalize(b, methods) {
  const bad = (field, error) => ({ field: field, error: error });
  const str = (v) => (typeof v === "string" ? v : "");

  const name = str(b.name).trim();
  if (!name) return bad("name", "Please enter your name.");
  if ([...name].length > MAX_NAME) return bad("name", "Name is too long.");
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return bad("name", "Name contains invalid characters.");

  const c = { name: name, contactVia: str(b.contactVia), email: "", messenger: "", instagram: "", mobile: "" };
  if (!methods.includes(c.contactVia)) {
    return bad("contactVia", `Please choose ${methods.join(" or ")}.`);
  }
  if (c.contactVia === "Email") {
    c.email = str(b.email).trim();
    if (!EMAIL_RE.test(c.email) || c.email.length > MAX_EMAIL) {
      return bad("email", "Please enter a valid email address.");
    }
  } else if (c.contactVia === "Instagram") {
    c.instagram = str(b.instagram).trim().replace(/^@/, "");
    if (!INSTAGRAM_RE.test(c.instagram)) return bad("instagram", "Please enter a valid Instagram username.");
  } else {
    c.messenger = parseMessenger(str(b.messenger));
    if (!c.messenger) return bad("messenger", "Please enter your Facebook username or profile link.");
  }

  const m = MOBILE_RE.exec(str(b.mobile).trim().replace(/[\s\-().]/g, ""));
  if (!m) return bad("mobile", "Please enter a valid PH mobile number, e.g. 0917 123 4567.");
  c.mobile = "0" + m[1];

  if (!Array.isArray(b.items) || b.items.length === 0) return bad("items", "Your order is empty.");
  const merged = new Map();
  for (const it of b.items) {
    const sku = str(it && it.sku).trim();
    const qty = it && it.quantity;
    if (!sku || !Number.isInteger(qty) || qty < 1) {
      return bad("items", "Each item needs a product and a quantity of at least 1.");
    }
    if (qty > MAX_LINE_QTY) return bad("items", `At most ${MAX_LINE_QTY} of each product per order.`);
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  if (merged.size > MAX_LINES) return bad("items", `Too many different products in one order (max ${MAX_LINES}).`);
  for (const qty of merged.values()) {
    if (qty > MAX_LINE_QTY) return bad("items", `At most ${MAX_LINE_QTY} of each product per order.`);
  }
  return { customer: c, items: [...merged].map(([sku, quantity]) => ({ sku: sku, quantity: quantity })) };
}

/**
 * A Facebook username/ID as typed (minus "@"), or a facebook.com / m.me link as https://…; "" if neither.
 * A link keeps only its host and path, except that a profile.php link keeps its numeric id.
 */
function parseMessenger(v) {
  const s = v.trim().replace(/^@/, "");
  if (MESSENGER_USER_RE.test(s)) return s;
  const m = MESSENGER_URL_RE.exec(s);
  if (!m || s.length > MAX_MESSENGER) return "";
  const link = "https://" + m[1].toLowerCase() + m[2];
  if (m[2].toLowerCase() !== "/profile.php") return link;
  const id = MESSENGER_ID_RE.exec(m[3] || "");
  return id ? link + "?id=" + id[1] : "";
}

/** Allows ORDERS_PER_MINUTE orders per clock minute. Call while holding the lock. */
function takeRateSlot() {
  const cache = CacheService.getScriptCache();
  const key = "rate-" + Math.floor(Date.now() / 60000);
  const used = Number(cache.get(key)) || 0;
  if (used >= ORDERS_PER_MINUTE) return false;
  cache.put(key, String(used + 1), 120);
  return true;
}

/**
 * Writes the ORDERS row (A–K) and ORDER_ITEMS rows (A–F). The columns after
 * those are header-row formulas and must never be written, or they #REF!.
 * Text is written with a leading apostrophe so it is stored exactly as typed:
 * never run as a formula (e.g. a Name of "=IMPORTXML(...)"), and mobile
 * numbers keep their leading 0.
 */
function saveOrder(ss, o) {
  const orders = tab(ss, TAB.orders);
  const items = tab(ss, TAB.items);
  const orderRow = nextFreeRow(orders);
  const itemRow = nextFreeRow(items);
  ensureRows(orders, orderRow);
  ensureRows(items, itemRow + o.lines.length - 1);

  const t = (s) => (s === "" ? "" : "'" + s);
  const c = o.customer;
  const placed = Utilities.formatDate(o.placedAt, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  orders.getRange(orderRow, 1, 1, 11).setValues([[
    t(o.id), t(placed), t(c.name), t(c.contactVia), t(c.email), t(c.messenger), t(c.instagram), t(c.mobile),
    t(orderSummary(o)), orderTotal(o) / 100, "Pending",
  ]]);
  items.getRange(itemRow, 1, o.lines.length, 6).setValues(o.lines.map((l) => [
    t(o.id), t(l.sku), t(label(l)), l.quantity, l.unit / 100, (l.unit * l.quantity) / 100,
  ]));
}

/** The row after the last non-blank cell in column A. */
function nextFreeRow(sheet) {
  const col = sheet.getRange(1, 1, sheet.getMaxRows(), 1).getValues();
  let last = col.length;
  while (last > 0 && col[last - 1][0] === "") last--;
  return last + 1;
}

function ensureRows(sheet, row) {
  const max = sheet.getMaxRows();
  if (max < row) sheet.insertRowsAfter(max, Math.max(row - max, 500));
}

function notifyOwner(ss, st, o) {
  const to = st.notifyEmail;
  if (!to || /^(off|no|none)$/i.test(to)) return;
  MailApp.sendEmail({
    to: to,
    subject: `New pre-order ${o.id}: ${money(orderTotal(o))}`,
    body: `${o.customer.name} placed pre-order ${o.id}.\n\n${orderSummary(o)}\n\n` +
      `Total: ${money(orderTotal(o))}\n\nOpen the sheet: ${ss.getUrl()}`,
  });
}

function label(l) {
  return l.category ? `${l.name} (${l.category})` : l.name;
}

/** Centavos. */
function orderTotal(o) {
  return o.lines.reduce((sum, l) => sum + l.unit * l.quantity, 0);
}

/** One line per product, e.g. "2 × Cat sticker (Stickers) — ₱200". */
function orderSummary(o) {
  return o.lines.map((l) => `${l.quantity} × ${label(l)} — ${money(l.unit * l.quantity)}`).join("\n");
}

/** Formats centavos like "₱1,200" or "₱1,200.50". */
function money(c) {
  const sign = c < 0 ? "-" : "";
  c = Math.abs(Math.round(c));
  const whole = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = c % 100;
  return sign + CURRENCY + whole + (cents ? "." + String(cents).padStart(2, "0") : "");
}

/** Catalog order with each category kept together, as the page shows it. */
function catalogRank(products) {
  const byCat = new Map();
  for (const p of products) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p.sku);
  }
  const rank = new Map();
  for (const skus of byCat.values()) {
    for (const sku of skus) if (!rank.has(sku)) rank.set(sku, rank.size + 1);
  }
  return rank;
}

/** "PO-" and six characters, leaving out 0/O and 1/I/L. */
function newOrderId() {
  let id = "PO-";
  for (let i = 0; i < 6; i++) {
    id += ORDER_ID_ALPHABET[Math.floor(Math.random() * ORDER_ID_ALPHABET.length)];
  }
  return id;
}

// ---------------------------------------------------------------- reading the sheet

function tab(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`The ${name} tab is missing. Run GS2Preorder ▸ Set up sheet.`);
  return sheet;
}

/** INVENTORY rows by header name, so columns can be moved or added. Prices in centavos. */
function readInventory(ss) {
  const rows = tab(ss, TAB.inventory).getDataRange().getValues();
  const col = headerIndex(rows[0] || []);
  for (const h of ["SKU", "Category", "Product Name", "Price", "Available"]) {
    if (!col.has(h)) throw new Error(`${TAB.inventory} has no "${h}" column.`);
  }
  const cell = (row, h) => (col.has(h) ? row[col.get(h)] : "");
  const text = (row, h) => String(cell(row, h) ?? "").trim();

  const products = [];
  rows.slice(1).forEach((row, i) => {
    const sku = text(row, "SKU");
    if (!sku) return;
    const price = number(cell(row, "Price"));
    if (Number.isNaN(price)) throw new Error(`${TAB.inventory} row ${i + 2} (${sku}): bad Price.`);
    // A broken or blank Available formula means "don't sell", never "unlimited".
    const available = number(cell(row, "Available"));
    products.push({
      sku: sku,
      category: text(row, "Category"),
      name: text(row, "Product Name"),
      description: text(row, "Description"),
      price: Math.round(price * 100),
      photo: text(row, "Photo"),
      available: Number.isNaN(available) ? 0 : Math.floor(available),
      isNew: parseSwitch(cell(row, "New")) === true,
    });
  });
  return products;
}

function publicProduct(p) {
  const out = {
    sku: p.sku,
    category: p.category,
    name: p.name,
    price: p.price / 100,
    available: Math.max(p.available, 0),
  };
  if (p.description) out.description = p.description;
  if (p.isNew) out.new = true;
  if (p.photo) {
    // A full URL is used as is; anything else is a file in the site's img/ folder.
    out.photo = /^https:\/\//i.test(p.photo)
      ? p.photo
      : "img/" + encodeURIComponent(p.photo.split("/").pop());
    out.thumb = out.photo;
  }
  return out;
}

/** SETTINGS: "Setting | Value" rows; names match case-insensitively, blanks are ignored. */
function readSettings(ss) {
  const st = { notes: [], contactFields: [], handles: [] };
  const handle = (kind) => { if (!st.handles.includes(kind)) st.handles.push(kind); };
  const sheet = ss.getSheetByName(TAB.settings);
  if (!sheet) return st;
  const tz = ss.getSpreadsheetTimeZone();
  for (const row of sheet.getDataRange().getValues().slice(1)) {
    const name = String(row[0] ?? "").trim().toLowerCase();
    const v = row[1];
    const text = String(v ?? "").trim();
    if (!name || !text) continue;
    switch (name) {
      case "subheading": st.subheading = text; break;
      case "note": st.notes.push(text); break;
      case "form note": st.formNote = text; break;
      case "order note": st.orderNote = text; break;
      case "closed message": st.closedMessage = text; break;
      case "notify email": st.notifyEmail = text; break;
      case "contact fields":
      case "contact field": {
        const m = CONTACT_METHODS.find((x) => x.toLowerCase() === text.toLowerCase());
        if (m && !st.contactFields.includes(m)) st.contactFields.push(m);
        break;
      }
      case "instagram": {
        const ig = text.replace(/^@/, "");
        if (INSTAGRAM_RE.test(ig)) {
          st.instagram = ig;
          handle("Instagram");
        }
        break;
      }
      case "messenger": {
        const fb = parseMessenger(text);
        if (fb) {
          st.messenger = fb;
          handle("Messenger");
        }
        break;
      }
      case "orders open": {
        const on = parseSwitch(v);
        if (on !== null) st.ordersClosed = !on;
        break;
      }
      case "close at": {
        const at = parseTime(v, tz);
        if (at) st.closeAt = at;
        break;
      }
      case "theme": st.theme = parseTheme(text); break;
      case "primary color":
      case "theme color": st.themeColor = parseColor(text); break; // "Theme Color": its old name, still in older sheets
      case "accent color": st.accentColor = parseColor(text); break;
      case "submit color": st.submitColor = parseColor(text); break;
    }
  }
  return st;
}

/** The contact methods the form offers, in SETTINGS row order. No "Contact Fields" rows at all: every method. */
function contactMethods(st) {
  return st.contactFields && st.contactFields.length ? st.contactFields : CONTACT_METHODS;
}

function isOpen(st, now) {
  return !st.ordersClosed && !(st.closeAt && now >= st.closeAt);
}

/** What the page may see: never Notify Email. */
function publicSettings(st, now) {
  const out = {
    subheading: st.subheading || "",
    notes: st.notes || [],
    formNote: st.formNote || "",
    orderNote: st.orderNote || "",
    instagram: st.instagram || "",
    messenger: st.messenger || "",
    handles: st.handles || [],
    contactFields: contactMethods(st),
    theme: st.theme || THEMES[0],
    themeColor: st.themeColor || "",
    accentColor: st.accentColor || "",
    submitColor: st.submitColor || "",
    open: isOpen(st, now),
    closedMessage: st.closedMessage || DEFAULT_CLOSED,
  };
  if (st.closeAt) out.closesAt = new Date(st.closeAt).toISOString();
  return out;
}

function headerIndex(header) {
  return new Map(header.map((h, i) => [String(h).trim(), i]));
}

/** A number cell, or text such as "₱1,200". NaN for anything else (e.g. "#REF!"). */
function number(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[₱,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** A checkbox or Yes/No-style text: true, false, or null if unrecognized. */
function parseSwitch(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["yes", "true", "open", "on"].includes(s)) return true;
  if (["no", "false", "closed", "off"].includes(s)) return false;
  return null;
}

/** A date cell, or text "YYYY-MM-DD[ HH:MM]" in the sheet's timezone. Milliseconds, or 0. */
function parseTime(v, tz) {
  if (v instanceof Date) return v.getTime();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(String(v ?? "").trim());
  if (!m) return 0;
  const s = `${m[1]}-${m[2]}-${m[3]} ${m[4] || "00"}:${m[5] || "00"}`;
  return Utilities.parseDate(s, tz, "yyyy-MM-dd HH:mm").getTime();
}

/** A THEMES name, matched case-insensitively; anything else → "" (the default). */
function parseTheme(v) {
  return THEMES.find((t) => t === v.toLowerCase()) || "";
}

/** "#RRGGBB" or "rrggbb" → "#rrggbb"; anything else → "". */
function parseColor(v) {
  return HEX_RE.test(v) ? "#" + v.replace(/^#/, "").toLowerCase() : "";
}

// ---------------------------------------------------------------- sheet menu

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("GS2Preorder")
    .addItem("Check setup", "checkSetup")
    .addItem("Set up sheet (adds missing tabs)", "setupSheet")
    .addToUi();
}

function checkSetup() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    for (const name of Object.values(TAB)) tab(ss, name);
    const products = readInventory(ss);
    const st = readSettings(ss);
    const cats = new Set(products.map((p) => p.category));
    const lines = [
      `${products.length} products in ${cats.size} categories.`,
      `${products.filter((p) => p.available > 0).length} products in stock.`,
      isOpen(st, Date.now()) ? "Orders are OPEN." : "Orders are CLOSED.",
      `Customers can be reached by: ${contactMethods(st).join(", ")}.`,
      st.closeAt ? `Orders close on ${new Date(st.closeAt).toString()}.` : "No closing date set.",
      `Theme: ${st.theme || THEMES[0]}.`,
      st.notifyEmail ? `New-order emails go to ${st.notifyEmail}.` : "No Notify Email set: you won't get new-order emails.",
    ];
    ui.alert("GS2Preorder setup looks good", lines.join("\n"), ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("GS2Preorder setup problem", String(err.message || err), ui.ButtonSet.OK);
  }
}

/** Creates any missing tab with its headers, formulas and formatting. Existing tabs are left alone. */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const made = [];
  const builders = [
    [TAB.inventory, buildInventory],
    [TAB.orders, buildOrders],
    [TAB.items, buildOrderItems],
    [TAB.templates, buildTemplates],
    [TAB.settings, buildSettings],
  ];
  // Insert every missing tab before writing any formula: a formula that names a
  // tab that doesn't exist yet stays broken ("Argument must be a range") even
  // after the tab is added.
  const created = builders
    .filter(([name]) => !ss.getSheetByName(name))
    .map(([name, build]) => [name, build, ss.insertSheet(name)]);
  for (const [name, build, sheet] of created) {
    build(sheet);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold");
    made.push(name);
  }
  // A brand-new spreadsheet starts with an empty "Sheet1"; drop it.
  const blank = ss.getSheetByName("Sheet1");
  if (made.length && blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  const ui = SpreadsheetApp.getUi();
  ui.alert("Set up sheet", made.length ? `Added: ${made.join(", ")}.` : "All tabs already exist; nothing changed.", ui.ButtonSet.OK);
}

const MONEY_FORMAT = '[$₱]#,##0.00';

// Each computed column is ONE formula in its header cell that outputs the
// header text and then the whole column. Never type below these headers.
const FORMULAS = {
  reserved:
    '={"Reserved"; MAP(A2:A, LAMBDA(sku, IF(sku="", , ' +
    'SUMIFS(ORDER_ITEMS!D:D, ORDER_ITEMS!B:B, sku, ORDER_ITEMS!G:G, "Pending") + ' +
    'SUMIFS(ORDER_ITEMS!D:D, ORDER_ITEMS!B:B, sku, ORDER_ITEMS!G:G, "Verified"))))}',
  sold:
    '={"Sold"; MAP(A2:A, LAMBDA(sku, IF(sku="", , ' +
    'SUMIFS(ORDER_ITEMS!D:D, ORDER_ITEMS!B:B, sku, ORDER_ITEMS!G:G, "Paid"))))}',
  available:
    '={"Available"; MAP(A2:A, F2:F, I2:I, J2:J, LAMBDA(sku, inv, r, s, IF(sku="", , N(inv) - N(r) - N(s))))}',
  itemStatus:
    '={"Status"; MAP(A2:A, LAMBDA(id, IF(id="", , IFERROR(VLOOKUP(id, ORDERS!A:K, 11, FALSE), ))))}',
  subject:
    '={"Subject"; MAP(A2:A, C2:C, K2:K, LAMBDA(id, name, st, IF(OR(id="", st=""), , ' +
    'LET(s, IFERROR(VLOOKUP(st, TEMPLATES!A:B, 2, FALSE), ""), IF(s="", , ' +
    'SUBSTITUTE(SUBSTITUTE(s, "{order_id}", id), "{name}", name))))))}',
  message:
    '={"Message"; MAP(A2:A, C2:C, I2:I, J2:J, K2:K, LAMBDA(id, name, items, total, st, IF(OR(id="", st=""), , ' +
    'LET(b, IFERROR(VLOOKUP(st, TEMPLATES!A:C, 3, FALSE), ""), IF(b="", , ' +
    'SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(b, "{name}", name), "{order_id}", id), "{items}", items), ' +
    '"{total}", "₱" & TEXT(total, IF(total = INT(total), "#,##0", "#,##0.00"))))))))}',
  contactLink:
    '={"Contact Link"; MAP(D2:D, E2:E, F2:F, G2:G, L2:L, M2:M, LAMBDA(via, email, fb, ig, subj, msg, IF(msg="", , ' +
    'IF(via="Instagram", HYPERLINK("https://ig.me/m/" & ig, "💬 Open Instagram DM"), ' +
    'IF(via="Messenger", HYPERLINK(IF(LEFT(fb, 8)="https://", fb, "https://m.me/" & fb), "💬 Open Messenger"), ' +
    'HYPERLINK("mailto:" & email & "?subject=" & ENCODEURL(subj) & "&body=" & ENCODEURL(msg), "✉️ Send email"))))))}',
};

function buildInventory(sheet) {
  sheet.getRange("A1:H1").setValues([[
    "SKU", "Category", "Product Name", "Description", "Price", "Inventory", "New", "Photo",
  ]]);
  sheet.getRange("I1").setFormula(FORMULAS.reserved);
  sheet.getRange("J1").setFormula(FORMULAS.sold);
  sheet.getRange("K1").setFormula(FORMULAS.available);
  sheet.getRange("A2:H4").setValues([
    ["sample-001", "Stickers", "Sample sticker", "Delete these sample rows.", 50, 20, true, ""],
    ["sample-002", "Stickers", "Another sticker", "", 50, 2, false, ""],
    ["sample-003", "Prints", "Sample print", "A4, matte", 250, 5, false, ""],
  ]);
  sheet.getRange("E2:E").setNumberFormat(MONEY_FORMAT);
  sheet.getRange("G2:G").setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange("I1:K").setBackground("#f3f3f3");
  sheet.getRange("I1:K").protect().setDescription("Computed stock columns").setWarningOnly(true);
  sheet.getRange("I1:K1").setNote("Computed from ORDER_ITEMS. Don't type in these columns.");
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 240);
}

function buildOrders(sheet) {
  sheet.getRange("A1:K1").setValues([[
    "Order ID", "Timestamp", "Name", "Contact Via", "Email", "Messenger", "Instagram", "Mobile", "Items", "Total", "Status",
  ]]);
  sheet.getRange("L1").setFormula(FORMULAS.subject);
  sheet.getRange("M1").setFormula(FORMULAS.message);
  sheet.getRange("N1").setFormula(FORMULAS.contactLink);
  sheet.getRange("J2:J").setNumberFormat(MONEY_FORMAT);
  sheet.getRange("I2:I").setWrap(true);
  sheet.getRange("L1:N").setBackground("#f3f3f3");
  sheet.getRange("L1:N").protect().setDescription("Computed message columns").setWarningOnly(true);

  const status = sheet.getRange("K2:K");
  status.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  const colors = { Pending: "#fff2cc", Verified: "#cfe2f3", Paid: "#d9ead3", Cancelled: "#eeeeee", "Out of Stock": "#f4cccc" };
  const rules = Object.entries(colors).map(([s, bg]) =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(bg).setRanges([status]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$N2<>""').setBackground("#ffe08a").setBold(true)
    .setRanges([sheet.getRange("N2:N")]).build());
  sheet.setConditionalFormatRules(rules);
  sheet.setColumnWidth(9, 280);
  sheet.setColumnWidth(13, 280);
}

function buildOrderItems(sheet) {
  sheet.getRange("A1:F1").setValues([["Order ID", "SKU", "Product Name", "Quantity", "Unit Price", "Line Total"]]);
  sheet.getRange("G1").setFormula(FORMULAS.itemStatus);
  sheet.getRange("E2:F").setNumberFormat(MONEY_FORMAT);
  sheet.protect().setDescription("Written by the website only").setWarningOnly(true);
}

function buildTemplates(sheet) {
  sheet.getRange("A1:C5").setValues([
    ["Status", "Subject", "Body"],
    ["Verified", "Your pre-order {order_id}",
      "Hi {name}!\n\nThank you for your pre-order {order_id}:\n{items}\n\nTotal: {total}\n\n" +
      "Please pay via (your payment details here) and reply with a screenshot of your payment."],
    ["Paid", "Payment received for {order_id}",
      "Hi {name}!\n\nWe received your payment of {total} for pre-order {order_id}. " +
      "(Pickup or delivery details here.)\n\nThank you!"],
    ["Cancelled", "Pre-order {order_id} cancelled",
      "Hi {name},\n\nYour pre-order {order_id} has been cancelled. Message us if this is a mistake."],
    ["Out of Stock", "About your pre-order {order_id}",
      "Hi {name},\n\nSorry, some items in your pre-order {order_id} are out of stock:\n{items}\n\n" +
      "We'll message you about the next steps."],
  ]);
  sheet.getRange("C2:C").setWrap(true);
  sheet.setColumnWidth(2, 240);
  sheet.setColumnWidth(3, 480);
}

function buildSettings(sheet) {
  const rows = [
    ["Setting", "Value", "What it does"],
    ["Subheading", "Pre-order now, pick up at the event", "The line under the logo."],
    ["Note", "Pre-order closes on (date).", "One item of the list under the subheading. Add more Note rows for more items. **bold** and __underline__ work."],
    ["Note", "We'll message you to confirm your order and how to pay.", ""],
    ["Instagram", "", "Your Instagram username, linked under the notes. Blank: not shown."],
    ["Messenger", "", "Your Messenger/Facebook username (or page/profile link), linked under the notes. Blank: not shown. " +
      "Instagram and Messenger appear in the same order as these rows."],
    ["Form Note", "", "Text above the customer's details in the order form."],
    ...CONTACT_METHODS.map((m, i) => ["Contact Fields", m, i === 0
      ? "One row per way customers can ask to be reached (pick from the dropdown). Delete a row to turn that option off; " +
        "the rows' order is the order on the form. No rows at all: all three are offered."
      : ""]),
    ["Order Note", "We'll message you within one to two days with your exact total and how to pay.", "Small text under the order button."],
    ["Orders Open", true, "Untick to close orders right away."],
    ["Close At", "", "Date and time orders close by themselves (e.g. 2026-12-01 00:00). Blank: no deadline."],
    ["Closed Message", DEFAULT_CLOSED, "What the page shows once orders are closed."],
    ["Notify Email", "", "Where new-order emails go. Blank: no emails."],
    ["Theme", THEMES[0], `The page's look: ${THEMES.join(", ")}. Blank: ${THEMES[0]}.`],
    ["Primary Color", "", "Main color as #rrggbb (buttons, cart bar). Blank: the theme's default."],
    ["Accent Color", "", "Links and outlines as #rrggbb. Must be dark enough to read on white."],
    ["Submit Color", "", "The order button as #rrggbb."],
  ];
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  const rowOf = (name) => rows.findIndex((r) => r[0] === name) + 1;
  sheet.getRange(rowOf("Orders Open"), 2).insertCheckboxes().setValue(true);
  sheet.getRange(rowOf("Theme"), 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(THEMES, true).setAllowInvalid(false).build());
  sheet.getRange(rowOf("Close At"), 2).setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange(rowOf("Contact Fields"), 2, CONTACT_METHODS.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CONTACT_METHODS, true).setAllowInvalid(false).build());
  sheet.getRange("C2:C").setFontColor("#666666").setWrap(true);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(3, 420);
}
