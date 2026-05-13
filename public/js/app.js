const app = document.getElementById("app");
const cartCount = document.getElementById("cartCount");
const wishCount = document.getElementById("wishCount");
const navToggle = document.getElementById("navToggle");
const toastRegion = document.getElementById("toastRegion");
const headerSearchForm = document.getElementById("headerSearchForm");
const mobileSearchButton = document.getElementById("mobileSearchButton");
const mobileCartCount = document.getElementById("mobileCartCount");
const mobileHeaderCartCount = document.getElementById("mobileHeaderCartCount");

const CART_KEY = "urbanKicksCart";
const SESSION_KEY = "urbanKicksSession";
const WISH_KEY = "urbanKicksWishlist";
const THEME_KEY = "urbanKicksTheme";
const OTP_COOLDOWN_KEY = "urbanKicksOtpCooldown";
const EMAIL_OTP_LENGTH = 6;
const EMAIL_AUTH_COOLDOWN_SECONDS = 60;

let catalogCache = null;
let wishlistCache = null;
let authRefreshTimer = null;
let supabaseClient = null;
let supabaseClientPromise = null;
let emailAuthState = {
  email: "",
  profileData: null,
  flow: "",
  shouldCreateUser: false,
  cooldownUntil: 0,
  timer: null,
  inFlight: false
};

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

function errorToMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error && typeof error.message === "string" && error.message !== "[object Object]") {
    return error.message;
  }
  if (typeof error.message === "string" && error.message !== "[object Object]") return error.message;
  if (typeof error.error_description === "string") return error.error_description;
  if (typeof error.error === "string") return error.error;
  if (typeof error.msg === "string") return error.msg;
  if (typeof error.details === "string") return error.details;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch (_jsonError) {
    return fallback;
  }
}

function authErrorMessage(error, fallback = "Authentication failed. Please try again.") {
  const message = errorToMessage(error, fallback);
  const lower = message.toLowerCase();

  if ((lower.includes("invalid") && lower.includes("otp")) || (lower.includes("invalid") && lower.includes("token"))) {
    return "Invalid OTP";
  }
  if (lower.includes("invalid login credentials")) return "Invalid email or password. Please check your details and try again.";
  if (lower.includes("already registered") || lower.includes("user already registered") || lower.includes("already exists")) return "Email already registered";
  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return "Please verify your email with the 6-digit OTP sent to your inbox.";
  }
  if (lower.includes("expired")) return "This email OTP has expired. Please request a new code.";
  if (lower.includes("signup not allowed") && lower.includes("otp")) {
    return "OTP signup is disabled in Supabase. Enable email signups and OTP signup in Authentication settings, then try again.";
  }
  if (lower.includes("signup") && lower.includes("disabled")) return "No Urban Kicks account exists for this email. Please contact support to activate your account.";
  if (lower.includes("user") && lower.includes("not") && lower.includes("found")) return "No Urban Kicks account exists for this email. Please check the address or contact support.";
  if (lower.includes("too many") || lower.includes("rate limit") || lower.includes("over_email_send_rate_limit")) {
    return "Please wait before requesting another OTP";
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to fetch")) {
    return "Network issue while contacting Supabase. Please check your connection and try again.";
  }
  if (lower.includes("phone") && lower.includes("invalid")) return "Enter a valid phone number with country code, like +91 90000 00000.";
  if (lower.includes("email") && lower.includes("invalid")) return "Enter a valid email address.";

  return message;
}

function notify(message, type = "info") {
  const toast = document.createElement("div");
  const normalizedMessage = errorToMessage(message, "Something went wrong. Please try again.");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<strong>${type === "success" ? "Success" : type === "error" ? "Action needed" : "Urban Kicks"}</strong><span>${safe(normalizedMessage)}</span>`;
  toastRegion.appendChild(toast);
  window.setTimeout(() => toast.classList.add("show"), 20);
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 220);
  }, 4200);
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  const compact = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(compact)) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.length <= 15) return `+${digits}`;
  return "";
}

function sneakerPlaceholder(accent, label) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#ffffff"/>
          <stop offset="1" stop-color="#d9d9d5"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" x2="1">
          <stop stop-color="${accent}"/>
          <stop offset="1" stop-color="#111114"/>
        </linearGradient>
      </defs>
      <rect width="900" height="680" rx="54" fill="url(#bg)"/>
      <circle cx="710" cy="128" r="172" fill="${accent}" opacity="0.18"/>
      <path d="M154 444c110 14 250 18 428 11 84-3 139-18 166-44 18-17 11-41-14-48-43-13-99-18-168-15-64-60-132-93-204-98-24-2-44 7-60 27l-48 61-104 50c-30 15-28 50 4 56Z" fill="#111114"/>
      <path d="M260 346c52-52 103-79 154-81 61-3 110 29 151 83-120 1-221 1-305-2Z" fill="url(#accent)"/>
      <path d="M162 434h586c-14 28-58 45-132 50-158 10-304 7-438-9-25-3-33-24-16-41Z" fill="#ffffff"/>
      <path d="M223 477h462" stroke="#111114" stroke-width="18" stroke-linecap="round"/>
      <path d="M472 298l-92 92M528 318l-72 72M584 342l-52 52" stroke="#ffffff" stroke-width="15" stroke-linecap="round"/>
      <text x="70" y="110" fill="#111114" font-family="Arial Black,Arial,sans-serif" font-size="44">${label}</text>
      <text x="70" y="158" fill="${accent}" font-family="Arial Black,Arial,sans-serif" font-size="28">URBAN KICKS INDIA</text>
    </svg>
  `)}`;
}

const placeholderProducts = [
  {
    _id: "placeholder-speed-runner",
    name: "Velocity Street Runner",
    brand: "Urban Kicks",
    category: "Speed Runners",
    price: 5999,
    discountPercent: 35,
    stock: 24,
    sizes: ["7", "8", "9", "10"],
    colors: ["Black", "Red"],
    color: "Black",
    imageUrl: sneakerPlaceholder("#e30613", "RUNNER"),
    gallery: [sneakerPlaceholder("#e30613", "RUNNER")],
    description: "A lightweight city sneaker placeholder designed to preview future Urban Kicks drops.",
    featured: true,
    trending: true,
    rating: 4.8,
    reviewCount: 42,
    deliveryEstimate: "2-5 business days"
  },
  {
    _id: "placeholder-hero-hightop",
    name: "Midnight Hero High Top",
    brand: "Urban Kicks",
    category: "Hero High Tops",
    price: 7499,
    discountPercent: 28,
    stock: 18,
    sizes: ["7", "8", "9", "10", "11"],
    colors: ["White", "Red"],
    color: "White",
    imageUrl: sneakerPlaceholder("#b90009", "HIGH TOP"),
    gallery: [sneakerPlaceholder("#b90009", "HIGH TOP")],
    description: "A premium high-top placeholder with bold streetwear energy.",
    featured: true,
    trending: true,
    rating: 4.7,
    reviewCount: 36,
    deliveryEstimate: "2-5 business days"
  },
  {
    _id: "placeholder-cloud-comfort",
    name: "Cloudline Comfort Knit",
    brand: "Urban Kicks",
    category: "Cloud Comfort",
    price: 5299,
    discountPercent: 22,
    stock: 32,
    sizes: ["6", "7", "8", "9", "10"],
    colors: ["Grey", "Black"],
    color: "Grey",
    imageUrl: sneakerPlaceholder("#6b7280", "COMFORT"),
    gallery: [sneakerPlaceholder("#6b7280", "COMFORT")],
    description: "A soft everyday placeholder for comfort-first sneaker uploads.",
    featured: true,
    trending: false,
    rating: 4.6,
    reviewCount: 29,
    deliveryEstimate: "2-5 business days"
  },
  {
    _id: "placeholder-arcade-trainer",
    name: "Arcade Grip Trainer",
    brand: "Urban Kicks",
    category: "Arcade Trainers",
    price: 6799,
    discountPercent: 30,
    stock: 20,
    sizes: ["7", "8", "9", "10"],
    colors: ["Black", "White"],
    color: "Black",
    imageUrl: sneakerPlaceholder("#222222", "TRAINER"),
    gallery: [sneakerPlaceholder("#222222", "TRAINER")],
    description: "A training sneaker placeholder with gym-to-street styling.",
    featured: false,
    trending: true,
    rating: 4.5,
    reviewCount: 31,
    deliveryEstimate: "2-5 business days"
  }
];

function getStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_error) {
    localStorage.removeItem(key);
    return fallback;
  }
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
    throw new Error(errorToMessage(payload?.error || payload?.message || payload, fallback));
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
        detectSessionInUrl: false,
        storageKey: "urban-kicks-supabase-auth"
      }
    });

    console.log("[auth] Supabase client initialized", config.url);
    return supabaseClient;
  })();

  try {
    return await supabaseClientPromise;
  } catch (error) {
    supabaseClientPromise = null;
    throw error;
  }
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
        name: extra.name || extra.full_name || user.user_metadata?.full_name || user.user_metadata?.name || "Urban Kicks Member",
        full_name: extra.full_name || extra.name || user.user_metadata?.full_name || user.user_metadata?.name || "Urban Kicks Member",
        email: user.email || extra.email || "",
        mobile: extra.mobile || extra.phone_number || user.phone || user.user_metadata?.phone_number || user.user_metadata?.mobile || "",
        phone_number: extra.phone_number || extra.mobile || user.phone || user.user_metadata?.phone_number || user.user_metadata?.mobile || "",
        profile_image: extra.profile_image || user.user_metadata?.profile_image || ""
      })
    });
    console.log("[auth] user profile synced");
  } catch (error) {
    console.error(error);
    console.warn("[auth] profile sync failed", error.message);
  }
}

function showAuthError(error, fallback = "Authentication failed") {
  console.error(error);
  console.error("[auth]", error);
  notify(authErrorMessage(error, fallback), "error");
}

async function refreshSession() {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.refreshSession();
    if (error) {
      console.error(error);
      throw new Error(error.message || "Session expired. Please verify your email again.");
    }
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
    wishlistCache = null;
    await renderCounters();
  } catch (error) {
    console.warn("[auth] session restore failed", error.message);
    localStorage.removeItem(SESSION_KEY);
    wishlistCache = null;
    await renderCounters();
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
  const cartTotal = getCart().reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = cartTotal;
  [mobileCartCount, mobileHeaderCartCount].forEach((badge) => {
    if (!badge) return;
    badge.textContent = cartTotal;
    badge.hidden = cartTotal < 1;
  });
  const wishlist = wishlistCache || localWishlist();
  wishCount.textContent = wishlist.length;
  updateMobileAccountLink();
  updateMobileActiveNav();
}

function closeNav() {
  document.querySelector(".nav-links")?.classList.remove("open");
}

function updateMobileAccountLink() {
  const link = document.getElementById("mobileAccountLink");
  if (!link) return;
  const label = document.getElementById("mobileAccountLabel");
  const loggedIn = Boolean(getSession());
  link.href = loggedIn ? "#/profile" : "#/auth";
  if (label) label.textContent = loggedIn ? "Profile" : "Login";
}

function updateMobileActiveNav() {
  const root = location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
  const activeKey = root === "cart" ? "cart"
    : root === "categories" || root === "category" || root === "brand" ? "categories"
      : root === "profile" || root === "auth" ? "account"
        : root === "search" ? "new"
          : "home";

  document.querySelectorAll("[data-mobile-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.mobileNav === activeKey);
  });
}

function setupHeaderSearch() {
  headerSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(headerSearchForm).get("q") || "").trim();
    if (!query) {
      notify("Search for a sneaker, brand, or category.", "error");
      headerSearchForm.querySelector("input")?.focus();
      return;
    }
    location.hash = `#/search/${encodeURIComponent(query)}`;
  });

  mobileSearchButton?.addEventListener("click", () => {
    location.hash = "#/search/sneakers";
  });
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
  try {
    const rows = await api("/api/products");
    catalogCache = Array.isArray(rows) && rows.length ? rows : placeholderProducts;
  } catch (error) {
    console.warn("[catalog] using storefront placeholders:", errorToMessage(error));
    catalogCache = placeholderProducts;
  }
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
  const featuredSource = products.filter((product) => product.featured);
  const trendingSource = products.filter((product) => product.trending);
  const featured = (featuredSource.length ? featuredSource : products).slice(0, 4);
  const trending = (trendingSource.length ? trendingSource : products.slice(1)).slice(0, 4);
  const brands = [...new Set(products.map((product) => product.brand))];
  const heroProduct = products[0];

  app.innerHTML = `
    <section class="hero premium-hero">
      <div class="hero-shell">
        <div class="hero-copy">
          <div class="hero-brand-lockup">
            <span class="logo-badge logo-badge-hero" aria-hidden="true">
              <img src="/assets/urban-kicks-logo.png" alt="">
            </span>
            <div>
              <span>Urban Kicks India</span>
              <small>Luxury streetwear sneaker store</small>
            </div>
          </div>
          <p class="eyebrow">New season drops / Limited street heat</p>
          <h1>Urban Kicks India</h1>
          <p>Premium sneakers for city movement, night runs, and everyday streetwear. Curated drops, smooth checkout, saved favorites, and launch-ready collections for India.</p>
          <form class="search-panel" id="searchForm">
            <span class="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"></path></svg></span>
            <input name="q" placeholder="Search shoes, brands, drops..." aria-label="Search shoes">
            <button class="search-submit" type="submit">Search</button>
          </form>
          <div class="hero-actions">
            <a class="button primary animated-cta" href="#/categories">Shop new drops</a>
            <a class="button ghost" href="#/wishlist">View wishlist</a>
          </div>
          <div class="hero-proof">
            <span>Up to 50% off</span>
            <span>Cash on delivery</span>
            <span>Fresh weekly drops</span>
          </div>
        </div>
        <div class="sneaker-stage" aria-label="Sneaker showcase">
          <div class="premium-glow"></div>
          <div class="hero-logo-orbit">
            <span class="logo-badge logo-badge-stage" aria-hidden="true">
              <img src="/assets/urban-kicks-logo.png" alt="">
            </span>
          </div>
          ${heroProduct ? `<div class="hero-shoe"><img src="${heroProduct.imageUrl}" alt="${safe(heroProduct.name)}"></div>` : ""}
          <div class="offer-stickers">
            <span class="sticker">50% OFF</span>
            <span class="sticker">COD</span>
            <span class="sticker">NEW DROPS</span>
          </div>
        </div>
      </div>
    </section>
    <section class="section">
      ${sectionHead("Featured Sneakers", "Editor picks", "A focused edit of premium pairs for everyday rotation.", '<a class="button light" href="#/categories">Explore all</a>')}
      <div class="product-grid">${featured.map((product) => productCard(product, wishlist)).join("")}</div>
    </section>
    <section class="section band">
      ${sectionHead("Trending Collection", "Street heat right now", "Fast-moving silhouettes, sharp discounts, and clean cart actions.")}
      <div class="product-grid">${trending.map((product) => productCard(product, wishlist)).join("")}</div>
    </section>
    <section class="section" id="categories">
      ${sectionHead("Categories", "Choose your lane", "Four signature collections built for running, comfort, training, and high-top style.", '<a class="button ghost" href="#/categories">View categories</a>')}
      <div class="category-grid">${categorySeed.map((category) => categoryCard(category, products)).join("")}</div>
    </section>
    <section class="premium-drop-section">
      <div class="premium-drop-card">
        <p class="eyebrow">Premium Drop</p>
        <h2>Curated sneaker energy for every street rotation.</h2>
        <p>Discover limited-inspired silhouettes, clean everyday runners, bold high tops, and comfort-first trainers. Urban Kicks India is built for sneaker lovers who want style, confidence, and a polished shopping experience from first scroll to final checkout.</p>
        <div class="drop-metrics">
          <span><strong>50%</strong> Launch offers</span>
          <span><strong>COD</strong> Available</span>
          <span><strong>24/7</strong> Wishlist access</span>
        </div>
      </div>
    </section>
    <section class="section">
      ${sectionHead("Popular Brands", "Shop by label", "Browse all shoe varieties by brand.")}
      <div class="brand-grid">
        ${brands.map((brand) => `
          <a class="mini-card" href="#/brand/${encodeURIComponent(brand)}">
            <span class="chip cyan">${products.filter((product) => product.brand === brand).length} styles</span>
            <h3>${safe(brand)}</h3>
            <p class="meta">Browse ${safe(brand)} drops and everyday essentials.</p>
          </a>
        `).join("")}
      </div>
    </section>
    <section class="section">
      ${sectionHead("About Us", "For the culture", "We are passionate about premium sneakers and streetwear culture. Urban Kicks brings curated sneaker collections designed for comfort, style, and individuality.")}
      <div class="about-card"><p>Urban Kicks India blends modern ecommerce with the energy of sneaker drops, making it easy to discover, save, and shop pairs that match your personal style.</p></div>
    </section>
    <section class="section band">
      ${sectionHead("Customer Reviews", "Worn by the city", "Real shopping moments from Urban Kicks customers.")}
      <div class="review-grid">
        ${[
          ["Aarav S.", "The homepage feels like a real sneaker drop. Checkout was quick and the fit details were easy to scan."],
          ["Nisha K.", "Saved two pairs to wishlist on mobile and came back later on desktop. Smooth and clean."],
          ["Rohan M.", "The product cards are sharp, the COD option is clear, and the collection layout feels premium."]
        ].map(([name, quote]) => `
          <article class="review-card">
            <div class="stars">5.0 / 5</div>
            <p>${safe(quote)}</p>
            <strong>${safe(name)}</strong>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="newsletter-section">
      <div class="newsletter-card">
        <div>
          <p class="eyebrow">Drop alerts</p>
          <h2>Get first access to new Urban Kicks releases.</h2>
          <p>Join the list for launch alerts, limited discounts, and curated sneaker edits.</p>
        </div>
        <form class="newsletter-form" onsubmit="event.preventDefault(); notify('You are on the Urban Kicks India drop list.', 'success'); this.reset();">
          <input type="email" required placeholder="you@example.com" aria-label="Email address">
          <button class="button primary" type="submit">Notify me</button>
        </form>
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
      ${sectionHead("Categories", "Launch collections", "Browse signature sneaker lanes built for different streetwear moods.")}
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
  if (!product || product.stock < 1) {
    notify("This sneaker is currently out of stock.", "error");
    return;
  }
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
  notify(`${product.name} added to cart.`, "success");
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
      notify(errorToMessage(error, "Could not update wishlist."), "error");
    }
  }
  notify(exists ? "Removed from wishlist." : "Saved to wishlist.", "success");
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

function otpInputMarkup(prefix = "emailOtp") {
  return Array.from({ length: EMAIL_OTP_LENGTH }, (_, index) => (
    `<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="Email OTP digit ${index + 1}" data-otp-index="${index}" data-otp-prefix="${prefix}">`
  )).join("");
}

function authPage(mode = "login") {
  const user = getUser();
  if (user) {
    location.hash = "#/profile";
    return;
  }
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  app.innerHTML = `
    <section class="auth-layout">
      <div class="auth-brand-panel">
        <span class="logo-badge logo-badge-auth" aria-hidden="true">
          <img src="/assets/urban-kicks-logo.png" alt="">
        </span>
        <h2>Urban Kicks account</h2>
        <p>Premium access for wishlist sync, COD checkout, order history, and members-only sneaker drops.</p>
        <div class="auth-proof-grid">
          <span>Secure sessions</span>
          <span>Email OTP ready</span>
          <span>No redirect links</span>
        </div>
      </div>
      <div class="panel auth-primary-panel">
        <div class="auth-panel-logo">
          <img src="/assets/urban-kicks-logo.png" alt="Urban Kicks">
        </div>
        <div class="auth-tabs" aria-label="Authentication options">
          <a class="${!isSignup && !isForgot ? "active" : ""}" href="#/auth">Login</a>
          <a class="${isSignup ? "active" : ""}" href="#/auth/signup">Sign Up</a>
          <a class="${isForgot ? "active" : ""}" href="#/auth/forgot">Forgot</a>
        </div>
        ${isSignup ? signupFormMarkup() : isForgot ? forgotFormMarkup() : loginFormMarkup()}
      </div>
      <div class="panel auth-signup-panel">
        <div class="auth-panel-logo compact">
          <img src="/assets/urban-kicks-logo.png" alt="Urban Kicks">
        </div>
        <p class="eyebrow">Secure sneaker account</p>
        <h1>${isSignup ? "Create your vault" : isForgot ? "Recover by OTP" : "Welcome back"}</h1>
        <p class="auth-note">${isSignup ? "Create an account with email OTP verification and save your profile for future drops." : isForgot ? "Recover your account with a manual 6-digit email OTP." : "Login with email and password. OTP is reserved for signup and recovery to avoid email rate limits."}</p>
        <div class="auth-feature-list">
          <span>Password login</span>
          <span>Signup and recovery OTP</span>
          <span>60-second resend timer</span>
          <span>Persistent account session</span>
          <span>Phone saved for future SMS features</span>
        </div>
      </div>
    </section>
  `;
  setupAuthForms(mode);
}

function loginFormMarkup() {
  return `
    <p class="eyebrow">Member Login</p>
    <h1>Login</h1>
    <p class="auth-note">Use email and password for login. Email OTP is used only for signup verification and recovery.</p>
    <form class="form email-auth-form" id="loginForm">
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password" placeholder="Your password"></label>
      <button class="button dark" type="submit">
        <span class="button-label">Login</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
    </form>
    <div class="auth-action-row">
      <a class="text-button" href="#/auth/forgot">Forgot Password?</a>
    </div>
    <p class="auth-switch">Don't have an account? <a href="#/auth/signup">Sign Up</a></p>
  `;
}

function signupFormMarkup() {
  return `
    <p class="eyebrow">Create Account</p>
    <h1>Sign Up</h1>
    <p class="auth-note">Create your Urban Kicks account, then verify your email with the 6-digit OTP sent to your inbox.</p>
    <form class="form email-auth-form" id="signupForm">
      <label>Full Name<input name="name" required autocomplete="name" placeholder="Your full name"></label>
      <label>Phone Number<input name="mobile" type="tel" inputmode="tel" required autocomplete="tel" placeholder="+91 90000 00000"></label>
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
      <label>Confirm Password<input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="Repeat your password"></label>
      <button class="button primary" type="submit" id="sendEmailOtpButton">
        <span class="button-label">Create Account</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
    </form>
    <p class="auth-switch">Already have an account? <a href="#/auth">Login</a></p>
    ${otpPanelMarkup()}
  `;
}

function forgotFormMarkup() {
  return `
    <p class="eyebrow">Account Recovery</p>
    <h1>Forgot Password?</h1>
    <p class="auth-note">Recover access with the same secure 6-digit email OTP flow inside Urban Kicks.</p>
    <form class="form email-auth-form" id="otpLoginForm">
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="button dark" type="submit" id="sendEmailOtpButton">
        <span class="button-label">Send Recovery OTP</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
    </form>
    <p class="auth-switch">Back to <a href="#/auth">Login</a></p>
    ${otpPanelMarkup()}
  `;
}

function otpPanelMarkup() {
  return `
    <div class="email-otp-panel" id="emailOtpPanel" hidden>
      <div class="otp-panel-head">
        <span class="otp-status-dot"></span>
        <div>
          <strong>Email verification</strong>
          <p class="auth-note">Enter the 6-digit OTP sent to your email. The app will stop accepting this code after 60 seconds.</p>
        </div>
      </div>
      <div class="otp-boxes" id="emailOtpBoxes" aria-label="Email one time password">${otpInputMarkup()}</div>
      <input type="hidden" name="otp" id="emailOtpValue">
      <button class="button primary email-otp-verify-button" type="button" id="verifyEmailOtpButton">
        <span class="button-label">Verify OTP</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
      <button class="button light email-otp-resend-button" type="button" id="resendEmailOtpButton" disabled>Resend OTP in 60s</button>
    </div>
  `;
}

function setButtonLoading(button, loading, loadingLabel) {
  if (!button) return;
  const label = button.querySelector(".button-label");
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = label?.textContent || button.textContent;
  }
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  if (label) label.textContent = loading ? loadingLabel : button.dataset.originalLabel;
  else button.textContent = loading ? loadingLabel : button.dataset.originalLabel;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function updateEmailAuthCooldown() {
  const sendButton = document.getElementById("sendEmailOtpButton");
  const resendButton = document.getElementById("resendEmailOtpButton");
  const secondsLeft = Math.max(0, Math.ceil((emailAuthState.cooldownUntil - Date.now()) / 1000));
  const coolingDown = secondsLeft > 0;

  [sendButton, resendButton].forEach((button) => {
    if (!button || button.classList.contains("is-loading")) return;
    const label = button.querySelector(".button-label");
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = label?.textContent || button.textContent;
    }
    button.disabled = emailAuthState.inFlight || coolingDown;
    const nextLabel = button === resendButton && coolingDown ? `Resend OTP in ${secondsLeft}s` : button.dataset.originalLabel;
    if (label) label.textContent = nextLabel;
    else button.textContent = nextLabel;
  });

  if (emailAuthState.timer) window.clearTimeout(emailAuthState.timer);
  if (coolingDown) {
    emailAuthState.timer = window.setTimeout(updateEmailAuthCooldown, 1000);
  }
}

function startEmailAuthCooldown(cooldownKey = "") {
  emailAuthState.cooldownUntil = Date.now() + EMAIL_AUTH_COOLDOWN_SECONDS * 1000;
  if (cooldownKey) localStorage.setItem(cooldownKey, String(emailAuthState.cooldownUntil));
  updateEmailAuthCooldown();
}

function resetEmailOtpInputs() {
  const otpInputs = [...document.querySelectorAll("#emailOtpBoxes input")];
  otpInputs.forEach((input) => {
    input.value = "";
  });
  const hiddenInput = document.getElementById("emailOtpValue");
  if (hiddenInput) hiddenInput.value = "";
  otpInputs[0]?.focus();
}

function syncEmailOtpValue() {
  const otpInputs = [...document.querySelectorAll("#emailOtpBoxes input")];
  const token = otpInputs.map((input) => input.value).join("");
  const hiddenInput = document.getElementById("emailOtpValue");
  if (hiddenInput) hiddenInput.value = token;
  return token;
}

function getSignupFormData(form) {
  const data = Object.fromEntries(new FormData(form));
  const mobile = normalizePhoneNumber(data.mobile);
  const email = String(data.email || "").trim();
  const name = String(data.name || "").trim();
  const password = String(data.password || "");
  const confirmPassword = String(data.confirmPassword || "");

  if (!name) {
    notify("Enter your full name to create your Urban Kicks account.", "error");
    form.elements.name.focus();
    return null;
  }

  if (!mobile) {
    notify("Enter a valid phone number with country code, like +91 90000 00000.", "error");
    form.elements.mobile.focus();
    return null;
  }

  if (!validEmail(email)) {
    notify("Enter a valid email address.", "error");
    form.elements.email.focus();
    return null;
  }

  if (password.length < 6) {
    notify("Password must be at least 6 characters.", "error");
    form.elements.password.focus();
    return null;
  }

  if (password !== confirmPassword) {
    notify("Passwords do not match.", "error");
    form.elements.confirmPassword.focus();
    return null;
  }

  return { name, email, password, mobile };
}

function getLoginFormData(form) {
  const data = Object.fromEntries(new FormData(form));
  const email = String(data.email || "").trim();
  const password = String(data.password || "");

  if (!validEmail(email)) {
    notify("Enter a valid email address.", "error");
    form.elements.email.focus();
    return null;
  }
  if (!password) {
    notify("Enter your password.", "error");
    form.elements.password.focus();
    return null;
  }
  return { email, password };
}

function getOtpLoginFormData(form) {
  const data = Object.fromEntries(new FormData(form));
  const email = String(data.email || "").trim();
  if (!validEmail(email)) {
    notify("Enter a valid email address.", "error");
    form.elements.email.focus();
    return null;
  }
  return { email };
}

function setupAuthForms(mode) {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const otpLoginForm = document.getElementById("otpLoginForm");

  loginForm?.addEventListener("submit", loginWithPassword);
  signupForm?.addEventListener("submit", sendSignupEmailOtp);
  otpLoginForm?.addEventListener("submit", sendForgotEmailOtp);

  if (mode === "signup" || mode === "forgot") setupEmailOtpControls();
}

function setupEmailOtpControls() {
  const verifyButton = document.getElementById("verifyEmailOtpButton");
  const resendButton = document.getElementById("resendEmailOtpButton");
  const otpInputs = [...document.querySelectorAll("#emailOtpBoxes input")];

  if (!verifyButton || !resendButton || otpInputs.length !== EMAIL_OTP_LENGTH) return;

  verifyButton.addEventListener("click", verifyEmailOtp);
  resendButton.addEventListener("click", resendEmailOtp);

  otpInputs.forEach((input, index) => {
    input.addEventListener("input", (event) => {
      const digit = event.target.value.replace(/\D/g, "").slice(-1);
      event.target.value = digit;
      syncEmailOtpValue();
      if (digit && index < otpInputs.length - 1) otpInputs[index + 1].focus();
      if (syncEmailOtpValue().length === EMAIL_OTP_LENGTH) verifyButton.focus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !event.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });

    input.addEventListener("paste", (event) => {
      event.preventDefault();
      const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH);
      pasted.split("").forEach((digit, digitIndex) => {
        if (otpInputs[digitIndex]) otpInputs[digitIndex].value = digit;
      });
      syncEmailOtpValue();
      otpInputs[Math.min(pasted.length, EMAIL_OTP_LENGTH) - 1]?.focus();
    });
  });

  updateEmailAuthCooldown();
}

async function loginWithPassword(event) {
  event.preventDefault();
  const form = event.target;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = getLoginFormData(form);
  if (!formData) return;

  setButtonLoading(submitButton, true, "Logging in...");
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] password login for ${formData.email}`);
    const { data, error } = await client.auth.signInWithPassword({
      email: formData.email,
      password: formData.password
    });
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Invalid email or password."));
    }
    if (!data?.session || !data?.user) throw new Error("Login succeeded, but Supabase did not return a session.");
    await syncSessionFromSupabase(data.session);
    await upsertUserProfile(data.user);
    wishlistCache = null;
    await getWishlist();
    notify("Welcome back to Urban Kicks.", "success");
    location.hash = "#/profile";
  } catch (error) {
    showAuthError(error, error.message || "Could not login.");
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function sendSignupEmailOtp(event) {
  event.preventDefault();
  const formData = getSignupFormData(event.target);
  if (!formData) return;
  await startEmailOtpRequest({
    flow: "signup",
    email: formData.email,
    profileData: formData,
    button: document.getElementById("sendEmailOtpButton")
  });
}

async function sendForgotEmailOtp(event) {
  event.preventDefault();
  const formData = getOtpLoginFormData(event.target);
  if (!formData) return;
  await startEmailOtpRequest({
    flow: "recovery",
    email: formData.email,
    profileData: formData,
    button: document.getElementById("sendEmailOtpButton")
  });
}

async function resendEmailOtp(event) {
  event.preventDefault();
  if (!emailAuthState.email) {
    notify("Start the email OTP flow again before requesting another code.", "error");
    return;
  }
  await startEmailOtpRequest({
    flow: emailAuthState.flow,
    email: emailAuthState.email,
    profileData: emailAuthState.profileData || { email: emailAuthState.email },
    button: document.getElementById("resendEmailOtpButton")
  });
}

async function startEmailOtpRequest({ flow, email, profileData, button }) {
  const cooldownKey = `${OTP_COOLDOWN_KEY}:${flow}:${email.toLowerCase()}`;
  const storedCooldown = Number(localStorage.getItem(cooldownKey) || 0);
  emailAuthState.cooldownUntil = Math.max(emailAuthState.cooldownUntil, storedCooldown);
  if (emailAuthState.inFlight) {
    notify("Authentication request already in progress. Please wait.", "error");
    return false;
  }
  if (Date.now() < emailAuthState.cooldownUntil) {
    notify("Please wait before requesting another email OTP.", "error");
    return false;
  }

  emailAuthState.inFlight = true;
  setButtonLoading(button, true, "Sending...");
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] ${flow} OTP request for ${email}`);
    const authResponse = flow === "signup"
      ? await client.auth.signUp({
        email,
        password: profileData.password,
        options: {
          data: {
            name: profileData?.name || "",
            full_name: profileData?.name || "",
            mobile: profileData?.mobile || "",
            phone_number: profileData?.mobile || ""
          }
        }
      })
      : await client.auth.resetPasswordForEmail(email);
    const { error } = authResponse;
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Could not send email OTP."));
    }
    if (flow === "signup" && authResponse?.data?.session) {
      console.warn("[auth] Supabase returned a signup session before OTP verification. Signing out until OTP is verified.");
      await client.auth.signOut().catch((signOutError) => console.warn("[auth] pre-verification sign out failed", signOutError));
      localStorage.removeItem(SESSION_KEY);
    }

    emailAuthState.email = email;
    emailAuthState.profileData = profileData || { email };
    emailAuthState.flow = flow;
    emailAuthState.shouldCreateUser = flow === "signup";
    const otpPanel = document.getElementById("emailOtpPanel");
    if (otpPanel) otpPanel.hidden = false;
    resetEmailOtpInputs();
    startEmailAuthCooldown(cooldownKey);
    notify("OTP sent successfully", "success");
    return true;
  } catch (error) {
    console.error(error);
    showAuthError(error, error.message || "Could not send email OTP.");
    return false;
  } finally {
    emailAuthState.inFlight = false;
    setButtonLoading(button, false);
    updateEmailAuthCooldown();
  }
}

async function verifyEmailOtp() {
  const verifyButton = document.getElementById("verifyEmailOtpButton");
  const token = syncEmailOtpValue();
  const email = emailAuthState.email;
  const profileData = emailAuthState.profileData || { email };

  if (!validEmail(email)) {
    notify("Request an email OTP before verifying.", "error");
    return;
  }

  if (token.length !== EMAIL_OTP_LENGTH) {
    notify("Enter the complete 6-digit OTP from your email.", "error");
    document.querySelector("#emailOtpBoxes input")?.focus();
    return;
  }

  if (Date.now() > emailAuthState.cooldownUntil) {
    notify("This OTP window has expired. Please request a fresh email OTP.", "error");
    return;
  }

  setButtonLoading(verifyButton, true, "Verifying...");
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] verifying email OTP for ${email}`);
    const otpType = emailAuthState.flow === "recovery" ? "recovery" : "signup";
    const { data: authData, error } = await client.auth.verifyOtp({
      email,
      token,
      type: otpType
    });
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Could not verify email OTP."));
    }
    if (!authData?.session || !authData?.user) {
      throw new Error("Email OTP verified, but Supabase did not return a session. Please try again.");
    }

    await syncSessionFromSupabase(authData.session);
    await upsertUserProfile(authData.user, {
      name: profileData?.name,
      full_name: profileData?.name,
      email,
      mobile: profileData?.mobile || "",
      phone_number: profileData?.mobile || ""
    });
    wishlistCache = null;
    await getWishlist();
    if (emailAuthState.timer) window.clearTimeout(emailAuthState.timer);
    const verifiedRecovery = emailAuthState.flow === "recovery";
    emailAuthState = { email: "", profileData: null, flow: "", shouldCreateUser: false, cooldownUntil: 0, timer: null, inFlight: false };
    notify("Email verified. Welcome to Urban Kicks India.", "success");
    location.hash = verifiedRecovery ? "#/profile/security" : "#/profile";
  } catch (error) {
    console.error(error);
    showAuthError(error, error.message || "Could not verify email OTP.");
  } finally {
    setButtonLoading(verifyButton, false);
    updateEmailAuthCooldown();
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
  notify("You have been logged out.", "success");
  location.hash = "#/";
}

function normalizeProfile(session, profile = {}) {
  const metadata = session.user?.user_metadata || {};
  return {
    id: session.user?.id,
    name: profile.full_name || profile.name || metadata.full_name || metadata.name || "Urban Kicks Member",
    email: profile.email || session.user?.email || "",
    mobile: profile.phone_number || profile.mobile || metadata.phone_number || metadata.mobile || session.user?.phone || "",
    image: profile.profile_image || metadata.profile_image || ""
  };
}

function avatarMarkup(profile, size = "large") {
  if (profile.image) {
    return `<img class="profile-avatar ${size}" src="${profile.image}" alt="${safe(profile.name)}">`;
  }
  const initials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "UK";
  return `<div class="profile-avatar ${size}" aria-label="${safe(profile.name)}">${safe(initials)}</div>`;
}

async function getAccountData() {
  const session = getSession();
  const [account, orders, transactions, wishlist, products] = await Promise.all([
    api("/api/auth/me").catch(() => ({ user: session.user, profile: null })),
    api("/api/orders/mine").catch(() => []),
    api("/api/transactions").catch(() => []),
    getWishlist().catch(() => []),
    getProducts().catch(() => placeholderProducts)
  ]);
  return {
    session,
    profile: normalizeProfile(session, account.profile || {}),
    orders,
    transactions,
    wishlist,
    products
  };
}

function accountCard(title, copy, href, action = "Open") {
  return `
    <a class="account-card" href="${href}">
      <div>
        <span class="account-card-kicker">${safe(action)}</span>
        <h3>${safe(title)}</h3>
        <p>${safe(copy)}</p>
      </div>
      <span class="account-arrow">&gt;</span>
    </a>
  `;
}

async function profilePage(section = "overview") {
  const session = getSession();
  if (!session) return authPage();
  const account = await getAccountData();
  if (section === "edit") return profileEditPage(account);
  if (section === "security") return profileSecurityPage(account);
  if (section !== "overview") return profileSectionPage(account, section);
  const cartItems = getCart();
  const delivered = account.orders.filter((order) => order.status === "Delivered").length;
  const cancelled = account.orders.filter((order) => order.status === "Cancelled").length;
  const latestOrders = account.orders.slice(0, 3);

  app.innerHTML = `
    <section class="profile-shell">
      <div class="profile-hero-card">
        <div class="profile-identity">
          ${avatarMarkup(account.profile)}
          <div>
            <p class="eyebrow">Urban Kicks member</p>
            <h1>${safe(account.profile.name)}</h1>
            <p>${safe(account.profile.email || "Email session active")}${account.profile.mobile ? ` / ${safe(account.profile.mobile)}` : ""}</p>
          </div>
        </div>
        <div class="profile-actions">
          <a class="button light" href="#/profile/edit">Edit Profile</a>
          <button class="button danger" onclick="logout()">Logout</button>
        </div>
      </div>

      <div class="profile-stats">
        <article><strong>${account.orders.length}</strong><span>Orders</span></article>
        <article><strong>${account.wishlist.length}</strong><span>Wishlist</span></article>
        <article><strong>${cartItems.length}</strong><span>Cart Items</span></article>
        <article><strong>${account.transactions.length}</strong><span>Transactions</span></article>
      </div>

      <div class="account-layout">
        <aside class="account-side">
          <a class="active" href="#/profile">Overview</a>
          <a href="#/profile/orders">Orders</a>
          <a href="#/wishlist">Wishlist</a>
          <a href="#/cart">Cart</a>
          <a href="#/profile/security">Security</a>
          <a href="#/about">About Urban Kicks</a>
        </aside>
        <div class="account-main">
          <div class="account-card-grid">
            ${accountCard("Orders", `${account.orders.length} total / ${delivered} delivered / ${cancelled} cancelled`, "#/profile/orders", "Track")}
            ${accountCard("Wishlist", `${account.wishlist.length} saved sneakers`, "#/wishlist", "Saved")}
            ${accountCard("Cart", `${cartItems.reduce((sum, item) => sum + item.quantity, 0)} items waiting`, "#/cart", "Checkout")}
            ${accountCard("Addresses", "Add, edit, or delete delivery addresses", "#/profile/addresses", "Manage")}
            ${accountCard("Payment Methods", "Cash on Delivery active. Online payments ready later.", "#/profile/payments", "Payment")}
            ${accountCard("Notifications", "Email and drop alert preferences", "#/profile/notifications", "Alerts")}
            ${accountCard("Security", "OTP-only account protection and logout controls", "#/profile/security", "Protect")}
            ${accountCard("Help & Support", "FAQ, contact support, returns, and refunds", "#/profile/help", "Support")}
            ${accountCard("About Urban Kicks", "Brand story, terms, and privacy", "#/about", "Brand")}
            ${accountCard("Logout", "Securely end this session", "javascript:logout()", "Exit")}
          </div>

          <section class="account-panel">
            <div class="section-head compact">
              <div>
                <p class="eyebrow">Recent activity</p>
                <h2>Orders and movement</h2>
                <p>Your latest sneaker orders and saved activity appear here.</p>
              </div>
            </div>
            <div class="order-feed">
              ${latestOrders.map((order) => `<article class="order-card"><div><strong>${safe(order.status)}</strong><div class="meta">${money(order.total)} / ${safe(order.paymentMethod)} / ${safe(order.createdAt || "")}</div></div><a class="button light" href="#/confirmation/${order._id}">View</a></article>`).join("") || '<div class="premium-empty"><h3>No orders yet</h3><p>Start with a new drop and your order history will appear here.</p><a class="button primary" href="#/">Shop sneakers</a></div>'}
            </div>
          </section>
          <div class="profile-bottom-logout">
            <button class="button danger" onclick="logout()">Logout</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function profileEditPage(account) {
  app.innerHTML = `
    <section class="profile-shell narrow">
      <a class="text-button back-link" href="#/profile">Back to account</a>
      <div class="profile-hero-card">
        <div class="profile-identity">
          ${avatarMarkup(account.profile)}
          <div>
            <p class="eyebrow">Edit Profile</p>
            <h1>Refine your account</h1>
            <p>Update your personal details and profile picture.</p>
          </div>
        </div>
      </div>
      <form class="panel profile-edit-form" id="profileEditForm">
        <label>Full Name<input name="name" required value="${safe(account.profile.name)}"></label>
        <label>Email<input name="email" type="email" required value="${safe(account.profile.email)}"></label>
        <label>Phone Number<input name="mobile" type="tel" inputmode="tel" value="${safe(account.profile.mobile)}" placeholder="+91 90000 00000"></label>
        <label>Profile Picture<input name="profileImageFile" type="file" accept="image/*"></label>
        <input type="hidden" name="profile_image" value="${safe(account.profile.image)}">
        <div id="profilePreview" class="profile-preview">${avatarMarkup(account.profile, "medium")}</div>
        <button class="button primary" type="submit"><span class="button-label">Save Changes</span><span class="button-spinner" aria-hidden="true"></span></button>
      </form>
    </section>
  `;
  setupProfileEditForm();
}

function profileSecurityPage(account) {
  app.innerHTML = `
    <section class="profile-shell narrow">
      <a class="text-button back-link" href="#/profile">Back to account</a>
      <div class="profile-hero-card">
        <div class="profile-identity">
          ${avatarMarkup(account.profile)}
          <div>
            <p class="eyebrow">Security</p>
            <h1>Account protection</h1>
            <p>Urban Kicks uses email OTP only. Manage sessions and logout securely.</p>
          </div>
        </div>
      </div>
      <div class="security-grid">
        <article class="panel security-card">
          <h2>Email verification</h2>
          <p class="meta">Signup and recovery use manual 6-digit email OTP inside the app. Login uses your email and password to avoid OTP rate limits.</p>
          <a class="button primary" href="#/auth/forgot">Recover account</a>
        </article>
        <form class="panel profile-edit-form" id="passwordForm">
          <h2>Change password</h2>
          <label>New Password<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
          <button class="button primary" type="submit"><span class="button-label">Update Password</span><span class="button-spinner" aria-hidden="true"></span></button>
        </form>
        <article class="panel security-card">
          <h2>Login method</h2>
          <p class="meta">Use email and password for normal login. Request OTP only for signup verification and account recovery.</p>
          <a class="button light" href="#/auth">Go to login</a>
        </article>
        <article class="panel security-card">
          <h2>Logout from all devices</h2>
          <p class="meta">End every active Supabase session for this account.</p>
          <button class="button danger" onclick="logoutAllDevices()">Logout everywhere</button>
        </article>
      </div>
    </section>
  `;
  document.getElementById("passwordForm").addEventListener("submit", changePassword);
}

function profileSectionPage(account, section) {
  const titles = {
    orders: ["Orders", "Track, review, and manage sneaker orders."],
    addresses: ["Addresses", "Add, edit, or remove saved delivery addresses."],
    payments: ["Payment Methods", "Cash on Delivery is active. UPI and cards can be enabled later."],
    notifications: ["Notifications", "Control email alerts, drop reminders, and account updates."],
    help: ["Help & Support", "FAQ, contact support, returns, refunds, and policies."]
  };
  const [title, copy] = titles[section] || ["Account", "Manage your Urban Kicks profile."];
  const content = section === "orders"
    ? account.orders.map((order) => `<article class="order-card"><div><strong>${safe(order.status)}</strong><div class="meta">${money(order.total)} / ${safe(order.paymentMethod)} / ${safe(order.createdAt || "")}</div></div><a class="button light" href="#/confirmation/${order._id}">View</a></article>`).join("") || '<div class="premium-empty"><h3>No orders yet</h3><p>Your future orders will appear here.</p><a class="button primary" href="#/">Shop sneakers</a></div>'
    : `<div class="premium-empty"><h3>${safe(title)} coming alive</h3><p>${safe(copy)} This section is structured for production data and ready for backend expansion.</p><a class="button light" href="#/profile">Back to account</a></div>`;

  app.innerHTML = `
    <section class="profile-shell narrow">
      <a class="text-button back-link" href="#/profile">Back to account</a>
      <section class="account-panel">
        <div class="section-head compact">
          <div>
            <p class="eyebrow">Account</p>
            <h2>${safe(title)}</h2>
            <p>${safe(copy)}</p>
          </div>
        </div>
        <div class="order-feed">${content}</div>
      </section>
    </section>
  `;
}

function setupProfileEditForm() {
  const form = document.getElementById("profileEditForm");
  const fileInput = form.elements.profileImageFile;
  const hiddenImage = form.elements.profile_image;
  const preview = document.getElementById("profilePreview");

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 900000) {
      notify("Choose a profile image under 900 KB for fast loading.", "error");
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      hiddenImage.value = reader.result;
      preview.innerHTML = `<img class="profile-avatar medium" src="${reader.result}" alt="Profile preview">`;
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", saveProfile);
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form));
  const name = String(data.name || "").trim();
  const email = String(data.email || "").trim();
  const mobile = data.mobile ? normalizePhoneNumber(data.mobile) : "";
  const profileImage = String(data.profile_image || "");

  if (!name) return notify("Enter your full name.", "error");
  if (!validEmail(email)) return notify("Enter a valid email address.", "error");
  if (data.mobile && !mobile) return notify("Enter a valid phone number with country code.", "error");

  setButtonLoading(button, true, "Saving...");
  try {
    const client = await getSupabaseClient();
    const updatePayload = {
      data: {
        name,
        full_name: name,
        mobile,
        phone_number: mobile,
        profile_image: profileImage
      }
    };
    if (email !== getSession()?.user?.email) updatePayload.email = email;
    const { data: updated, error } = await client.auth.updateUser(updatePayload);
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Could not update profile."));
    }
    await upsertUserProfile(updated.user || getUser(), {
      name,
      full_name: name,
      email,
      mobile,
      phone_number: mobile,
      profile_image: profileImage
    });
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session) await syncSessionFromSupabase(sessionData.session);
    notify("Profile updated.", "success");
    location.hash = "#/profile";
  } catch (error) {
    showAuthError(error, error.message || "Could not update profile.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function changePassword(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const password = String(new FormData(form).get("password") || "");
  if (password.length < 6) return notify("Password must be at least 6 characters.", "error");

  setButtonLoading(button, true, "Updating...");
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Could not update password."));
    }
    form.reset();
    notify("Password updated securely.", "success");
  } catch (error) {
    showAuthError(error, error.message || "Could not update password.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function logoutAllDevices() {
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signOut({ scope: "global" });
    if (error) throw error;
    localStorage.removeItem(SESSION_KEY);
    wishlistCache = null;
    renderCounters();
    notify("Logged out from all devices.", "success");
    location.hash = "#/";
  } catch (error) {
    showAuthError(error, error.message || "Could not logout from all devices.");
  }
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
  if (!id && !formData.get("image").name) {
    notify("Please upload a product image.", "error");
    return;
  }
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
  const pages = {
    About: {
      eyebrow: "About Urban Kicks India",
      title: "Built for sneaker culture",
      copy: "We are passionate about premium sneakers and streetwear culture. Urban Kicks India brings curated sneaker collections designed for comfort, style, and individuality.",
      detail: "From daily rotation pairs to statement drops, every collection is shaped for people who want their footwear to feel personal, polished, and ready for the city."
    },
    Terms: {
      eyebrow: "Terms & Conditions",
      title: "Clear shopping terms",
      copy: "Orders, returns, stock availability, delivery timelines, and payment details are handled with transparent ecommerce policies.",
      detail: "Please review product details, size choices, and delivery information before placing an order. Final terms can be updated as Urban Kicks India launches new services."
    },
    Privacy: {
      eyebrow: "Privacy Policy",
      title: "Your data stays protected",
      copy: "Account, wishlist, cart, and order details are used only to support your Urban Kicks India shopping experience.",
      detail: "Customer data should be handled securely and only for checkout, order updates, account access, and store communication."
    }
  };
  const page = pages[title] || pages.About;
  app.innerHTML = `
    <section class="section">
      ${sectionHead(page.eyebrow, page.title, page.copy)}
      <div class="about-card"><p>${safe(page.detail)}</p></div>
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
    if (parts[0] === "auth") return authPage(parts[1] || "login");
    if (parts[0] === "profile") return profilePage(parts[1] || "overview");
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
window.logoutAllDevices = logoutAllDevices;
window.notify = notify;
window.editProduct = editProduct;
window.resetAdminForm = resetAdminForm;
window.deleteProduct = deleteProduct;
window.updateOrderStatus = updateOrderStatus;

navToggle?.addEventListener("click", () => document.querySelector(".nav-links")?.classList.toggle("open"));
window.addEventListener("hashchange", router);
window.addEventListener("urban-kicks-auth", (event) => {
  console.log(`[auth] state changed: ${event.detail.event}`);
  updateMobileAccountLink();
});

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem(THEME_KEY) === "light") document.body.classList.add("light-mode");
  setupHeaderSearch();
  updateMobileAccountLink();
  setupAuthStateListener().catch((error) => console.error("[auth] listener setup failed", error));
  verifySession();
  router();
});
