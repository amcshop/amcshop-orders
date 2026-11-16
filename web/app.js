"use strict";

const CONFIG = window.SHOP_CONFIG || {};
const SERVER = CONFIG.backend === "server";
const API = CONFIG.api || (SERVER ? "api/" : "");
const CONFIGURED = SERVER || API.startsWith("https://script.google.com/");

const MAX_PER_ITEM = 99;
const CART_KEY = "cart-v1:" + location.pathname;
const TAPE_TINTS = 6;
const PRICING_DELAY = 150;
const THEMES = ["default", "art-crafts", "dark"];
const THEME_KEY = "theme-v1:" + location.pathname;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  products: [],
  bySku: new Map(),
  cart: new Map(),
  tints: new Map(),
};

const shop = $("#shop");
const nav = $(".tapes");
const picker = $(".section-picker", nav);
const cartbar = $(".cartbar");
const orderDialog = $("#order");
const form = $("#order-form");

async function request(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { status: SERVER ? res.status : data.status || 502, data };
}

const api = {
  async shop() {
    if (!SERVER) return request(API + "?action=shop");
    const [products, settings] = await Promise.all([
      request(API + "products"),
      request(API + "settings").catch(() => ({ status: 0 })),
    ]);
    if (products.status !== 200) return products;
    return {
      status: 200,
      data: { products: products.data.products, settings: settings.status === 200 ? settings.data : null },
    };
  },
  order(body) {
    if (!SERVER) {
      return request(API, { method: "POST", body: JSON.stringify({ action: "order", ...body }) });
    }
    return request(API + "orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};

async function photoManifest() {
  try {
    const res = await fetch("img/index.json", { cache: "no-cache" });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

function peso(n) {
  const cents = Math.round(n * 100) % 100 !== 0;
  return "₱" + n.toLocaleString("en-PH", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function limitFor(p) {
  return Math.min(p.available, MAX_PER_ITEM);
}

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    for (const [sku, qty] of Object.entries(saved)) {
      if (Number.isInteger(qty) && qty > 0) state.cart.set(sku, qty);
    }
  } catch {}
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(Object.fromEntries(state.cart)));
  } catch {}
}

function reconcileCart() {
  const changed = [];
  for (const [sku, qty] of state.cart) {
    const p = state.bySku.get(sku);
    const limit = p ? limitFor(p) : 0;
    if (qty > limit) {
      if (p) changed.push(sku);
      if (limit > 0) state.cart.set(sku, limit);
      else state.cart.delete(sku);
    }
  }
  saveCart();
  return changed;
}

function setQty(sku, qty) {
  const p = state.bySku.get(sku);
  if (!p) return;
  qty = Math.max(0, Math.min(qty, limitFor(p)));
  if (qty === 0) state.cart.delete(sku);
  else state.cart.set(sku, qty);
  saveCart();
  updateProduct(sku);
  updateCartbar();
  if (orderDialog.open) {
    if (state.cart.size === 0) orderDialog.close();
    else renderLines();
  }
}

function cartItems() {
  return [...state.cart].map(([sku, quantity]) => ({ sku, quantity }));
}

function cartTotals() {
  let items = 0;
  let total = 0;
  for (const [sku, qty] of state.cart) {
    items += qty;
    total += state.bySku.get(sku).price * qty;
  }
  return { items, total };
}

const pricing = { fn: null, timer: 0, abort: null, quote: null, busy: false };

function cartKey() {
  return JSON.stringify([...state.cart].sort());
}

function freshQuote() {
  return pricing.quote && pricing.quote.key === cartKey() ? pricing.quote : null;
}

function requestPricing() {
  if (!pricing.fn) return;
  clearTimeout(pricing.timer);
  pricing.abort?.abort();
  pricing.busy = state.cart.size > 0 && !freshQuote();
  if (!pricing.busy) return;
  pricing.timer = setTimeout(async () => {
    const key = cartKey();
    const abort = new AbortController();
    pricing.abort = abort;
    let quote = null;
    try {
      const q = await pricing.fn(cartItems(), abort.signal);
      if (q && Number.isFinite(q.total)) {
        const discounts = (Array.isArray(q.discounts) ? q.discounts : [])
          .filter((d) => d && typeof d.label === "string" && Number.isFinite(d.amount));
        quote = { key, total: q.total, discounts };
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error("pricing failed; showing regular prices", err);
    }
    if (abort.signal.aborted) return;
    pricing.quote = quote;
    pricing.busy = false;
    renderTotals();
  }, PRICING_DELAY);
}

function renderTotals() {
  const { items, total: subtotal } = cartTotals();
  const quote = freshQuote();
  const pending = pricing.busy && !quote;
  const summary = $(".cartbar-summary", cartbar);
  const amount = $(".total-amount", orderDialog);
  const list = $(".discounts", orderDialog);
  for (const el of [summary, amount, list]) el.classList.toggle("pending", pending);
  if (pending) {
    summary.textContent = summary.textContent.replace(/^[^,]*/, plural(items, "item", "items"));
    return;
  }

  const total = quote ? quote.total : subtotal;
  summary.textContent = `${plural(items, "item", "items")}, ${peso(total)}`;
  amount.textContent = peso(total);
  list.replaceChildren();
  for (const d of quote?.discounts || []) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = d.label;
    const off = document.createElement("span");
    off.className = "discount-amount";
    off.textContent = `−${peso(d.amount)}`;
    li.append(label, off);
    list.append(li);
  }
  list.hidden = !list.children.length;
}

function stepper(sku, qty, limit, label) {
  const el = $("#stepper").content.firstElementChild.cloneNode(true);
  el.dataset.sku = sku;
  const [minus, plus] = $$(".step", el);
  minus.setAttribute("aria-label", `Remove one ${label}`);
  plus.setAttribute("aria-label", `Add one more ${label}`);
  plus.disabled = qty >= limit;
  const count = $(".count", el);
  count.textContent = qty;
  count.setAttribute("aria-label", `${qty} in pre-order`);
  return el;
}

function renderShop() {
  const groups = [];
  const fresh = state.products.filter((p) => p.new);
  if (fresh.length) groups.push({ id: "new", key: "new", name: "New", products: fresh, tint: "var(--tape-new)" });
  const categories = new Map();
  state.tints.clear();
  for (const p of state.products) {
    if (!categories.has(p.category)) {
      const tint = `var(--tape-${(categories.size % TAPE_TINTS) + 1})`;
      const key = slug(p.category || "other");
      const group = { id: "c-" + key, key, name: p.category || "Other", products: [], tint };
      categories.set(p.category, group);
      groups.push(group);
      state.tints.set(p.category, tint);
    }
    categories.get(p.category).products.push(p);
  }

  const navList = $("ul", nav);
  navList.replaceChildren();
  const placeholder = new Option("Jump to a category", "");
  placeholder.disabled = true;
  picker.replaceChildren(placeholder);
  const sections = [];
  for (const { id, key, name, products, tint } of groups) {
    const mixed = id === "new";

    const link = document.createElement("a");
    link.className = "tape";
    link.href = "#" + id;
    link.textContent = name;
    link.dataset.category = key;
    link.style.setProperty("--auto-tint", tint);
    const li = document.createElement("li");
    li.append(link);
    navList.append(li);
    picker.append(new Option(name, id));

    const section = document.createElement("section");
    section.className = "category";
    section.id = id;
    section.dataset.category = key;
    section.style.setProperty("--auto-tint", tint);
    section.setAttribute("aria-labelledby", id + "-h");
    const head = document.createElement("div");
    head.className = "category-head";
    const h2 = document.createElement("h2");
    h2.id = id + "-h";
    h2.textContent = name;
    const count = document.createElement("p");
    count.textContent = plural(products.length, "design", "designs");
    head.append(h2, count);

    const grid = document.createElement("ul");
    grid.className = "grid";
    for (const p of products) grid.append(productCard(p, mixed));
    section.append(head, grid);
    sections.push(section);
  }

  if (!sections.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "No products yet. Check back soon!";
    sections.push(empty);
  }
  shop.replaceChildren(...sections);
  shop.removeAttribute("aria-busy");
  watchSections(sections.filter((s) => s.id));
}

function productCard(p, showCategory = false) {
  const el = $("#product-card").content.firstElementChild.cloneNode(true);
  el.dataset.sku = p.sku;
  $(".badge-new", el).hidden = !p.new;

  const photo = $(".photo", el);
  const img = $("img", photo);
  if (p.thumb) {
    img.src = p.thumb;
    img.alt = p.name;
  } else {
    img.remove();
    const empty = document.createElement("span");
    empty.className = "photo-empty";
    empty.textContent = "Photo coming soon";
    photo.append(empty);
  }

  $(".product-name .name", el).textContent = p.name;
  fillSubline($(".product-desc", el), showCategory ? p.category : "", p.description);
  $(".price", el).textContent = peso(p.price);
  fillProduct(el, p);
  emit("card", el, p);
  return el;
}

function fillSubline(el, category, description) {
  el.replaceChildren();
  if (category) {
    const cat = document.createElement("span");
    cat.className = "category-label";
    cat.textContent = category;
    el.append(cat);
    if (description) el.append(", ");
  }
  if (description) el.append(description);
  el.hidden = !el.hasChildNodes();
}

function fillProduct(el, p) {
  const qty = state.cart.get(p.sku) || 0;
  const soldOut = p.available <= 0;
  el.classList.toggle("sold-out", soldOut);

  const stock = $(".stock", el);
  stock.textContent = soldOut ? "Sold out" : p.available <= 3 ? `Only ${p.available} left` : `${p.available} left`;
  stock.classList.toggle("low", !soldOut && p.available <= 3);

  const slot = $(".qty-slot", el);
  if (soldOut) {
    slot.replaceChildren();
  } else if (qty === 0) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add";
    add.dataset.sku = p.sku;
    add.textContent = "Add";
    add.setAttribute("aria-label", `Add ${p.name} to pre-order`);
    slot.replaceChildren(add);
  } else {
    slot.replaceChildren(stepper(p.sku, qty, limitFor(p), p.name));
  }
}

function updateProduct(sku, keepFocus = true) {
  const active = document.activeElement;
  const els = $$(`.product[data-sku="${CSS.escape(sku)}"]`, shop);
  for (const el of tracked) if (el.isConnected && el.dataset.sku === sku) els.push(el);
  for (const el of els) {
    const step = keepFocus && active?.closest(".qty-slot") && el.contains(active)
      ? active.dataset.step || "1"
      : null;
    fillProduct(el, state.bySku.get(sku));
    if (step) {
      ($(`.step[data-step="${step}"]:not(:disabled)`, el) || $(".step:not(:disabled), .add", el))?.focus();
    }
  }
}

function updateCartbar() {
  requestPricing();
  const { items } = cartTotals();
  cartbar.hidden = items === 0;
  renderTotals();
  placeCartbar();
  const navCart = $(".nav-cart", nav);
  navCart.hidden = items === 0;
  $(".nav-cart-count", navCart).textContent = items;
  navCart.setAttribute("aria-label", `Review pre-order: ${plural(items, "item", "items")}`);
  emit("cart");
}

function placeCartbar() {
  if (cartbar.hidden) return;
  cartbar.classList.toggle("floating", cartbar.getBoundingClientRect().bottom > window.innerHeight + 1);
}

function watchCartbar() {
  const float = $(".cartbar-float", cartbar);
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      if (float.offsetHeight) cartbar.style.setProperty("min-height", `${float.offsetHeight}px`);
    }).observe(float);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(placeCartbar, { threshold: [0, 1] }).observe(cartbar);
  } else {
    addEventListener("scroll", placeCartbar, { passive: true });
  }
  addEventListener("resize", placeCartbar);
}

function watchNavHeight() {
  if (!("ResizeObserver" in window)) return;
  const row = $(".tapes-row", nav);
  new ResizeObserver(() => {
    if (row.offsetHeight) document.documentElement.style.setProperty("--nav-h", `${row.offsetHeight}px`);
  }).observe(row);
}

function watchMasthead() {
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    ([entry]) => nav.classList.toggle("scrolled", !entry.isIntersecting && entry.boundingClientRect.top < 0),
    { rootMargin: `-${nav.offsetHeight || 56}px 0px 0px 0px` },
  );
  io.observe($(".masthead h1"));
}

let sectionObserver = null;

function watchSections(sections) {
  sectionObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  const list = $("ul", nav);
  const links = new Map($$(".tape", nav).map((a) => [a.hash.slice(1), a]));
  const visible = new Set();
  let currentId = null;
  sectionObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target.id);
      else visible.delete(e.target.id);
    }
    const id = sections.find((s) => visible.has(s.id))?.id ?? null;
    if (id === currentId) return;
    currentId = id;
    picker.value = id ?? "";
    for (const [linkId, a] of links) {
      if (linkId === id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
    const a = links.get(id);
    if (a) {
      const r = a.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      if (r.left < lr.left || r.right > lr.right) list.scrollBy({ left: r.left - lr.left - 16, behavior: "smooth" });
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach((s) => sectionObserver.observe(s));
}

function renderLines(flagged = new Set()) {
  const groups = new Map();
  for (const p of state.products) {
    const qty = state.cart.get(p.sku);
    if (!qty) continue;
    if (!groups.has(p.category)) groups.set(p.category, document.createElement("ul"));
    groups.get(p.category).append(cartLine(p, qty, flagged.has(p.sku)));
  }
  const sections = [...groups].map(([category, ul]) => {
    const section = document.createElement("section");
    section.className = "line-group";
    section.dataset.category = slug(category || "other");
    section.style.setProperty("--auto-tint", state.tints.get(category) || "var(--brand)");
    const h3 = document.createElement("h3");
    h3.className = "line-group-title";
    h3.textContent = category || "Other";
    section.append(h3, ul);
    return section;
  });
  $(".lines", orderDialog).replaceChildren(...sections);
  renderTotals();
}

function cartLine(p, qty, flagged) {
  const li = $("#cart-line").content.firstElementChild.cloneNode(true);
  li.classList.toggle("flagged", flagged);
  li.dataset.sku = p.sku;
  const img = $(".line-photo img", li);
  if (p.thumb) img.src = p.thumb;
  else img.remove();
  $(".line-name", li).textContent = p.name;
  $(".line-sub", li).textContent = flagged
    ? `Only ${p.available} available`
    : `${peso(p.price)} each`;
  $(".line-qty", li).append(stepper(p.sku, qty, limitFor(p), p.name));
  $(".line-total", li).textContent = peso(p.price * qty);
  emit("line", li, p);
  return li;
}

function showView(name) {
  for (const v of $$(".sheet-view", orderDialog)) v.hidden = v.dataset.view !== name;
}

function openOrder() {
  showView("form");
  clearErrors();
  renderLines();
  orderDialog.showModal();
}

const HANDLE_LINK = {
  Instagram: (v) => [`https://www.instagram.com/${encodeURIComponent(v)}/`, "@" + v],
  Messenger: (v) => (v.startsWith("https://") ? [v, "Message us"] : [`https://m.me/${encodeURIComponent(v)}`, v]),
};

function applyHandles(data) {
  const box = $(".handles");
  const order = Array.isArray(data.handles) ? data.handles : ["Instagram"];
  const els = $$(".handle", box);
  for (const el of els) el.hidden = true;
  for (const kind of order) {
    const el = els.find((x) => x.dataset.handle === kind);
    const value = data[kind.toLowerCase()];
    if (!el || !value || !HANDLE_LINK[kind]) continue;
    const [href, text] = HANDLE_LINK[kind](value);
    const a = $("a", el);
    a.href = href;
    a.textContent = text;
    el.hidden = false;
    box.append(el);
  }
  box.hidden = els.every((el) => el.hidden);
}

const DEFAULT_CONTACTS = ["Email", "Instagram"];
const CONTACT_PHRASE = { Email: "email you", Messenger: "message you on Messenger", Instagram: "message you on Instagram" };

function applyContactFields(list) {
  const methods = (Array.isArray(list) ? list : DEFAULT_CONTACTS).filter((m) => m in CONTACT_PHRASE);
  if (!methods.length) methods.push(...DEFAULT_CONTACTS);
  const choice = $(".contact-choice .choice", form);
  const radios = [...form.elements.contactVia];
  for (const r of radios) r.closest("label").hidden = !methods.includes(r.value);
  for (const m of methods) choice.append(radios.find((r) => r.value === m).closest("label"));
  if (!methods.includes(form.elements.contactVia.value)) radios.find((r) => r.value === methods[0]).checked = true;
  $(".contact-choice", form).hidden = methods.length === 1;
  syncContactFields();
}

function syncContactFields() {
  const via = form.elements.contactVia.value;
  for (const el of $$("[data-contact]", form)) {
    const on = el.dataset.contact === via;
    el.hidden = !on;
    $("input", el).required = on;
  }
}

function clearErrors() {
  for (const el of $$("[data-error]", form)) el.textContent = "";
  for (const el of $$("[aria-invalid]", form)) el.removeAttribute("aria-invalid");
  $(".form-error", form).textContent = "";
}

function fieldError(field, msg) {
  const slot = $(`[data-error="${field}"]`, form);
  const input = form.elements[field];
  if (!slot) {
    $(".form-error", form).textContent = msg;
    return;
  }
  slot.textContent = msg;
  if (input && input.setAttribute) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
}

function checkForm() {
  const f = form.elements;
  if (!f.name.value.trim()) return ["name", "Please enter your name."];
  if (f.contactVia.value === "Email" && (!f.email.value.trim() || !f.email.validity.valid)) {
    return ["email", "Please enter a valid email address."];
  }
  if (f.contactVia.value === "Instagram" && !f.instagram.value.trim().replace(/^@/, "")) {
    return ["instagram", "Please enter your Instagram username."];
  }
  if (f.contactVia.value === "Messenger" && !f.messenger.value.trim()) {
    return ["messenger", "Please enter your Facebook username or profile link."];
  }
  if (!f.mobile.value.trim()) return ["mobile", "Please enter your mobile number."];
  return null;
}

async function submitOrder(event) {
  event.preventDefault();
  clearErrors();
  const problem = checkForm();
  if (problem) {
    fieldError(...problem);
    return;
  }

  const f = form.elements;
  const body = {
    name: f.name.value,
    contactVia: f.contactVia.value,
    email: f.contactVia.value === "Email" ? f.email.value : "",
    instagram: f.contactVia.value === "Instagram" ? f.instagram.value : "",
    mobile: f.mobile.value,
    items: cartItems(),
    website: f.website.value,
  };
  if (body.contactVia === "Messenger") body.messenger = f.messenger.value;

  const button = $("button[type=submit]", form);
  const label = $(".button-label", button);
  button.disabled = true;
  label.textContent = "Submitting pre-order…";
  try {
    const { status, data } = await api.order(body);

    if (status === 201) {
      showDone(data, body.contactVia);
    } else if (status === 403 && data.closed) {
      closeShop(data.error);
    } else if (status === 400 && data.field) {
      fieldError(data.field, data.error);
    } else if (status === 409 && data.sku) {
      const p = state.bySku.get(data.sku);
      if (p) p.available = data.available;
      const changed = new Set(reconcileCart());
      if (p) changed.add(p.sku);
      if (p) updateProduct(p.sku, false);
      updateCartbar();
      renderLines(changed);
      $(".form-error", form).textContent = state.cart.size
        ? `${data.error} We've updated your pre-order to match. Check it and send again.`
        : data.error;
    } else {
      $(".form-error", form).textContent = data.error || "Your pre-order wasn't sent. Please try again in a moment.";
    }
  } catch {
    $(".form-error", form).textContent = "Couldn't reach the shop. Check your connection and try again.";
  } finally {
    button.disabled = document.body.classList.contains("closed");
    label.textContent = "Submit pre-order";
  }
}

function showDone(data, contactVia) {
  $(".order-id", orderDialog).textContent = data.orderId;
  $(".done-note", orderDialog).textContent =
    `Estimated total ${peso(data.total)}. Keep this number for reference. We'll check your pre-order and ` +
    (CONTACT_PHRASE[contactVia] || "contact you") +
    " with payment details.";
  showView("done");
  state.cart.clear();
  saveCart();
  updateCartbar();
  loadShop();
}

function isHex(c) {
  return /^#[0-9a-f]{6}$/.test(c || "");
}

function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function appendRich(el, text) {
  const mark = /\*\*(.+?)\*\*|__(.+?)__/;
  let m;
  while ((m = mark.exec(text))) {
    if (m.index) el.append(text.slice(0, m.index));
    const span = document.createElement(m[1] !== undefined ? "strong" : "u");
    appendRich(span, m[1] ?? m[2]);
    el.append(span);
    text = text.slice(m.index + m[0].length);
  }
  if (text) el.append(text);
}

function setRich(el, text) {
  el.replaceChildren();
  if (text) appendRich(el, text);
  el.hidden = !text;
}

function closeShop(message) {
  document.body.classList.add("closed");
  const note = $(".closed-note");
  setRich(note, message);
  if (orderDialog.open) {
    $(".form-error", form).textContent = message;
    $("button[type=submit]", form).disabled = true;
  }
  emit("closed", message);
}

let closeTimer = 0;

function applySettings(data) {
  if (!data) return;
  clearTimeout(closeTimer);
  if (data.open === false) {
    closeShop(data.closedMessage);
  } else if (data.closesAt) {
    const ms = Date.parse(data.closesAt) - Date.now();
    if (ms > 0 && ms < 2 ** 31) closeTimer = setTimeout(() => closeShop(data.closedMessage), ms);
  }
  const theme = THEMES.includes(data.theme) ? data.theme : THEMES[0];
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  const root = document.documentElement.style;
  if (isHex(data.themeColor)) {
    root.setProperty("--brand", data.themeColor);
    root.setProperty("--on-brand", contrast(data.themeColor, "#ffffff") >= 4.5 ? "#ffffff" : "var(--on-light)");
  }
  if (isHex(data.accentColor) && theme !== "dark") root.setProperty("--accent", data.accentColor);
  $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  if (isHex(data.submitColor)) {
    root.setProperty("--submit", data.submitColor);
    root.setProperty("--on-submit", contrast(data.submitColor, "#ffffff") >= 4.5 ? "#ffffff" : "var(--on-light)");
  }
  setRich($(".subheading"), data.subheading);
  const notes = $(".notes");
  notes.replaceChildren();
  for (const note of data.notes || []) {
    const li = document.createElement("li");
    appendRich(li, note);
    notes.append(li);
  }
  notes.hidden = !notes.children.length;
  applyHandles(data);
  applyContactFields(data.contactFields);
  setRich($(".form-note", orderDialog), data.formNote);
  if (data.orderNote) setRich($(".fineprint", orderDialog), data.orderNote);
}

function showStatus(message, retry) {
  const p = document.createElement("p");
  p.className = "status";
  p.textContent = message;
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Try again";
    button.addEventListener("click", () => {
      p.textContent = "Loading products…";
      loadShop();
    });
    p.append(button);
  }
  shop.replaceChildren(p);
}

async function loadShop() {
  if (!CONFIGURED) {
    showStatus("This shop isn't connected yet: put the web app URL in config.js.");
    return;
  }
  let data;
  try {
    const [res, photos] = await Promise.all([api.shop(), photoManifest(), scriptsLoaded]);
    if (res.status !== 200) throw new Error(res.data.error);
    data = res.data;
    for (const p of data.products) {
      if (!p.photo && photos[p.sku]) p.photo = p.thumb = "img/" + photos[p.sku];
    }
  } catch (err) {
    if (!state.products.length) showStatus((err && err.message) || "Products couldn't be loaded.", true);
    return;
  }
  applySettings(data.settings);
  state.products = data.products;
  state.bySku = new Map(data.products.map((p) => [p.sku, p]));
  reconcileCart();
  renderShop();
  pricing.quote = null;
  updateCartbar();
  emit("products");
}

function qtyClick(e) {
  const add = e.target.closest(".add");
  if (add) {
    setQty(add.dataset.sku, 1);
    return true;
  }
  const step = e.target.closest(".step");
  if (!step) return false;
  const sku = step.closest(".stepper").dataset.sku;
  setQty(sku, (state.cart.get(sku) || 0) + Number(step.dataset.step));
  return true;
}

shop.addEventListener("click", qtyClick);

$(".lines", orderDialog).addEventListener("click", (e) => {
  const step = e.target.closest(".step");
  if (!step) return;
  const sku = step.closest(".stepper").dataset.sku;
  setQty(sku, (state.cart.get(sku) || 0) + Number(step.dataset.step));
  const again = $(`.stepper[data-sku="${CSS.escape(sku)}"] .step[data-step="${step.dataset.step}"]`, orderDialog);
  (again && !again.disabled ? again : $(".close", orderDialog))?.focus();
});

$(".nav-logo").addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0 });
});

picker.addEventListener("change", () => {
  document.getElementById(picker.value)?.scrollIntoView();
});

$(".cartbar-button").addEventListener("click", openOrder);
$(".nav-cart").addEventListener("click", openOrder);
form.addEventListener("submit", submitOrder);
form.addEventListener("change", (e) => {
  if (e.target.name === "contactVia") syncContactFields();
});

orderDialog.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target === orderDialog) orderDialog.close();
});

const hooks = { card: [], line: [], cart: [], products: [], closed: [] };
const tracked = new Set();

function emit(name, ...args) {
  for (const fn of hooks[name]) {
    try {
      fn(...args);
    } catch (err) {
      console.error(`"${name}" hook failed`, err);
    }
  }
}

window.ShopPage = Object.freeze({
  version: 1,
  config: CONFIG,
  on(name, fn) {
    if (!hooks[name] || typeof fn !== "function") throw new Error(`ShopPage.on: unknown hook "${name}"`);
    hooks[name].push(fn);
  },
  setPricing(fn) {
    pricing.fn = typeof fn === "function" ? fn : null;
    pricing.quote = null;
    if (state.products.length) updateCartbar();
  },
  product: (sku) => state.bySku.get(sku),
  qty: (sku) => state.cart.get(sku) || 0,
  setQty,
  qtyClick,
  track(el) {
    tracked.add(el);
    const p = state.bySku.get(el.dataset.sku);
    if (p) fillProduct(el, p);
  },
  fillSubline,
  peso,
});

function loadScripts() {
  const list = Array.isArray(CONFIG.scripts) ? CONFIG.scripts : [];
  return Promise.all(list.map((src) => new Promise((resolve) => {
    if (typeof src !== "string" || !/^[\w-][\w.-]*\.js$/.test(src)) {
      console.error("config.js scripts: skipping", src);
      return resolve();
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = script.onerror = () => resolve();
    document.head.append(script);
  })));
}

const scriptsLoaded = loadScripts();

loadCart();
applyContactFields();
watchNavHeight();
watchMasthead();
watchCartbar();
loadShop();
