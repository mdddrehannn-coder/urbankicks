const app = document.getElementById("app");
const cartCount = document.getElementById("cartCount");
const wishCount = document.getElementById("wishCount");
const navToggle = document.getElementById("navToggle");

const CART_KEY = "urbanKicksCart";
const SESSION_KEY = "urbanKicksSession";
const WISH_KEY = "urbanKicksWishlist";
const THEME_KEY = "urbanKicksTheme";

let catalogCache = null;
let wishlistCache = null;
let authRefreshTimer = null;
let supabaseClient = null;
let supabaseClientPromise = null;

const categorySeed = [
  { slug: "speed-runners", title: "Speed Runners", copy: "Responsive shoes for fast city movement.", accent: "pink" },
  { slug: "hero-high-tops", title: "Hero High Tops", copy: "Tall silhouettes with loud street presence.", accent: "cyan" },
  { slug: "cloud-comfort", title: "Cloud Comfort", copy: "Soft landings and premium knit comfort.", accent: "volt" },
  { slug: "arcade-trainers", title: "Arcade Trainers", copy: "Gym-ready grip with animated neon energy.", accent: "sun" }
];

const money = (value) => `Rs ${Number(value || 0).toLocaleString("en-IN")}`;
const salePrice = (product) => Math.round(product.price * (1 - (product.discountPercent || 0) / 100));
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
}[char]));

function getStore(key, fallback) {
  return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
}

function setStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  renderCounters();
}

function getSession() {
  return getStore(SESSION_KEY, null);
}

function setSession(session) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    renderCounters();
    return;
  }
  setStore(SESSION_KEY, session);
  window.dispatchEvent(new CustomEvent("urban-kicks-auth", { detail: { event: "SIGNED_IN", session } }));
}

function getUser() {
  return getSession()?.user || null;
}

function authHeaders() {
  const token = getSession()?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJsonResponse(res, fallback = "Request failed") {
  const text = await res.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      const contentType = res.headers.get("content-type") || "unknown";
      const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(`${fallback}. The server returned ${contentType}: ${preview || "non-JSON response"}`);
    }
  }

  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || fallback);
  }

  return payload;
}

async function api(path, options = {}) {
  const headers = {
    ...authHeaders(),
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };
  const res = await fetch(path, { ...options, headers });
  return readJsonResponse(res);
}

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (supabaseClientPromise) return supabaseClientPromise;

  supabaseClientPromise = (async () => {
    if (!window.supabase?.createClient) {
      throw new Error("Supabase browser SDK failed to load.");
    }

    const configResponse = await fetch("/api/config/supabase", {
      headers: { Accept: "application/json" }
    });
    const config = await readJsonResponse(configResponse, "Could not load store authentication settings");
    if (!config.url || !config.anonKey) {
      throw new Error("Supabase URL or anon key is missing.");
    }

    supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "urban-kicks-supabase-auth"
      }
    });

    console.log("[auth] Supabase client initialized", config.url);
    return supabaseClient;
  })();

  return supabaseClientPromise;
}

async function syncSessionFromSupabase(session) {
  setSession(session);
  wishlistCache = null;
  await renderCounters();
}

async function upsertUserProfile(user, extra = {}) {
  if (!user) return;

  try {
    await api("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify({
        id: user.id,
        name: extra.name || user.user_metadata?.name || "Urban Kicks Member",
        email: user.email || extra.email || "",
        mobile: extra.mobile || user.phone || user.user_metadata?.mobile || ""
      })
    });
    console.log("[auth] user profile synced");
  } catch (error) {
    console.warn("[auth] profile sync failed", error.message);
  }
}

function showAuthError(error, fallback = "Authentication failed") {
  console.error("[auth]", error);
  alert(error?.message || fallback);
}

async function refreshSession() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.refreshSession();
    if (error) throw error;
    if (data.session) {
      await syncSessionFromSupabase(data.session);
      console.log("[auth] session refreshed");
    }
  } catch (error) {
    console.warn("[auth] session refresh failed", error.message);
    localStorage.removeItem(SESSION_KEY);
    wishlistCache = null;
    renderCounters();
  }
}

async function verifySession() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) {
      await syncSessionFromSupabase(data.session);
      console.log("[auth] existing session restored");
      return;
    }
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn("[auth] session restore failed", error.message);
  }
}

async function setupAuthStateListener() {
  const client = await getSupabaseClient();
  const { data } = client.auth.onAuthStateChange(async (event, session) => {
    console.log(`[auth] Supabase state changed: ${event}`);
    if (session) {
      await syncSessionFromSupabase(session);
    } else {
      localStorage.removeItem(SESSION_KEY);
      wishlistCache = null;
      await renderCounters();
    }
    window.dispatchEvent(new CustomEvent("urban-kicks-auth", { detail: { event, session } }));
  });
  window.urbanKicksAuthSubscription = data?.subscription;
}

function getCart() {
  return getStore(CART_KEY, []);
}

function saveCart(cart) {
  setStore(CART_KEY, cart);
}

function localWishlist() {
  return getStore(WISH_KEY, []);
}

async function getWishlist() {
  if (!getSession()) return localWishlist();
  if (wishlistCache) return wishlistCache;
  try {
    wishlistCache = await api("/api/wishlist");
  } catch (_error) {
    wishlistCache = localWishlist();
  }
  return wishlistCache;
}

async function renderCounters() {
  cartCount.textContent = getCart().reduce((sum, item) => sum + item.quantity, 0);
  const wishlist = wishlistCache || localWishlist();
  wishCount.textContent = wishlist.length;
}

function closeNav() {
  document.querySelector(".nav-links").classList.remove("open");
}

function sectionHead(eyebrow, title, copy, action = "") {
  return `
    <div class="section-head">
      <div>
        <p class="eyebrow">${safe(eyebrow)}</p>
        <h2>${safe(title)}</h2>
        ${copy ? `<p>${safe(copy)}</p>` : ""}
      </div>
      ${action}
    </div>
  `;
}

async function getProducts() {
  if (catalogCache) return catalogCache;
  catalogCache = await api("/api/products");
  return catalogCache;
}

function productCard(product, wishlist = []) {
  const wished = wishlist.includes(product._id);
  return `
    <article class="product-card">
      <a class="product-media" href="#/product/${product._id}">
        <span class="chip pink discount-badge">${product.discountPercent || 0}% OFF</span>
        <img src="${product.imageUrl}" alt="${safe(product.name)}" loading="lazy">
      </a>
      <div class="product-body">
        <div class="meta">${safe(product.brand)} / ${safe(product.category)}</div>
        <h3>${safe(product.name)}</h3>
        <div class="price-row">
          <span class="price">${money(salePrice(product))}</span>
          <span class="strike">${money(product.price)}</span>
        </div>
        <div class="actions">
          <button class="icon-button ${wished ? "active" : ""}" title="Wishlist" onclick="toggleWishlist('${product._id}')">♡</button>
          <button class="button light" onclick="quickAdd('${product._id}')">Add</button>
          <a class="button dark" href="#/product/${product._id}">Buy</a>
        </div>
      </div>
    </article>
  `;
}

function categoryCard(category, products) {
  const product = products.find((item) => item.category.toLowerCase() === category.title.toLowerCase()) || products[0];
  return `
    <a class="category-card" href="#/category/${category.slug}">
      <span class="chip ${category.accent === "pink" ? "pink" : "cyan"}">New Drops</span>
      <h3>${safe(category.title)}</h3>
      <p class="meta">${safe(category.copy)}</p>
      ${product ? `<img src="${product.imageUrl}" alt="${safe(category.title)}">` : ""}
    </a>
  `;
}

async function homePage() {
  const [products, wishlist] = await Promise.all([getProducts(), getWishlist()]);
  const featured = products.filter((product) => product.featured).slice(0, 4);
  const trending = products.filter((product) => product.trending).slice(0, 4);
  const brands = [...new Set(products.map((product) => product.brand))];
  const heroProduct = products[0];

  app.innerHTML = `
    <section class="hero">
      <div class="hero-shell">
        <div>
          <div class="hero-brand-lockup">
            <img src="/assets/urban-kicks-logo.png" alt="Urban Kicks official logo">
          </div>
          <p class="eyebrow">Official online sneaker store / COD ready</p>
          <h1>Urban Kicks</h1>
          <p>Premium street sneakers with secure accounts, persistent sessions, wishlist sync, order history, transaction records, and stock-aware checkout.</p>
          <form class="search-panel" id="searchForm">
            <span class="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"></path></svg></span>
            <input name="q" placeholder="Search shoes, brands, drops..." aria-label="Search shoes">
            <button class="search-submit" type="submit">Search</button>
          </form>
          <div class="hero-actions">
            <a class="button primary" href="#/categories">Shop categories</a>
            <a class="button ghost" href="#/auth">${getUser() ? "Account" : "Login"}</a>
          </div>
        </div>
        <div class="sneaker-stage" aria-label="Sneaker showcase">
          <div class="burst"></div>
          <div class="hero-logo-orbit"><img src="/assets/urban-kicks-logo.png" alt="Urban Kicks logo mark"></div>
          ${heroProduct ? `<div class="hero-shoe"><img src="${heroProduct.imageUrl}" alt="${safe(heroProduct.name)}"></div>` : ""}
          <div class="offer-stickers">
            <span class="sticker">Supabase Auth</span>
            <span class="sticker">COD Orders</span>
            <span class="sticker">Live Stock</span>
          </div>
        </div>
      </div>
    </section>
    <section class="section band" id="categories">
      ${sectionHead("Collections", "Choose your lane", "Each category opens a dedicated Supabase product listing.", '<a class="button light" href="#/categories">View all</a>')}
      <div class="category-grid">${categorySeed.map((category) => categoryCard(category, products)).join("")}</div>
    </section>
    <section class="section">
      ${sectionHead("Featured", "Editor picks", "Curated launch shoes with wishlist and cart actions.")}
      <div class="product-grid">${featured.map((product) => productCard(product, wishlist)).join("")}</div>
    </section>
    <section class="section band">
      ${sectionHead("Trending", "Street heat right now", "Fast-moving sneakers with discounts, stock labels, and COD checkout.")}
      <div class="product-grid">${trending.map((product) => productCard(product, wishlist)).join("")}</div>
    </section>
    <section class="section">
      ${sectionHead("Popular brands", "Brand sections", "Browse all shoe varieties by brand.")}
      <div class="brand-grid">
        ${brands.map((brand) => `
          <a class="mini-card" href="#/brand/${encodeURIComponent(brand)}">
            <span class="chip cyan">${products.filter((product) => product.brand === brand).length} styles</span>
            <h3>${safe(brand)}</h3>
            <p class="meta">Browse ${safe(brand)} products from Supabase.</p>
          </a>
        `).join("")}
      </div>
    </section>
  `;
  document.getElementById("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const q = new FormData(event.target).get("q");
    location.hash = `#/search/${encodeURIComponent(q)}`;
  });
}

async function categoriesPage() {
  const products = await getProducts();
  app.innerHTML = `
    <section class="section">
      ${sectionHead("Categories", "Launch collections", "Category cards are backed by the products table.")}
      <div class="category-grid">${categorySeed.map((category) => categoryCard(category, products)).join("")}</div>
    </section>
  `;
}

async function listingPage(kind, value) {
  const [products, wishlist] = await Promise.all([getProducts(), getWishlist()]);
  const needle = value.toLowerCase().replace(/-/g, " ");
  const filtered = products.filter((product) => {
    if (kind === "brand") return product.brand.toLowerCase() === needle;
    if (kind === "category") return product.category.toLowerCase() === needle;
    return [product.name, product.brand, product.category, product.description].join(" ").toLowerCase().includes(needle);
  });
  app.innerHTML = `
    <section class="section">
      ${sectionHead(kind === "search" ? "Search results" : "Collection", value.replace(/-/g, " "), `${filtered.length} shoe varieties available.`, '<a class="button light" href="#/categories">All categories</a>')}
      <div class="product-grid">${filtered.map((product) => productCard(product, wishlist)).join("") || `<div class="mini-card"><h3>No shoes found</h3><p class="meta">Try another search or category.</p></div>`}</div>
    </section>
  `;
}

async function productPage(id) {
  const [products, wishlist] = await Promise.all([getProducts(), getWishlist()]);
  const product = products.find((item) => item._id === id);
  if (!product) return emptyPage("Product not found", "That sneaker may have sold out or moved.");
  const related = products.filter((item) => item._id !== id && (item.brand === product.brand || item.category === product.category)).slice(0, 4);
  const gallery = product.gallery?.length ? product.gallery : [product.imageUrl];
  app.innerHTML = `
    <section class="detail-layout">
      <div class="detail-media">
        <img id="mainProductImage" class="main-product-image" src="${gallery[0]}" alt="${safe(product.name)}">
        <div class="thumb-row">${gallery.map((image) => `<button onclick="swapImage('${image}')"><img src="${image}" alt="${safe(product.name)} view"></button>`).join("")}</div>
      </div>
      <aside class="panel">
        <p class="eyebrow">${safe(product.brand)} / ${safe(product.category)}</p>
        <h1>${safe(product.name)}</h1>
        <div class="price-row"><span class="price">${money(salePrice(product))}</span><span class="strike">${money(product.price)}</span><span class="chip pink">${product.discountPercent || 0}% OFF</span></div>
        <p>${safe(product.description)}</p>
        <p class="meta">Rating ${product.rating || 4.6}/5 from ${product.reviewCount || 0} reviews / Stock: ${product.stock > 0 ? `${product.stock} available` : "Sold out"}</p>
        <h3>Select size</h3>
        <div class="size-options">${product.sizes.map((size, index) => `<label><input type="radio" name="size" value="${safe(size)}" ${index === 0 ? "checked" : ""}>${safe(size)}</label>`).join("")}</div>
        <h3>Select color</h3>
        <div class="color-options">${(product.colors?.length ? product.colors : [product.color]).map((color, index) => `<label><input type="radio" name="color" value="${safe(color)}" ${index === 0 ? "checked" : ""}>${safe(color)}</label>`).join("")}</div>
        <p class="notice">Delivery estimate: ${safe(product.deliveryEstimate || "2-5 business days")}. Payment method: Cash on Delivery only.</p>
        <div class="actions">
          <button class="button primary" onclick="addToCart('${product._id}')">Add to cart</button>
          <button class="button light ${wishlist.includes(product._id) ? "active" : ""}" onclick="toggleWishlist('${product._id}')">Wishlist</button>
          <button class="button dark" onclick="buyNow('${product._id}')">Buy now</button>
        </div>
      </aside>
    </section>
    <section class="section">
      ${sectionHead("Related", "More kicks to chase", "")}
      <div class="product-grid">${related.map((product) => productCard(product, wishlist)).join("")}</div>
    </section>
  `;
}

async function addToCart(id) {
  const products = await getProducts();
  const product = products.find((item) => item._id === id);
  if (!product || product.stock < 1) return alert("This product is out of stock.");
  const size = document.querySelector("input[name='size']:checked")?.value || product.sizes[0];
  const color = document.querySelector("input[name='color']:checked")?.value || product.color;
  const cart = getCart();
  const existing = cart.find((item) => item.productId === id && item.size === size && item.color === color);
  if (existing) existing.quantity += 1;
  else {
    cart.push({
      productId: id,
      name: product.name,
      brand: product.brand,
      price: salePrice(product),
      originalPrice: product.price,
      imageUrl: product.imageUrl,
      size,
      color,
      quantity: 1
    });
  }
  saveCart(cart);
}

async function quickAdd(id) {
  await addToCart(id);
  location.hash = "#/cart";
}

async function buyNow(id) {
  await addToCart(id);
  location.hash = "#/checkout";
}

async function toggleWishlist(id) {
  const current = await getWishlist();
  const exists = current.includes(id);
  const next = exists ? current.filter((item) => item !== id) : [...current, id];
  wishlistCache = next;
  setStore(WISH_KEY, next);

  if (getSession()) {
    try {
      if (exists) await api(`/api/wishlist/${id}`, { method: "DELETE" });
      else await api("/api/wishlist", { method: "POST", body: JSON.stringify({ productId: id }) });
    } catch (error) {
      alert(error.message);
    }
  }
  router();
}

function cartTotals(cart) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = subtotal > 20000 || subtotal === 0 ? 0 : 149;
  return { subtotal, shipping, total: subtotal + shipping };
}

function summaryPanel(totals, checkout = true) {
  return `
    <aside class="panel">
      <h2>Order summary</h2>
      <div class="summary-row"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
      <div class="summary-row"><span>Shipping</span><strong>${totals.shipping ? money(totals.shipping) : "Free"}</strong></div>
      <div class="summary-row total"><span>Total</span><strong>${money(totals.total)}</strong></div>
      <p class="notice">Payment method: Cash on Delivery only.</p>
      ${checkout ? '<a class="button primary" href="#/checkout">Checkout</a>' : ""}
    </aside>
  `;
}

function cartPage() {
  const cart = getCart();
  const totals = cartTotals(cart);
  if (!cart.length) return emptyPage("Your cart is empty", "Pick a pair and it will land here.");
  app.innerHTML = `
    <section class="cart-layout">
      <div class="panel">
        <p class="eyebrow">Persistent cart</p>
        <h1>Your cart</h1>
        ${cart.map((item, index) => `
          <article class="cart-item">
            <img src="${item.imageUrl}" alt="${safe(item.name)}">
            <div>
              <strong>${safe(item.name)}</strong>
              <div class="meta">${safe(item.brand)} / Size ${safe(item.size)} / ${safe(item.color)}</div>
              <div>${money(item.price)}</div>
              <div class="quick-row">
                <button class="icon-button" onclick="changeQty(${index}, -1)">-</button>
                <strong>${item.quantity}</strong>
                <button class="icon-button" onclick="changeQty(${index}, 1)">+</button>
              </div>
            </div>
            <div class="actions"><button class="button danger" onclick="removeItem(${index})">Remove</button></div>
          </article>
        `).join("")}
      </div>
      ${summaryPanel(totals, true)}
    </section>
  `;
}

function changeQty(index, delta) {
  const cart = getCart();
  cart[index].quantity += delta;
  if (cart[index].quantity < 1) cart.splice(index, 1);
  saveCart(cart);
  cartPage();
}

function removeItem(index) {
  const cart = getCart();
  cart.splice(index, 1);
  saveCart(cart);
  cartPage();
}

function checkoutPage() {
  const cart = getCart();
  if (!cart.length) return cartPage();
  const totals = cartTotals(cart);
  app.innerHTML = `
    <section class="checkout-layout">
      <div class="panel">
        <p class="eyebrow">Checkout</p>
        <h1>Delivery details</h1>
        <form class="form" id="checkoutForm">
          <label>Full name<input name="name" required value="${safe(getUser()?.user_metadata?.name || "")}" placeholder="Your name"></label>
          <label>Email<input name="email" type="email" required value="${safe(getUser()?.email || "")}" placeholder="you@example.com"></label>
          <label>Mobile number<input name="phone" required placeholder="+91 90000 00000"></label>
          <label>City<input name="city" required placeholder="Bengaluru"></label>
          <label>Address<textarea name="address" rows="4" required placeholder="House, street, area"></textarea></label>
          <label>Payment method<input value="Cash on Delivery" disabled></label>
          <button class="button primary" type="submit">Place order</button>
        </form>
      </div>
      ${summaryPanel(totals, false)}
    </section>
  `;
  document.getElementById("checkoutForm").addEventListener("submit", placeOrder);
}

async function placeOrder(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const order = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ customer: data, items: getCart() })
  });
  localStorage.removeItem(CART_KEY);
  catalogCache = null;
  renderCounters();
  location.hash = `#/confirmation/${order._id}`;
}

function confirmationPage(orderId) {
  app.innerHTML = `
    <div class="empty-state">
      <p class="eyebrow">Order confirmed</p>
      <h1>Drop secured</h1>
      <p class="meta">Order ID: ${safe(orderId)}. Your transaction record was saved as Cash on Delivery.</p>
      <a class="button primary" href="#/profile">View order history</a>
    </div>
  `;
}

async function wishlistPage() {
  const [products, wishlist] = await Promise.all([getProducts(), getWishlist()]);
  const wishedProducts = products.filter((product) => wishlist.includes(product._id));
  app.innerHTML = `
    <section class="section">
      ${sectionHead("Favorites", "Wishlist vault", getSession() ? "Your saved sneakers are ready." : "Login to sync wishlist across devices.")}
      <div class="product-grid">${wishedProducts.map((product) => productCard(product, wishlist)).join("") || '<article class="mini-card"><h3>No favorites yet</h3><p class="meta">Tap the heart on a sneaker to save it.</p></article>'}</div>
    </section>
  `;
}

function authPage() {
  const user = getUser();
  if (user) {
    app.innerHTML = `
      <section class="section">
        ${sectionHead("Account", "You are logged in", `Signed in as ${user.email || "Urban Kicks member"}.`)}
        <button class="button danger" onclick="logout()">Logout</button>
      </section>
    `;
    return;
  }
  app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-brand-panel">
        <img src="/assets/urban-kicks-logo.png" alt="Urban Kicks official logo">
        <h2>Step into your sneaker account</h2>
        <p>Save favorites, track orders, manage COD checkout, and keep every Urban Kicks drop close.</p>
      </div>
      <div class="panel">
        <p class="eyebrow">Login</p>
        <h1>Welcome back</h1>
        <form class="form" id="loginForm">
          <label>Email<input name="email" type="email" required placeholder="you@example.com"></label>
          <label>Password<input name="password" type="password" required placeholder="Your password"></label>
          <button class="button primary" type="submit">Login</button>
        </form>
      </div>
      <div class="panel">
        <p class="eyebrow">Signup</p>
        <h1>Create account</h1>
        <form class="form" id="signupForm">
          <label>Name<input name="name" required placeholder="Your name"></label>
          <label>Email<input name="email" type="email" required placeholder="you@example.com"></label>
          <label>Mobile number<input name="mobile" required placeholder="+91 90000 00000"></label>
          <label>Password<input name="password" type="password" required minlength="6" placeholder="At least 6 characters"></label>
          <button class="button dark" type="submit">Signup</button>
        </form>
      </div>
    </section>
  `;
  document.getElementById("loginForm").addEventListener("submit", login);
  document.getElementById("signupForm").addEventListener("submit", signup);
}

async function login(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] signInWithPassword attempt for ${data.email}`);
    const { data: authData, error } = await client.auth.signInWithPassword({
      email: data.email,
      password: data.password
    });
    if (error) throw error;
    if (!authData.session) {
      throw new Error("Login succeeded but no session was returned. Check email confirmation settings.");
    }
    await syncSessionFromSupabase(authData.session);
    wishlistCache = null;
    await getWishlist();
    console.log(`[auth] login success for ${data.email}`);
    location.hash = "#/profile";
  } catch (error) {
    showAuthError(error, "Invalid login. Check your email and password.");
  }
}

async function signup(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] signUp attempt for ${data.email}`);
    const { data: authData, error } = await client.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          mobile: data.mobile
        },
        emailRedirectTo: `${window.location.origin}/#/auth`
      }
    });
    if (error) throw error;

    if (authData.session) {
      await syncSessionFromSupabase(authData.session);
      await upsertUserProfile(authData.user, data);
      wishlistCache = null;
      console.log(`[auth] signup success with active session for ${data.email}`);
      location.hash = "#/profile";
      return;
    }

    console.log("[auth] signup created user but email confirmation is required");
    alert("Signup successful. Please check your email to confirm your account, then log in.");
    location.hash = "#/auth";
  } catch (error) {
    showAuthError(error, "Signup failed. Check your details and try again.");
  }
}

async function logout() {
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    console.log("[auth] signed out with Supabase client");
  } catch (error) {
    console.warn("[auth] Supabase signOut failed", error.message);
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
  }
  localStorage.removeItem(SESSION_KEY);
  if (authRefreshTimer) clearTimeout(authRefreshTimer);
  wishlistCache = null;
  renderCounters();
  window.dispatchEvent(new CustomEvent("urban-kicks-auth", { detail: { event: "SIGNED_OUT", session: null } }));
  location.hash = "#/";
}

async function profilePage() {
  const session = getSession();
  if (!session) return authPage();
  const [orders, transactions] = await Promise.all([
    api("/api/orders/mine").catch(() => []),
    api("/api/transactions").catch(() => [])
  ]);
  app.innerHTML = `
    <section class="section">
      ${sectionHead("Profile", "Your account", "Saved orders, checkout details, and transaction records.")}
      <div class="schema-grid">
        <article class="mini-card"><h3>${safe(session.user?.user_metadata?.name || "Urban Kicks Member")}</h3><p class="meta">${safe(session.user?.email || "")}</p><button class="button danger" onclick="logout()">Logout</button></article>
        <article class="mini-card"><h3>Order history</h3><p class="meta">${orders.length} saved orders</p></article>
        <article class="mini-card"><h3>Transactions</h3><p class="meta">${transactions.length} COD transaction records</p></article>
      </div>
      <div class="admin-table">
        ${orders.map((order) => `<article class="order-card"><div><strong>${safe(order.status)}</strong><div class="meta">${money(order.total)} / ${safe(order.paymentMethod)} / ${safe(order.createdAt || "")}</div></div></article>`).join("")}
      </div>
    </section>
  `;
}

function settingsPage() {
  app.innerHTML = `
    <section class="section">
      ${sectionHead("Settings", "Store controls", "Manage your shopping preferences and checkout options.")}
      <div class="schema-grid">
        <article class="mini-card"><h3>Theme</h3><p class="meta">Toggle dark/light styling.</p><button class="button primary" onclick="toggleTheme()">Toggle theme</button></article>
        <article class="mini-card"><h3>Payment</h3><p class="meta">Cash on Delivery only.</p></article>
        <article class="mini-card"><h3>Account data</h3><p class="meta">Saved products, orders, and profile details.</p></article>
      </div>
    </section>
  `;
}

async function adminPage() {
  const [products, orders] = await Promise.all([getProducts(), api("/api/orders").catch(() => [])]);
  app.innerHTML = `
    <section class="admin-layout">
      <div class="panel">
        <p class="eyebrow">Admin panel</p>
        <h1 id="adminTitle">Add product</h1>
        <form class="form" id="productForm">
          <input type="hidden" name="id">
          <label>Name<input name="name" required></label>
          <label>Brand<input name="brand" required></label>
          <label>Category<input name="category" required></label>
          <label>Price<input name="price" type="number" min="0" required></label>
          <label>Discount %<input name="discountPercent" type="number" min="0" max="90" value="0"></label>
          <label>Sizes<input name="sizes" required placeholder="39, 40, 41, 42"></label>
          <label>Colors<input name="colors" placeholder="Black, White"></label>
          <label>Stock<input name="stock" type="number" min="0" required></label>
          <label>Description<textarea name="description" rows="4" required></textarea></label>
          <label>Product image<input name="image" type="file" accept="image/*"></label>
          <label class="inline-check"><input name="featured" type="checkbox" value="true"> Featured</label>
          <label class="inline-check"><input name="trending" type="checkbox" value="true"> Trending</label>
          <button class="button primary" type="submit">Save product</button>
          <button class="button light" type="button" onclick="resetAdminForm()">Clear</button>
        </form>
      </div>
      <div class="panel">
        <h2>Products</h2>
        <div class="admin-table">${products.map(adminProductRow).join("")}</div>
        <h2 style="margin-top:28px">Orders</h2>
        <div class="admin-table">${orders.map(orderRow).join("") || '<p class="meta">No orders yet.</p>'}</div>
      </div>
    </section>
  `;
  const form = document.getElementById("productForm");
  form.elements.image.required = true;
  form.addEventListener("submit", saveProduct);
}

function adminProductRow(product) {
  return `
    <article class="admin-row">
      <img src="${product.imageUrl}" alt="${safe(product.name)}">
      <div><strong>${safe(product.name)}</strong><div class="meta">${safe(product.category)} / ${money(salePrice(product))} / Stock ${product.stock}</div></div>
      <div class="admin-actions">
        <button class="button light" onclick='editProduct(${JSON.stringify(product)})'>Edit</button>
        <button class="button danger" onclick="deleteProduct('${product._id}')">Delete</button>
      </div>
    </article>
  `;
}

function orderRow(order) {
  return `
    <article class="order-card">
      <div><strong>${safe(order.customer?.name || "Customer")}</strong><div class="meta">${safe(order.customer?.city || "")} / ${money(order.total)} / ${safe(order.paymentMethod)} / ${safe(order.status)}</div></div>
      <div class="admin-actions">
        <select onchange="updateOrderStatus('${order._id}', this.value)">
          ${["Pending", "Confirmed", "Shipped", "Delivered", "Cancelled"].map((status) => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>
    </article>
  `;
}

function editProduct(product) {
  const form = document.getElementById("productForm");
  document.getElementById("adminTitle").textContent = "Edit product";
  form.elements.id.value = product._id;
  form.elements.name.value = product.name;
  form.elements.brand.value = product.brand;
  form.elements.category.value = product.category;
  form.elements.price.value = product.price;
  form.elements.discountPercent.value = product.discountPercent || 0;
  form.elements.sizes.value = product.sizes.join(", ");
  form.elements.colors.value = product.colors.join(", ");
  form.elements.stock.value = product.stock;
  form.elements.description.value = product.description;
  form.elements.featured.checked = product.featured;
  form.elements.trending.checked = product.trending;
  form.elements.image.required = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetAdminForm() {
  const form = document.getElementById("productForm");
  document.getElementById("adminTitle").textContent = "Add product";
  form.reset();
  form.elements.id.value = "";
  form.elements.image.required = true;
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const id = formData.get("id");
  if (!id && !formData.get("image").name) return alert("Please upload a product image.");
  if (id && !formData.get("image").name) formData.delete("image");
  await fetch(id ? `/api/products/${id}` : "/api/products", {
    method: id ? "PUT" : "POST",
    headers: authHeaders(),
    body: formData
  }).then(async (res) => {
    await readJsonResponse(res, "Could not save product");
  });
  catalogCache = null;
  await adminPage();
}

async function deleteProduct(id) {
  await api(`/api/products/${id}`, { method: "DELETE" });
  catalogCache = null;
  await adminPage();
}

async function updateOrderStatus(id, status) {
  await api(`/api/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}

function infoPage(title) {
  app.innerHTML = `
    <section class="section">
      ${sectionHead("Urban Kicks", title, "Online sneaker shopping built for fast drops and easy checkout.")}
      <div class="mini-card"><p class="meta">Update this section with production copy before launch.</p></div>
    </section>
  `;
}

function emptyPage(title, copy) {
  app.innerHTML = `<div class="empty-state"><h1>${safe(title)}</h1><p class="meta">${safe(copy)}</p><a class="button primary" href="#/">Back home</a></div>`;
}

function swapImage(image) {
  document.getElementById("mainProductImage").src = image;
}

function toggleTheme() {
  document.body.classList.toggle("light-mode");
  localStorage.setItem(THEME_KEY, document.body.classList.contains("light-mode") ? "light" : "dark");
}

async function router() {
  renderCounters();
  closeNav();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (!parts.length) return homePage();
    if (parts[0] === "categories") return categoriesPage();
    if (parts[0] === "category") return listingPage("category", decodeURIComponent(parts[1]));
    if (parts[0] === "brand") return listingPage("brand", decodeURIComponent(parts[1]));
    if (parts[0] === "search") return listingPage("search", decodeURIComponent(parts.slice(1).join(" ")));
    if (parts[0] === "product") return productPage(parts[1]);
    if (parts[0] === "cart") return cartPage();
    if (parts[0] === "checkout") return checkoutPage();
    if (parts[0] === "confirmation") return confirmationPage(parts[1]);
    if (parts[0] === "wishlist") return wishlistPage();
    if (parts[0] === "auth") return authPage();
    if (parts[0] === "profile") return profilePage();
    if (parts[0] === "settings") return settingsPage();
    if (parts[0] === "admin") return adminPage();
    if (["about", "terms", "privacy"].includes(parts[0])) return infoPage(parts[0].replace(/^\w/, (c) => c.toUpperCase()));
    return homePage();
  } catch (error) {
    emptyPage("Something went wrong", error.message);
  }
}

window.addToCart = addToCart;
window.quickAdd = quickAdd;
window.buyNow = buyNow;
window.toggleWishlist = toggleWishlist;
window.changeQty = changeQty;
window.removeItem = removeItem;
window.swapImage = swapImage;
window.toggleTheme = toggleTheme;
window.logout = logout;
window.editProduct = editProduct;
window.resetAdminForm = resetAdminForm;
window.deleteProduct = deleteProduct;
window.updateOrderStatus = updateOrderStatus;

navToggle.addEventListener("click", () => document.querySelector(".nav-links").classList.toggle("open"));
window.addEventListener("hashchange", router);
window.addEventListener("urban-kicks-auth", (event) => {
  console.log(`[auth] state changed: ${event.detail.event}`);
});

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem(THEME_KEY) === "light") document.body.classList.add("light-mode");
  setupAuthStateListener().catch((error) => console.error("[auth] listener setup failed", error));
  verifySession();
  router();
});
