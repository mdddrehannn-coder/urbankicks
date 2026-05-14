const app = document.getElementById("app");
const cartCount = document.getElementById("cartCount");
const wishCount = document.getElementById("wishCount");
const navToggle = document.getElementById("navToggle");
const toastRegion = document.getElementById("toastRegion");
const headerSearchForm = document.getElementById("headerSearchForm");
const mobileSearchButton = document.getElementById("mobileSearchButton");
const mobileCartCount = document.getElementById("mobileCartCount");
const mobileHeaderCartCount = document.getElementById("mobileHeaderCartCount");
const splashScreen = document.getElementById("splashScreen");

const CART_KEY = "urbanKicksCart";
const SESSION_KEY = "urbanKicksSession";
const WISH_KEY = "urbanKicksWishlist";
const THEME_KEY = "urbanKicksTheme";
const SPLASH_KEY = "urbanKicksSplashSeen";
const SPLASH_HOLD_MS = 1550;
const SPLASH_FADE_MS = 720;
const OTP_COOLDOWN_KEY = "urbanKicksOtpCooldown";
const NOTIFICATION_PREF_KEY = "urbanKicksNotificationPrefs";
const EMAIL_OTP_LENGTH = 6;
const EMAIL_AUTH_COOLDOWN_SECONDS = 30;
const EMAIL_OTP_EXPIRY_MS = 10 * 60 * 1000;
const EMAIL_OTP_MAX_VERIFY_ATTEMPTS = 5;
const PUSH_PERMISSION_STORE_KEY = "urbanKicksPushPermission";

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

let catalogCache = null;
let wishlistCache = null;
let addressCache = null;
let cartCache = null;
let indiaAddressMeta = null;
let addressPincodeState = { pincode: "", valid: false, state: "", city: "", message: "" };
let smartAddressOutsideClickReady = false;
let authRefreshTimer = null;
let supabaseClient = null;
let supabaseClientPromise = null;
let lastRouteKey = "";
let emailAuthState = {
  email: "",
  profileData: null,
  flow: "",
  shouldCreateUser: false,
  cooldownUntil: 0,
  otpExpiresAt: 0,
  verifyAttempts: 0,
  timer: null,
  inFlight: false,
  recoverySession: null,
  pendingEmailChange: null
};
let checkoutSelectedAddressId = "";
let checkoutPaymentMethod = "cod";
let orderInFlight = false;

const PAYMENT_METHODS = {
  cod: {
    id: "cod",
    label: "Cash on Delivery",
    shortLabel: "COD",
    enabled: true,
    status: "Available now",
    copy: "Pay in cash when your sneaker order reaches your doorstep.",
    trust: "Order saved instantly / Pay on delivery"
  },
  upi: {
    id: "upi",
    label: "UPI Payment",
    shortLabel: "UPI",
    enabled: false,
    status: "Coming soon",
    copy: "Fast UPI checkout is being prepared for Urban Kicks.",
    trust: "Razorpay-ready architecture / Disabled for now"
  }
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
  if (!toastRegion) return;
  const toast = document.createElement("div");
  const normalizedMessage = errorToMessage(message, "Something went wrong. Please try again.");
  const labels = {
    success: ["Success", "M7.8 12.6 10.6 15.4 16.6 8.7 18 10 10.7 18 6.4 13.8z"],
    error: ["Action needed", "M12 3 21 19H3L12 3Zm0 5.5v4.8m0 2.7h.01"],
    info: ["Urban Kicks", "M12 7.2h.01M11 10h2v7h-2z"]
  };
  const [title, iconPath] = labels[type] || labels.info;
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg></span>
    <span class="toast-copy"><strong>${title}</strong><span>${safe(normalizedMessage)}</span></span>
  `;
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
    cartCache = null;
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
  await migrateLocalCartToSupabase();
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
    cartCache = null;
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
    cartCache = null;
    await renderCounters();
  } catch (error) {
    console.warn("[auth] session restore failed", error.message);
    localStorage.removeItem(SESSION_KEY);
    wishlistCache = null;
    cartCache = null;
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
      cartCache = null;
      await renderCounters();
    }
    window.dispatchEvent(new CustomEvent("urban-kicks-auth", { detail: { event, session } }));
  });
  window.urbanKicksAuthSubscription = data?.subscription;
}

function getLocalCart() {
  return getStore(CART_KEY, []);
}

function saveLocalCart(cart) {
  setStore(CART_KEY, cart);
}

async function getCart(force = false) {
  if (!getSession()) return getLocalCart();
  if (cartCache && !force) return cartCache;
  try {
    cartCache = await api("/api/cart");
  } catch (error) {
    console.warn("[cart] saved cart unavailable:", errorToMessage(error));
    cartCache = [];
  }
  return cartCache;
}

async function migrateLocalCartToSupabase() {
  if (!getSession()) return;
  const localCart = getLocalCart();
  if (!localCart.length) return;
  try {
    await Promise.all(localCart.map((item) => api("/api/cart", {
      method: "POST",
      body: JSON.stringify({
        productId: item.productId,
        size: item.size,
        color: item.color,
        quantity: item.quantity
      })
    })));
    localStorage.removeItem(CART_KEY);
    cartCache = null;
  } catch (error) {
    console.warn("[cart] local cart sync skipped:", errorToMessage(error));
  }
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

async function getAddresses(force = false) {
  if (!getSession()) return [];
  if (addressCache && !force) return addressCache;
  try {
    addressCache = await api("/api/addresses");
  } catch (error) {
    console.warn("[addresses] saved addresses unavailable:", errorToMessage(error));
    addressCache = [];
  }
  return addressCache;
}

async function renderCounters() {
  const cartItems = await getCart();
  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity, 0);
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
  const label = document.getElementById("mobileAccountLabel");
  const desktopLogin = document.getElementById("desktopLoginLink");
  const desktopProfile = document.getElementById("desktopProfileLink");
  const desktopDot = desktopProfile?.querySelector(".desktop-account-dot");
  const session = getSession();
  const user = session?.user || null;
  const loggedIn = Boolean(getSession());

  if (link) link.href = loggedIn ? "#/profile" : "#/auth";
  if (label) label.textContent = loggedIn ? "Profile" : "Login";
  if (desktopLogin) desktopLogin.hidden = loggedIn;
  if (desktopProfile) desktopProfile.hidden = !loggedIn;
  if (desktopDot && user) {
    const metadata = user.user_metadata || {};
    const sourceName = metadata.full_name || metadata.name || user.email || "Urban Kicks";
    desktopDot.textContent = sourceName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "UK";
  }
}

function getMobileNavState() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const root = parts[0] || "home";
  const mainTabRoute = !parts.length
    || (root === "categories" && parts.length === 1)
    || (root === "wishlist" && parts.length === 1)
    || (root === "cart" && parts.length === 1)
    || (root === "profile" && parts.length === 1)
    || (root === "auth" && parts.length <= 1);
  const shouldHide = !mainTabRoute;
  const activeKey = root === "cart" ? "cart"
    : root === "wishlist" ? "wishlist"
      : root === "categories" || root === "category" || root === "brand" ? "categories"
        : root === "profile" || root === "auth" ? "account"
          : "home";

  return { activeKey, parts, root, shouldHide };
}

function mobileNavTarget(key) {
  const session = getSession();
  return key === "cart" ? "#/cart"
    : key === "wishlist" ? "#/wishlist"
      : key === "categories" ? "#/categories"
        : key === "account" ? (session ? "#/profile" : "#/auth")
          : "#/";
}

function scrollPageTop() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function updateMobileActiveNav() {
  const { activeKey, shouldHide } = getMobileNavState();
  const nav = document.querySelector(".mobile-bottom-nav");
  if (nav) nav.hidden = shouldHide;

  document.querySelectorAll("[data-mobile-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.mobileNav === activeKey);
  });
}

function setupMobileBottomNav() {
  document.querySelectorAll(".mobile-bottom-nav [data-mobile-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const key = link.dataset.mobileNav;
      const { activeKey } = getMobileNavState();
      if (key !== activeKey) return;

      event.preventDefault();
      const target = mobileNavTarget(key);
      const normalizedHash = location.hash || "#/";

      if (normalizedHash === target || (key === "home" && ["#", "#/"].includes(normalizedHash))) {
        router();
        scrollPageTop();
        return;
      }

      location.hash = target;
      window.setTimeout(scrollPageTop, 140);
    });
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

function setupSplashScreen() {
  if (!splashScreen) {
    document.body.classList.add("splash-complete");
    return;
  }

  let hasSeenSplash = false;
  try {
    hasSeenSplash = sessionStorage.getItem(SPLASH_KEY) === "true";
  } catch (_error) {
    hasSeenSplash = false;
  }

  if (hasSeenSplash) {
    splashScreen.remove();
    document.body.classList.remove("splash-active");
    document.body.classList.add("splash-complete");
    return;
  }

  document.body.classList.add("splash-active");
  window.setTimeout(() => {
    splashScreen.classList.add("hide");
    splashScreen.setAttribute("aria-hidden", "true");
    document.body.classList.remove("splash-active");
    document.body.classList.add("splash-complete");
    try {
      sessionStorage.setItem(SPLASH_KEY, "true");
    } catch (_error) {}
    window.setTimeout(() => splashScreen.remove(), SPLASH_FADE_MS);
  }, SPLASH_HOLD_MS);
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
  if (getSession()) {
    try {
      await api("/api/cart", {
        method: "POST",
        body: JSON.stringify({ productId: id, size, color, quantity: 1 })
      });
      cartCache = null;
    } catch (error) {
      notify(errorToMessage(error, "Could not add item to bag."), "error");
      return;
    }
  } else {
    const cart = getLocalCart();
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
    saveLocalCart(cart);
  }
  await renderCounters();
  notify(`${product.name} added to bag.`, "success");
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
      <p class="notice">Payment method: COD live. UPI is being prepared.</p>
      ${checkout ? '<a class="button primary" href="#/checkout">Checkout</a>' : ""}
    </aside>
  `;
}

async function cartPage() {
  const cart = await getCart(true);
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

async function changeQty(index, delta) {
  const cart = await getCart();
  const item = cart[index];
  if (!item) return;
  const nextQuantity = Number(item.quantity || 1) + delta;
  if (getSession()) {
    try {
      if (nextQuantity < 1) await api(`/api/cart/${item.id}`, { method: "DELETE" });
      else await api(`/api/cart/${item.id}`, { method: "PATCH", body: JSON.stringify({ quantity: nextQuantity }) });
      cartCache = null;
    } catch (error) {
      notify(errorToMessage(error, "Could not update bag."), "error");
    }
  } else {
    item.quantity = nextQuantity;
    if (item.quantity < 1) cart.splice(index, 1);
    saveLocalCart(cart);
  }
  await renderCounters();
  cartPage();
}

async function removeItem(index) {
  const cart = await getCart();
  const item = cart[index];
  if (!item) return;
  if (getSession()) {
    try {
      await api(`/api/cart/${item.id}`, { method: "DELETE" });
      cartCache = null;
    } catch (error) {
      notify(errorToMessage(error, "Could not remove item."), "error");
    }
  } else {
    cart.splice(index, 1);
    saveLocalCart(cart);
  }
  await renderCounters();
  cartPage();
}

async function checkoutPage() {
  if (!getSession()) {
    notify("Login to place an order.", "info");
    location.hash = "#/auth";
    return;
  }
  const cart = await getCart(true);
  if (!cart.length) return cartPage();
  const totals = cartTotals(cart);
  const addresses = await getAddresses();
  const selectedAddress = addresses.find((address) => address.id === checkoutSelectedAddressId)
    || addresses.find((address) => address.isDefault)
    || addresses[0];
  checkoutSelectedAddressId = selectedAddress?.id || "";
  checkoutPaymentMethod = PAYMENT_METHODS[checkoutPaymentMethod]?.enabled ? checkoutPaymentMethod : "cod";
  app.innerHTML = `
    <section class="checkout-layout">
      <div class="panel checkout-main-panel">
        <div class="checkout-title-block">
          <p class="eyebrow">Secure Checkout</p>
          <h1>Delivery & Payment</h1>
          <p>Choose a delivery address and payment method. COD is live today; UPI is staged for the next payment upgrade.</p>
        </div>
        ${checkoutAddressSelector(addresses, selectedAddress)}
        <form class="form" id="checkoutForm">
          <input type="hidden" name="address_id" value="${safe(selectedAddress?.id || "")}">
          <input type="hidden" name="payment_method" id="checkoutPaymentMethod" value="${safe(checkoutPaymentMethod)}">
          <label>Full name<input name="name" required value="${safe(selectedAddress?.fullName || getUser()?.user_metadata?.name || "")}" placeholder="Your name"></label>
          <label>Email<input name="email" type="email" required value="${safe(getUser()?.email || "")}" placeholder="you@example.com"></label>
          <label>Mobile number<input name="phone" required value="${safe(selectedAddress?.phone || "")}" placeholder="+91 90000 00000"></label>
          <label>City<input name="city" required value="${safe(selectedAddress?.city || "")}" placeholder="Bengaluru"></label>
          <label>Address<textarea name="address" rows="4" required placeholder="House, street, area">${safe(formatAddress(selectedAddress))}</textarea></label>
          ${paymentMethodSection(checkoutPaymentMethod)}
          <button class="button primary checkout-place-order" type="submit"><span class="button-label">Place COD Order</span><span class="button-spinner" aria-hidden="true"></span></button>
        </form>
      </div>
      ${summaryPanel(totals, false)}
    </section>
  `;
  document.getElementById("checkoutForm").addEventListener("submit", placeOrder);
  setupCheckoutPaymentControls();
}

function paymentMethodSection(selectedMethod = "cod") {
  const cod = PAYMENT_METHODS.cod;
  const upi = PAYMENT_METHODS.upi;
  return `
    <section class="payment-method-section" aria-label="Payment method">
      <div class="payment-section-head">
        <div>
          <p class="eyebrow">Payment</p>
          <h2>Choose payment method</h2>
        </div>
        <span>Secure checkout</span>
      </div>
      <div class="payment-method-grid">
        ${paymentMethodCard(cod, selectedMethod === "cod")}
        ${paymentMethodCard(upi, selectedMethod === "upi")}
      </div>
      <div class="upi-preview-strip" aria-label="UPI partners coming soon">
        <span class="upi-wordmark">UPI</span>
        <span>BHIM</span>
        <span>GPay</span>
        <span>PhonePe</span>
        <span>Paytm</span>
      </div>
      <p class="payment-note">UPI/Razorpay code path is intentionally disabled until real payment integration is approved.</p>
    </section>
  `;
}

function paymentMethodCard(method, active = false) {
  return `
    <button class="payment-method-card ${active ? "active" : ""} ${method.enabled ? "" : "coming-soon"}" type="button" data-payment-method="${safe(method.id)}" aria-pressed="${active}">
      <span class="payment-card-top">
        <strong>${safe(method.label)}</strong>
        <em>${safe(method.status)}</em>
      </span>
      <span class="payment-card-mark">${safe(method.shortLabel)}</span>
      <small>${safe(method.copy)}</small>
      <span class="payment-card-trust">${safe(method.trust)}</span>
    </button>
  `;
}

function setupCheckoutPaymentControls() {
  const form = document.getElementById("checkoutForm");
  const hidden = document.getElementById("checkoutPaymentMethod");
  document.querySelectorAll("[data-payment-method]").forEach((button) => {
    button.addEventListener("click", () => {
      const methodId = button.dataset.paymentMethod;
      const method = PAYMENT_METHODS[methodId];
      if (!method?.enabled) {
        showUpiComingSoonModal();
        return;
      }
      checkoutPaymentMethod = methodId;
      if (hidden) hidden.value = methodId;
      document.querySelectorAll("[data-payment-method]").forEach((card) => {
        const isActive = card.dataset.paymentMethod === methodId;
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", String(isActive));
      });
      form?.querySelector(".checkout-place-order .button-label")?.replaceChildren(document.createTextNode("Place COD Order"));
    });
  });
}

function showUpiComingSoonModal() {
  document.querySelector(".payment-coming-soon-backdrop")?.remove();
  const modal = document.createElement("div");
  modal.className = "payment-coming-soon-backdrop";
  modal.innerHTML = `
    <section class="payment-coming-soon-modal" role="dialog" aria-modal="true" aria-labelledby="upiComingSoonTitle">
      <button class="notification-dismiss payment-modal-close" type="button" aria-label="Close UPI coming soon">&times;</button>
      <div class="upi-modal-brand">
        <span class="upi-wordmark">UPI</span>
        <span>Secure checkout</span>
      </div>
      <p class="eyebrow">Coming Soon</p>
      <h2 id="upiComingSoonTitle">UPI payments are almost here</h2>
      <p>Urban Kicks is preparing UPI checkout for faster prepaid orders. Razorpay is not connected yet, so no payment popup will open and no transaction will be created.</p>
      <div class="upi-logo-row" aria-label="UPI options planned">
        <span>BHIM</span>
        <span>GPay</span>
        <span>PhonePe</span>
        <span>Paytm</span>
      </div>
      <button class="button primary" type="button" id="continueWithCodButton">Continue with COD</button>
    </section>
  `;
  document.body.appendChild(modal);
  window.setTimeout(() => modal.classList.add("show"), 20);
  const close = () => modal.remove();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  modal.querySelector(".payment-modal-close")?.addEventListener("click", close);
  modal.querySelector("#continueWithCodButton")?.addEventListener("click", () => {
    checkoutPaymentMethod = "cod";
    document.getElementById("checkoutPaymentMethod")?.setAttribute("value", "cod");
    document.querySelector('[data-payment-method="cod"]')?.classList.add("active");
    close();
  });
}

function checkoutAddressSelector(addresses, selectedAddress) {
  if (!getSession()) return "";
  return `
    <section class="checkout-address-panel">
      <div class="address-panel-head">
        <div><strong>Deliver to</strong><p>${selectedAddress ? "Default address selected first." : "Add an address for faster checkout."}</p></div>
        <a class="text-button" href="#/profile/addresses/new">Add new</a>
      </div>
      <div class="checkout-address-list">
        ${addresses.map((address) => `
          <button class="checkout-address-option ${address.id === selectedAddress?.id ? "active" : ""}" type="button" onclick="selectCheckoutAddress('${address.id}')">
            <span>${safe(address.addressType)}${address.isDefault ? " / Default" : ""}</span>
            <strong>${safe(address.fullName)}</strong>
            <small>${safe(formatAddress(address))}</small>
            <em>Deliver here</em>
          </button>
        `).join("") || '<div class="premium-empty compact"><h3>No saved address</h3><p>Add an address from My Account to use quick checkout.</p></div>'}
      </div>
    </section>
  `;
}

function selectCheckoutAddress(id) {
  checkoutSelectedAddressId = id;
  checkoutPage();
}

async function placeOrder(event) {
  event.preventDefault();
  if (orderInFlight) return;
  if (!getSession()) {
    notify("Login to place an order.", "error");
    location.hash = "#/auth";
    return;
  }
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form));
  if (data.payment_method !== "cod") {
    showUpiComingSoonModal();
    return;
  }
  if (!data.address_id) {
    notify("Select or add a saved delivery address first.", "error");
    return;
  }
  orderInFlight = true;
  setButtonLoading(button, true, "Placing COD order...");
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ addressId: data.address_id, paymentMethod: "cod" })
    });
    cartCache = [];
    localStorage.removeItem(CART_KEY);
    catalogCache = null;
    await renderCounters();
    notify("COD order placed successfully.", "success");
    location.hash = `#/confirmation/${order._id}`;
  } catch (error) {
    showAuthError(error, error.message || "Could not place order.");
  } finally {
    orderInFlight = false;
    setButtonLoading(button, false);
  }
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
          <span>30-second resend timer</span>
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
    <p class="auth-note">Recover access with a secure 6-digit email OTP, then set a fresh password inside Urban Kicks.</p>
    <form class="form email-auth-form" id="otpLoginForm">
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="button dark" type="submit" id="sendEmailOtpButton">
        <span class="button-label">Send Recovery OTP</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
    </form>
    <p class="auth-switch">Back to <a href="#/auth">Login</a></p>
    ${otpPanelMarkup()}
    <form class="form email-auth-form recovery-password-panel" id="recoveryPasswordForm" hidden>
      <p class="eyebrow">Final Step</p>
      <h2>Set new password</h2>
      <p class="auth-note">Your OTP is verified. Create a new password to finish recovering your account.</p>
      <label>New Password<input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
      <label>Confirm Password<input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="Repeat new password"></label>
      <button class="button primary" type="submit"><span class="button-label">Update Password</span><span class="button-spinner" aria-hidden="true"></span></button>
    </form>
  `;
}

function otpPanelMarkup() {
  return `
    <div class="email-otp-panel" id="emailOtpPanel" hidden>
      <div class="otp-panel-head">
        <span class="otp-status-dot"></span>
        <div>
          <strong>Email verification</strong>
          <p class="auth-note">Enter the 6-digit OTP sent to your email. This code expires in 10 minutes.</p>
        </div>
      </div>
      <div class="otp-boxes" id="emailOtpBoxes" aria-label="Email one time password">${otpInputMarkup()}</div>
      <input type="hidden" name="otp" id="emailOtpValue">
      <button class="button primary email-otp-verify-button" type="button" id="verifyEmailOtpButton">
        <span class="button-label">Verify OTP</span>
        <span class="button-spinner" aria-hidden="true"></span>
      </button>
      <button class="button light email-otp-resend-button" type="button" id="resendEmailOtpButton" disabled>Resend OTP in 30s</button>
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

function createEmptyEmailAuthState() {
  return {
    email: "",
    profileData: null,
    flow: "",
    shouldCreateUser: false,
    cooldownUntil: 0,
    otpExpiresAt: 0,
    verifyAttempts: 0,
    timer: null,
    inFlight: false,
    recoverySession: null,
    pendingEmailChange: null
  };
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
  const recoveryPasswordForm = document.getElementById("recoveryPasswordForm");

  loginForm?.addEventListener("submit", loginWithPassword);
  signupForm?.addEventListener("submit", sendSignupEmailOtp);
  otpLoginForm?.addEventListener("submit", sendForgotEmailOtp);
  recoveryPasswordForm?.addEventListener("submit", completeRecoveryPasswordReset);

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
  if (emailAuthState.flow === "email_change") {
    const button = document.getElementById("resendEmailOtpButton");
    const cooldownKey = `${OTP_COOLDOWN_KEY}:email_change:${emailAuthState.email.toLowerCase()}`;
    if (emailAuthState.inFlight || Date.now() < emailAuthState.cooldownUntil) {
      notify("Please wait before requesting another email OTP.", "error");
      return;
    }
    emailAuthState.inFlight = true;
    setButtonLoading(button, true, "Sending OTP...");
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.updateUser({ email: emailAuthState.email });
      if (error) throw new Error(authErrorMessage(error, error.message || "Could not resend email OTP."));
      emailAuthState.otpExpiresAt = Date.now() + EMAIL_OTP_EXPIRY_MS;
      emailAuthState.verifyAttempts = 0;
      startEmailAuthCooldown(cooldownKey);
      resetEmailOtpInputs();
      notify("OTP sent", "success");
    } catch (error) {
      showAuthError(error, error.message || "Could not resend email OTP.");
    } finally {
      emailAuthState.inFlight = false;
      setButtonLoading(button, false);
      updateEmailAuthCooldown();
    }
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
  setButtonLoading(button, true, "Sending OTP...");
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
    emailAuthState.otpExpiresAt = Date.now() + EMAIL_OTP_EXPIRY_MS;
    emailAuthState.verifyAttempts = 0;
    emailAuthState.recoverySession = null;
    const otpPanel = document.getElementById("emailOtpPanel");
    if (otpPanel) otpPanel.hidden = false;
    const recoveryPanel = document.getElementById("recoveryPasswordForm");
    if (recoveryPanel) recoveryPanel.hidden = true;
    resetEmailOtpInputs();
    startEmailAuthCooldown(cooldownKey);
    notify("OTP sent", "success");
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

  if (Date.now() > emailAuthState.otpExpiresAt) {
    notify("This OTP window has expired. Please request a fresh email OTP.", "error");
    return;
  }

  if (emailAuthState.verifyAttempts >= EMAIL_OTP_MAX_VERIFY_ATTEMPTS) {
    notify("Too many incorrect attempts. Request a fresh OTP to continue.", "error");
    return;
  }

  setButtonLoading(verifyButton, true, "Verifying...");
  try {
    const client = await getSupabaseClient();
    console.log(`[auth] verifying email OTP for ${email}`);
    const otpType = emailAuthState.flow === "recovery" ? "recovery" : emailAuthState.flow === "email_change" ? "email_change" : "signup";
    emailAuthState.verifyAttempts += 1;
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

    if (emailAuthState.flow === "recovery") {
      await syncSessionFromSupabase(authData.session);
      emailAuthState.recoverySession = authData.session;
      document.getElementById("emailOtpPanel")?.setAttribute("hidden", "");
      const recoveryPanel = document.getElementById("recoveryPasswordForm");
      if (recoveryPanel) recoveryPanel.hidden = false;
      notify("OTP verified. Set your new password.", "success");
      return;
    }

    if (emailAuthState.flow === "email_change") {
      await syncSessionFromSupabase(authData.session);
      const pending = emailAuthState.pendingEmailChange || {};
      await upsertUserProfile(authData.user, {
        name: pending.name,
        full_name: pending.name,
        email,
        mobile: pending.mobile || "",
        phone_number: pending.mobile || ""
      });
      emailAuthState = createEmptyEmailAuthState();
      notify("Email updated and verified.", "success");
      location.hash = "#/profile";
      return;
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
    emailAuthState = createEmptyEmailAuthState();
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

async function completeRecoveryPasswordReset(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form));
  const password = String(data.password || "");
  const confirmPassword = String(data.confirmPassword || "");

  if (password.length < 6) return notify("Password must be at least 6 characters.", "error");
  if (password !== confirmPassword) return notify("Passwords do not match.", "error");
  if (!emailAuthState.recoverySession) return notify("Verify your recovery OTP before setting a new password.", "error");

  setButtonLoading(button, true, "Updating...");
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error, error.message || "Could not update password."));
    if (emailAuthState.timer) window.clearTimeout(emailAuthState.timer);
    emailAuthState = createEmptyEmailAuthState();
    form.reset();
    notify("Password updated. Welcome back.", "success");
    location.hash = "#/profile/security";
  } catch (error) {
    showAuthError(error, error.message || "Could not update password.");
  } finally {
    setButtonLoading(button, false);
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
  addressCache = null;
  cartCache = null;
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
    mobile: profile.phone || profile.phone_number || profile.mobile || metadata.phone_number || metadata.mobile || session.user?.phone || "",
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

function splitProfileName(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function accountIcon(title) {
  const paths = {
    Orders: "M5 6.5h14v12H5v-12Zm2 2v8h10v-8H7Zm2-5h6v2H9v-2Z",
    Wishlist: "M12 19.6 10.8 18.5C7 15.1 4.5 12.8 4.5 9.9A3.9 3.9 0 0 1 8.4 6c1.4 0 2.7.7 3.6 1.8A4.4 4.4 0 0 1 15.6 6a3.9 3.9 0 0 1 3.9 3.9c0 2.9-2.5 5.2-6.3 8.6L12 19.6Z",
    Cart: "M6.5 7.2h11l-.8 9.8a2.3 2.3 0 0 1-2.3 2.1H9.6A2.3 2.3 0 0 1 7.3 17l-.8-9.8Zm2 1.8.6 7.8c0 .3.3.6.6.6h4.6c.3 0 .6-.3.6-.6l.6-7.8H8.5ZM9 6.8a3 3 0 0 1 6 0h-1.7a1.3 1.3 0 0 0-2.6 0H9Z",
    Addresses: "M12 21s6-5.2 6-10.1A6 6 0 1 0 6 10.9C6 15.8 12 21 12 21Zm0-8.1a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1Z",
    "Payment Methods": "M4 6.5h16v11H4v-11Zm1.8 3H18.2V8.2H5.8v1.3Zm0 2v4.2H18.2v-4.2H5.8Z",
    Notifications: "M12 21a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 21Zm-5.9-3.5h11.8l-1.4-1.8v-4.3a4.5 4.5 0 0 0-3.5-4.5V5a1 1 0 1 0-2 0v1.9a4.5 4.5 0 0 0-3.5 4.5v4.3l-1.4 1.8Z",
    "Privacy & Data": "M12 21c4-1.7 6-4.6 6-8.7V6.5L12 4 6 6.5v5.8c0 4.1 2 7 6 8.7Zm0-4.4a2.8 2.8 0 0 0 2.8-2.8v-2.1h.6V9.9h-1V8.8a2.4 2.4 0 0 0-4.8 0v1.1h-1v1.8h.6v2.1a2.8 2.8 0 0 0 2.8 2.8Zm-1-6.7V8.8a1 1 0 0 1 2 0v1.1h-2Z",
    Security: "M12 21c4-1.7 6-4.6 6-8.7V6.5L12 4 6 6.5v5.8c0 4.1 2 7 6 8.7Zm-.7-5 4.1-4.9-1.4-1.1-2.9 3.5-1.2-1.3-1.3 1.2 2.7 2.6Z",
    Settings: "M19.4 13.5a7.9 7.9 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8.2 8.2 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8.2 8.2 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.9 7.9 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8.2 8.2 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8.2 8.2 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5ZM12 15.4a3.4 3.4 0 1 1 0-6.8 3.4 3.4 0 0 1 0 6.8Z",
    "Help & Support": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.9-5.8c0-1.2.6-1.9 1.6-2.6.8-.6 1.2-.9 1.2-1.6 0-.8-.7-1.3-1.7-1.3-1 0-1.8.5-2.4 1.3L8.5 8.8A4.4 4.4 0 0 1 12.3 7c2.1 0 3.5 1.1 3.5 2.8 0 1.4-.7 2.1-1.9 2.9-.8.6-1.1.9-1.1 1.6h-1.7Zm-.1 3h2v-2h-2v2Z",
    "About Urban Kicks": "M5 5h14v14H5V5Zm2 2v10h10V7H7Zm2 2h6v1.7H9V9Zm0 3h6v1.7H9V12Z",
    Logout: "M5 4h8v2H7v12h6v2H5V4Zm10.3 4.3 4.2 4.2-4.2 4.2-1.3-1.4 1.8-1.8H10v-2h5.8L14 9.7l1.3-1.4Z"
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[title] || paths.Orders}"/></svg>`;
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
    <a class="account-card account-menu-row" href="${href}">
      <span class="account-row-icon">${accountIcon(title)}</span>
      <div class="account-row-copy">
        <h3>${safe(title)}</h3>
        <p>${safe(copy)}</p>
      </div>
      <span class="account-arrow" aria-hidden="true">&gt;</span>
    </a>
  `;
}

function formatAddress(address) {
  if (!address) return "";
  return [address.houseNo, address.area, address.landmark, address.city, address.state, address.pincode]
    .filter(Boolean)
    .join(", ");
}

function addressCard(address) {
  return `
    <article class="address-card ${address.isDefault ? "default" : ""}">
      <div class="address-card-top">
        <span>${safe(address.addressType)}</span>
        ${address.isDefault ? "<strong>Default</strong>" : ""}
      </div>
      <h3>${safe(address.fullName)}</h3>
      <p>${safe(address.phone)}</p>
      <p>${safe(formatAddress(address))}</p>
      <div class="address-actions">
        <a class="button light" href="#/profile/addresses/edit/${address.id}">Edit</a>
        <button class="button light" onclick="setDefaultAddress('${address.id}')" ${address.isDefault ? "disabled" : ""}>Set default</button>
        <button class="button danger" onclick="deleteAddress('${address.id}')">Delete</button>
      </div>
    </article>
  `;
}

async function addressListPage(account) {
  const addresses = await getAddresses(true);
  const hasAddresses = addresses.length > 0;
  app.innerHTML = `
    <section class="profile-shell narrow address-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile" aria-label="Back to account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>Addresses</h1>
        <span aria-hidden="true"></span>
      </div>
      <div class="address-hero">
        <div>
          <p class="eyebrow">Delivery book</p>
          <h2>Saved addresses</h2>
          <p>Choose default delivery details for faster Cash on Delivery checkout.</p>
        </div>
        ${hasAddresses ? '<a class="button primary" href="#/profile/addresses/new">Add new address</a>' : ""}
      </div>
      <div class="address-grid">${addresses.map(addressCard).join("") || '<div class="premium-empty address-empty-state"><h3>No saved addresses yet</h3><p>Add one delivery address for faster checkout and smoother Cash on Delivery orders.</p><a class="button primary" href="#/profile/addresses/new">Add address</a></div>'}</div>
    </section>
  `;
}

function addressFormPage(account, mode = "new", id = "") {
  const existing = (addressCache || []).find((address) => address.id === id) || {};
  const isEdit = mode === "edit";
  app.innerHTML = `
    <section class="profile-shell narrow address-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile/addresses" aria-label="Back to addresses">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>${isEdit ? "Edit Address" : "Add Address"}</h1>
        <span aria-hidden="true"></span>
      </div>
      <form class="address-form" id="addressForm" data-address-id="${safe(existing.id || "")}">
        ${addressFormSection("Contact Info", `
          ${addressField("Full Name", "fullName", existing.fullName || account.profile.name, "text", true)}
          ${addressField("Phone Number", "phone", existing.phone || account.profile.mobile, "tel", true)}
          ${addressField("Alternate Phone", "alternatePhone", existing.alternatePhone || "", "tel", false)}
        `)}
        ${addressFormSection("Address Info", `
          ${smartSelectField("State / Union Territory", "state", existing.state || "", "Search state")}
          ${smartSelectField("City", "city", existing.city || "", "Select state first")}
          ${addressField("Pincode", "pincode", existing.pincode || "", "text", true, "numeric")}
          ${addressField("Locality / Area / Street", "area", existing.area || "", "text", true)}
          ${addressField("Flat / House / Building", "houseNo", existing.houseNo || "", "text", true)}
          ${addressField("Landmark (optional)", "landmark", existing.landmark || "", "text", false)}
        `)}
        <section class="address-form-section">
          <h2>Address Type</h2>
          <div class="address-type-group">
            ${["Home", "Work", "Other"].map((type) => `<label class="address-type-option ${(existing.addressType || "Home") === type ? "active" : ""}"><input type="radio" name="addressType" value="${type}" ${(existing.addressType || "Home") === type ? "checked" : ""}><span>${type}</span></label>`).join("")}
          </div>
          <small class="field-error" data-field-error="addressType"></small>
        </section>
        <label class="default-toggle"><input type="checkbox" name="isDefault" ${existing.isDefault ? "checked" : ""}><span>Make as default address</span></label>
        <div class="address-form-actions"><button class="button primary" type="submit" disabled><span class="button-label">Save Address</span><span class="button-spinner" aria-hidden="true"></span></button></div>
      </form>
    </section>
  `;
  setupAddressForm();
}

function addressFormSection(title, fields) {
  return `<section class="address-form-section"><h2>${safe(title)}</h2><div class="address-form-grid">${fields}</div></section>`;
}

function addressField(label, name, value = "", type = "text", required = false, inputmode = "") {
  return `<label class="modern-field smart-field">${safe(label)}<input name="${name}" type="${type}" value="${safe(value)}" ${required ? "required" : ""} ${inputmode ? `inputmode="${inputmode}"` : ""}><small class="field-error" data-field-error="${name}"></small></label>`;
}

function smartSelectField(label, name, value = "", placeholder = "Search") {
  return `
    <label class="modern-field smart-field smart-select-field" data-smart-select="${name}">
      ${safe(label)}
      <input type="hidden" name="${name}" value="${safe(value)}">
      <input class="smart-select-search" id="${name}Search" type="search" autocomplete="off" value="${safe(value)}" placeholder="${safe(placeholder)}" role="combobox" aria-expanded="false">
      <div class="smart-select-menu" id="${name}Menu" role="listbox"></div>
      <small class="field-error" data-field-error="${name}"></small>
    </label>
  `;
}

async function profilePage(section = "overview", action = "", id = "") {
  const session = getSession();
  if (!session) return authPage();
  const account = await getAccountData();
  if (section === "edit") return profileEditPage(account);
  if (section === "security") return profileSecurityPage(account);
  if (section === "settings" && action === "delete-account") return deleteAccountComingSoonPage();
  if (section === "settings" && ["privacy", "data"].includes(action)) return privacyDataPage(action);
  if (section === "settings") return settingsPage();
  if (section === "addresses" && (action === "new" || action === "edit")) {
    if (action === "edit" && !addressCache) await getAddresses(true);
    return addressFormPage(account, action, id);
  }
  if (section === "addresses") return addressListPage(account);
  if (section !== "overview") return profileSectionPage(account, section);
  const cartItems = await getCart();
  const delivered = account.orders.filter((order) => order.status === "Delivered").length;
  const cancelled = account.orders.filter((order) => order.status === "Cancelled").length;
  const latestOrders = account.orders.slice(0, 3);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  app.innerHTML = `
    <section class="profile-shell account-app-shell">
      <div class="profile-hero-card account-profile-card">
        <div class="profile-identity">
          ${avatarMarkup(account.profile)}
          <div>
            <h1>${safe(account.profile.name)}</h1>
            <p>${safe(account.profile.email || "Email session active")}</p>
            ${account.profile.mobile ? `<p>${safe(account.profile.mobile)}</p>` : ""}
          </div>
        </div>
        <a class="account-edit-link" href="#/profile/edit">Edit</a>
      </div>

      <div class="profile-stats account-mini-stats">
        <article><strong>${account.orders.length}</strong><span>Orders</span></article>
        <article><strong>${account.wishlist.length}</strong><span>Wishlist</span></article>
        <article><strong>${cartTotal}</strong><span>Bag</span></article>
        <article><strong>${account.transactions.length}</strong><span>Payments</span></article>
      </div>

      <div class="account-layout account-app-layout">
        <div class="account-main">
          <div class="account-card-grid account-menu-list">
            ${accountCard("Orders", `${account.orders.length} total / ${delivered} delivered / ${cancelled} cancelled`, "#/profile/orders", "Track")}
            ${accountCard("Wishlist", `${account.wishlist.length} saved sneakers`, "#/wishlist", "Saved")}
            ${accountCard("Cart", `${cartTotal} items waiting`, "#/cart", "Checkout")}
            ${accountCard("Addresses", "Add, edit, or delete delivery addresses", "#/profile/addresses", "Manage")}
            ${accountCard("Payment Methods", "Cash on Delivery active. Online payments ready later.", "#/profile/payments", "Payment")}
            ${accountCard("Notifications", "Email and drop alert preferences", "#/profile/notifications", "Alerts")}
            ${accountCard("Settings", "Theme, notifications, app preferences, and account protection", "#/profile/settings", "Tune")}
            ${accountCard("Help & Support", "FAQ, contact support, returns, and refunds", "#/help", "Support")}
            ${accountCard("About Urban Kicks", "Brand story, terms, and privacy", "#/about", "Brand")}
            ${accountCard("Logout", "Securely end this session", "javascript:logout()", "Exit")}
          </div>

          <section class="account-panel account-activity-panel">
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
    <section class="profile-shell narrow edit-profile-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile" aria-label="Back to account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>Edit Profile</h1>
        <span aria-hidden="true"></span>
      </div>

      <div class="edit-profile-preview">
        <div id="profilePreview" class="profile-preview">${avatarMarkup(account.profile, "medium")}</div>
        <div class="edit-preview-copy">
          <h2>${safe(account.profile.name)}</h2>
          <p>Manage the essentials for checkout, support, and account recovery.</p>
        </div>
      </div>

      <form class="panel profile-edit-form modern-profile-form" id="profileEditForm">
        <div class="form-section-title">
          <p class="eyebrow">Personal details</p>
          <h2>Account information</h2>
        </div>

        <div class="profile-form-grid">
          <label class="modern-field full">Full Name<input name="name" required value="${safe(account.profile.name)}" autocomplete="name" placeholder="Your full name"></label>
          <label class="modern-field">Email<input name="email" type="email" required value="${safe(account.profile.email)}" autocomplete="email" placeholder="you@example.com"></label>
          <label class="modern-field">Phone Number<input name="mobile" type="tel" inputmode="tel" value="${safe(account.profile.mobile)}" autocomplete="tel" placeholder="+91 90000 00000"></label>
        </div>

        <input type="hidden" name="profile_image" value="${safe(account.profile.image)}">
        <div class="profile-form-actions">
          <button class="button primary" type="submit"><span class="button-label">Update Profile</span><span class="button-spinner" aria-hidden="true"></span></button>
          <button class="button light" type="reset">Reset</button>
        </div>
      </form>

      <div class="email-otp-panel profile-email-otp-panel" id="profileEmailOtpPanel" hidden>
        <div class="otp-panel-head">
          <span class="otp-status-dot"></span>
          <div>
            <strong>Verify new email</strong>
            <p class="auth-note">Enter the OTP sent to your new email before Urban Kicks updates your account email.</p>
          </div>
        </div>
        <div class="otp-boxes" id="emailOtpBoxes" aria-label="Email change one time password">${otpInputMarkup()}</div>
        <input type="hidden" name="otp" id="emailOtpValue">
        <button class="button primary email-otp-verify-button" type="button" id="verifyEmailOtpButton">
          <span class="button-label">Verify Email</span>
          <span class="button-spinner" aria-hidden="true"></span>
        </button>
        <button class="button light email-otp-resend-button" type="button" id="resendEmailOtpButton" disabled>Resend OTP in 30s</button>
      </div>

      <section class="appearance-panel">
        <div>
          <p class="eyebrow">Appearance</p>
          <h2>Theme</h2>
          <p>Switch between Urban Kicks dark luxury and clean ecommerce light mode.</p>
        </div>
        <div class="theme-card-grid" role="group" aria-label="Theme selector">
          ${themeCardMarkup("dark", "Black + Red", "Dark sneaker/streetwear luxury")}
          ${themeCardMarkup("light", "White + Black", "Clean minimal shopping app")}
        </div>
      </section>
    </section>
  `;
  setupProfileEditForm();
  updateThemeCards();
}

function themeCardMarkup(theme, title, copy) {
  const isDark = theme === "dark";
  return `
    <button class="theme-card ${isDark ? "theme-card-dark" : "theme-card-light"}" type="button" data-theme-choice="${theme}" onclick="setTheme('${theme}')">
      <span class="theme-swatch" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong>${safe(title)}</strong>
      <small>${safe(copy)}</small>
    </button>
  `;
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
  if (section === "help") {
    supportPage();
    return;
  }

  const titles = {
    orders: ["Orders", "Track, review, and manage sneaker orders."],
    addresses: ["Addresses", "Add, edit, or remove saved delivery addresses."],
    payments: ["Payment Methods", "Cash on Delivery is active. UPI and cards can be enabled later."],
    notifications: ["Notifications", "Control email alerts, drop reminders, and account updates."]
  };
  const [title, copy] = titles[section] || ["Account", "Manage your Urban Kicks profile."];
  const content = section === "orders"
    ? account.orders.map((order) => `<article class="order-card"><div><strong>${safe(order.status)}</strong><div class="meta">${money(order.total)} / ${safe(order.paymentMethod)} / ${safe(order.createdAt || "")}</div></div><a class="button light" href="#/confirmation/${order._id}">View</a></article>`).join("") || '<div class="premium-empty"><h3>No orders yet</h3><p>Your future orders will appear here.</p><a class="button primary" href="#/">Shop sneakers</a></div>'
    : section === "notifications"
      ? notificationPreferencesMarkup()
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
  if (section === "notifications") setupNotificationPreferenceControls();
}

function supportPage() {
  app.innerHTML = `
    <section class="profile-shell narrow support-coming-soon">
      <a class="text-button back-link" href="#/profile">Back to account</a>
      <div class="premium-empty support-center-card">
        <p class="eyebrow">Help & Support</p>
        <h1>Coming Soon</h1>
        <p>Urban Kicks Support Center is coming soon.</p>
        <a class="button primary" href="mailto:hello@urbankicks.example">Contact support</a>
      </div>
    </section>
  `;
}

function getNotificationPrefs() {
  return getStore(NOTIFICATION_PREF_KEY, {
    prompted: false,
    browser: false,
    drops: true,
    sales: true,
    restocks: true,
    orders: true
  });
}

function saveNotificationPrefs(prefs) {
  setStore(NOTIFICATION_PREF_KEY, prefs);
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function savePushPermission(subscription = null, permission = typeof Notification !== "undefined" ? Notification.permission : "default") {
  const payload = {
    permission,
    subscription,
    preferences: getNotificationPrefs(),
    savedAt: new Date().toISOString()
  };
  setStore(PUSH_PERMISSION_STORE_KEY, payload);
  await api("/api/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((error) => console.warn("[notifications] subscription save skipped:", error.message));
}

async function createPushSubscriptionIfAvailable() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const config = await fetch("/api/config/push", { headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .catch(() => null);
  if (!config?.publicKey) return null;
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing.toJSON();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.publicKey)
  });
  return subscription.toJSON();
}

function notificationPreferencesMarkup() {
  const prefs = getNotificationPrefs();
  const row = (key, title, copy) => `
    <label class="settings-toggle-row">
      <span><strong>${safe(title)}</strong><small>${safe(copy)}</small></span>
      <input type="checkbox" data-notification-pref="${key}" ${prefs[key] ? "checked" : ""}>
    </label>
  `;
  return `
    <div class="settings-list notification-settings-list">
      ${row("drops", "New sneaker drops", "Get alerts when curated launches go live.")}
      ${row("sales", "Flash sales", "Hear about limited discounts without inbox noise.")}
      ${row("restocks", "Restocks", "Know when saved sneakers come back.")}
      ${row("orders", "Order updates", "Delivery and checkout status updates.")}
      <button class="button primary" type="button" id="enableBrowserNotifications">Allow Notifications</button>
    </div>
  `;
}

function setupNotificationPreferenceControls() {
  const prefs = getNotificationPrefs();
  document.querySelectorAll("[data-notification-pref]").forEach((input) => {
    input.addEventListener("change", () => {
      prefs[input.dataset.notificationPref] = input.checked;
      saveNotificationPrefs(prefs);
      notify("Notification preferences saved.", "success");
    });
  });
  document.getElementById("enableBrowserNotifications")?.addEventListener("click", requestBrowserNotifications);
}

async function requestBrowserNotifications() {
  const prefs = getNotificationPrefs();
  prefs.prompted = true;
  if (!("Notification" in window)) {
    prefs.browser = false;
    saveNotificationPrefs(prefs);
    await savePushPermission(null, "unsupported");
    return;
  }
  try {
    if (Notification.permission === "denied") {
      prefs.browser = false;
      saveNotificationPrefs(prefs);
      await savePushPermission(null, "denied");
      return;
    }
    const permission = await Notification.requestPermission();
    prefs.browser = permission === "granted";
    saveNotificationPrefs(prefs);
    let subscription = null;
    if (permission === "granted") {
      subscription = await createPushSubscriptionIfAvailable().catch((error) => {
        console.warn("[notifications] push subscription failed:", error.message);
        return null;
      });
    }
    await savePushPermission(subscription, permission);
    if (permission === "granted") notify("Notifications enabled.", "success");
  } catch (error) {
    prefs.browser = false;
    saveNotificationPrefs(prefs);
    await savePushPermission(null, "error");
  }
}

function maybeShowNotificationPrompt() {
  const prefs = getNotificationPrefs();
  if (!("Notification" in window)) return;
  if (prefs.prompted || Notification.permission !== "default") return;

  const showPrompt = () => {
    if (getNotificationPrefs().prompted || Notification.permission !== "default" || document.getElementById("notificationPermissionPrompt")) return;
    const prompt = document.createElement("div");
    prompt.className = "notification-mini-prompt";
    prompt.id = "notificationPermissionPrompt";
    prompt.setAttribute("role", "status");
    prompt.innerHTML = `
      <span>Enable notifications for order updates and offers?</span>
      <div>
        <button class="notification-mini-allow" type="button" id="allowNotificationsButton">Allow</button>
        <button class="notification-mini-later" type="button" id="laterNotificationsButton">Not now</button>
      </div>
    `;
    document.body.appendChild(prompt);
    window.setTimeout(() => prompt.classList.add("show"), 20);
    document.getElementById("allowNotificationsButton")?.addEventListener("click", async () => {
      await requestBrowserNotifications();
      prompt.remove();
    });
    document.getElementById("laterNotificationsButton")?.addEventListener("click", () => {
      saveNotificationPrefs({ ...getNotificationPrefs(), prompted: true, browser: false });
      prompt.remove();
    });
  };

  window.setTimeout(showPrompt, 4500);
  window.addEventListener("click", () => window.setTimeout(showPrompt, 1200), { once: true });
}

function showNotificationDeniedBanner() {
  return null;
}

function showNotificationGuideModal() {
  return null;
}

function setupProfileEditForm() {
  const form = document.getElementById("profileEditForm");
  setupEmailOtpControls();
  form.addEventListener("submit", saveProfile);
}

function setupAddressForm() {
  const form = document.getElementById("addressForm");
  form?.addEventListener("submit", saveAddress);
  if (!form) return;
  setupSmartAddressControls(form);
  setupSmartAddressOutsideClick();
  setupAddressTypeControls(form);
  form.addEventListener("input", (event) => {
    if (event.target?.name === "pincode") {
      handlePincodeInput(form);
      return;
    }
    if (["fullName", "phone", "area", "houseNo"].includes(event.target?.name)) {
      clearFieldError(form, event.target.name);
    }
    updateAddressSubmitState(form);
  });
  form.addEventListener("change", () => updateAddressSubmitState(form));
  if (form.elements.pincode?.value) handlePincodeInput(form);
  updateAddressSubmitState(form);
}

async function getIndiaAddressMeta() {
  if (indiaAddressMeta) return indiaAddressMeta;
  const fallback = {
    "Andaman and Nicobar Islands": ["Port Blair", "Mayabunder", "Diglipur", "Rangat"],
    "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Tirupati", "Kurnool", "Rajahmundry", "Kakinada"],
    "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Tawang", "Pasighat", "Ziro"],
    Assam: ["Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Tezpur", "Nagaon"],
    Bihar: ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia"],
    Chandigarh: ["Chandigarh"],
    Chhattisgarh: ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg"],
    "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Silvassa"],
    Delhi: ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket"],
    Goa: ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
    Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar"],
    Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala", "Hisar", "Karnal", "Rohtak"],
    "Himachal Pradesh": ["Shimla", "Dharamshala", "Mandi", "Solan", "Kullu"],
    "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Udhampur"],
    Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar"],
    Karnataka: ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Davangere", "Udupi"],
    Kerala: ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kollam", "Kannur"],
    Ladakh: ["Leh", "Kargil"],
    Lakshadweep: ["Kavaratti", "Agatti", "Minicoy"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar"],
    Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Solapur", "Kolhapur"],
    Manipur: ["Imphal", "Thoubal", "Bishnupur", "Churachandpur"],
    Meghalaya: ["Shillong", "Tura", "Jowai", "Nongpoh"],
    Mizoram: ["Aizawl", "Lunglei", "Champhai", "Serchhip"],
    Nagaland: ["Kohima", "Dimapur", "Mokokchung", "Wokha"],
    Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Puri", "Sambalpur", "Berhampur"],
    Puducherry: ["Puducherry", "Karaikal", "Yanam", "Mahe"],
    Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali"],
    Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner"],
    Sikkim: ["Gangtok", "Namchi", "Gyalshing", "Mangan"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tiruppur"],
    Telangana: ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam"],
    Tripura: ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar"],
    "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Noida", "Ghaziabad", "Prayagraj", "Meerut"],
    Uttarakhand: ["Dehradun", "Haridwar", "Rishikesh", "Haldwani", "Nainital"],
    "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Siliguri", "Asansol", "Darjeeling"]
  };
  try {
    const data = await api("/api/addresses/india-meta");
    indiaAddressMeta = data.states || fallback;
  } catch (_error) {
    indiaAddressMeta = fallback;
  }
  return indiaAddressMeta;
}

async function setupSmartAddressControls(form) {
  const states = await getIndiaAddressMeta();
  const stateNames = Object.keys(states).sort((a, b) => a.localeCompare(b));
  const setupCitySelect = () => {
    const state = form.elements.state?.value || "";
    const cityOptions = states[state] || [];
    setupSmartSelect(form, "city", cityOptions, (city) => {
      setSmartSelectValue(form, "city", city);
      clearFieldError(form, "city");
      validateSelectedPincodeMatch(form);
      updateAddressSubmitState(form);
      window.setTimeout(() => form.elements.pincode?.focus(), 80);
    });
    const citySearch = form.querySelector("#citySearch");
    if (citySearch) {
      citySearch.disabled = !state;
      citySearch.placeholder = state ? "Search city" : "Select state first";
      citySearch.setAttribute("aria-disabled", String(!state));
    }
  };
  const selectedState = getExactOption(Object.keys(states), form.elements.state?.value) || "";
  if (form.elements.state?.value && !selectedState) {
    setSmartSelectValue(form, "state", "");
  }
  if (selectedState) setSmartSelectValue(form, "state", selectedState);

  setupSmartSelect(form, "state", stateNames, (state) => {
    setSmartSelectValue(form, "state", state);
    setSmartSelectValue(form, "city", "");
    setupCitySelect();
    clearFieldError(form, "state");
    clearFieldError(form, "city");
    validateSelectedPincodeMatch(form);
    updateAddressSubmitState(form);
    window.setTimeout(() => form.querySelector("#citySearch")?.focus(), 80);
  });

  const cityOptions = states[form.elements.state?.value] || [];
  const selectedCity = getExactOption(cityOptions, form.elements.city?.value) || "";
  if (form.elements.city?.value && !selectedCity) setSmartSelectValue(form, "city", "");
  if (selectedCity) setSmartSelectValue(form, "city", selectedCity);

  setupCitySelect();
  updateAddressSubmitState(form);
}

function filterSmartOptions(options, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options.slice(0, 80);
  const startsWith = options.filter((option) => option.toLowerCase().startsWith(normalizedQuery));
  const contains = options.filter((option) => (
    !option.toLowerCase().startsWith(normalizedQuery)
    && option.toLowerCase().includes(normalizedQuery)
  ));
  return [...startsWith, ...contains].slice(0, 80);
}

function setupSmartSelect(form, name, options, onSelect) {
  const field = form.querySelector(`[data-smart-select="${name}"]`);
  const search = field?.querySelector(".smart-select-search");
  const menu = field?.querySelector(".smart-select-menu");
  if (!field || !search || !menu) return;
  let currentOptions = [...options];
  let highlightedIndex = 0;

  const renderOptions = () => {
    const query = search.value.trim().toLowerCase();
    currentOptions = filterSmartOptions(options, query);
    highlightedIndex = 0;
    const emptyText = name === "city" && !form.elements.state?.value ? "Select state first" : `No valid ${name === "state" ? "state" : "city"} found`;
    menu.innerHTML = currentOptions.map((option, index) => `<button class="${index === highlightedIndex ? "highlighted" : ""}" type="button" role="option" data-smart-option="${safe(option)}">${safe(option)}</button>`).join("")
      || `<span class="smart-select-empty">${emptyText}</span>`;
    menu.hidden = false;
    search.setAttribute("aria-expanded", "true");
  };

  const selectOption = (value) => {
    const exact = getExactOption(options, value);
    if (!exact) return false;
    onSelect(exact);
    search.value = exact;
    form.elements[name].value = exact;
    menu.hidden = true;
    search.setAttribute("aria-expanded", "false");
    return true;
  };

  search.onfocus = renderOptions;
  search.oninput = () => {
    form.elements[name].value = "";
    clearFieldError(form, name);
    renderOptions();
    updateAddressSubmitState(form);
  };
  search.onkeydown = (event) => {
    if (event.key === "ArrowDown" && currentOptions.length) {
      event.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, currentOptions.length - 1);
      renderHighlightedOption(menu, highlightedIndex);
    }
    if (event.key === "ArrowUp" && currentOptions.length) {
      event.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      renderHighlightedOption(menu, highlightedIndex);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (menu.hidden) renderOptions();
      const exactTyped = getExactOption(options, search.value);
      const selected = exactTyped || currentOptions[highlightedIndex] || currentOptions[0] || "";
      if (!selectOption(selected)) {
        setFieldError(form, name, name === "state" ? "Select a valid state" : "Select a valid city");
        updateAddressSubmitState(form);
      }
    }
    if (event.key === "Escape") {
      menu.hidden = true;
      search.setAttribute("aria-expanded", "false");
    }
  };
  search.onblur = () => {
    window.setTimeout(() => {
      if (menu.contains(document.activeElement)) return;
      const exact = getExactOption(options, search.value);
      if (exact) {
        selectOption(exact);
      } else if (search.value.trim() || form.elements[name].value) {
        setSmartSelectValue(form, name, "");
        setFieldError(form, name, name === "state" ? "Select a valid state" : "Select a valid city");
      }
      updateAddressSubmitState(form);
    }, 120);
  };
  menu.onmousedown = (event) => {
    const option = event.target.closest("[data-smart-option]");
    if (!option) return;
    event.preventDefault();
    selectOption(option.dataset.smartOption || "");
  };
  menu.hidden = true;
}

function renderHighlightedOption(menu, index) {
  menu.querySelectorAll("[data-smart-option]").forEach((button, buttonIndex) => {
    button.classList.toggle("highlighted", buttonIndex === index);
    if (buttonIndex === index) button.scrollIntoView({ block: "nearest" });
  });
}

function setupSmartAddressOutsideClick() {
  if (smartAddressOutsideClickReady) return;
  smartAddressOutsideClickReady = true;
  document.addEventListener("click", (event) => {
    document.querySelectorAll(".smart-select-field").forEach((field) => {
      if (field.contains(event.target)) return;
      const menu = field.querySelector(".smart-select-menu");
      const search = field.querySelector(".smart-select-search");
      if (menu) menu.hidden = true;
      search?.setAttribute("aria-expanded", "false");
    });
  });
}

function setSmartSelectValue(form, name, value) {
  if (!form.elements[name]) return;
  form.elements[name].value = value;
  const search = form.querySelector(`#${name}Search`);
  if (search) search.value = value;
}

function normalizeSmartText(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function getExactOption(options, value) {
  const normalized = normalizeSmartText(value);
  if (!normalized) return "";
  return options.find((option) => normalizeSmartText(option) === normalized) || "";
}

function setupAddressTypeControls(form) {
  const options = [...form.querySelectorAll(".address-type-option")];
  const sync = () => {
    options.forEach((label) => {
      label.classList.toggle("active", Boolean(label.querySelector("input")?.checked));
    });
    updateAddressSubmitState(form);
  };
  options.forEach((label) => {
    label.addEventListener("click", () => window.setTimeout(sync, 0));
    label.querySelector("input")?.addEventListener("change", sync);
  });
  if (!form.elements.addressType?.value) {
    const home = form.querySelector('input[name="addressType"][value="Home"]');
    if (home) home.checked = true;
  }
  sync();
}

function setFieldError(form, name, message) {
  const error = form.querySelector(`[data-field-error="${name}"]`);
  if (error) error.textContent = message || "";
  const field = form.elements[name];
  if (field?.classList) field.classList.toggle("invalid", Boolean(message));
  if (name === "addressType") {
    form.querySelectorAll(".address-type-option").forEach((option) => option.classList.toggle("invalid", Boolean(message)));
  }
}

function clearFieldError(form, name) {
  setFieldError(form, name, "");
}

function handlePincodeInput(form) {
  const input = form.elements.pincode;
  const rawValue = String(input.value || "");
  input.value = rawValue.replace(/\D/g, "").slice(0, 6);
  clearFieldError(form, "pincode");
  addressPincodeState = { pincode: input.value, valid: false, state: "", city: "", message: "" };
  if ((rawValue && !input.value) || (input.value && input.value.length < 6)) {
    setFieldError(form, "pincode", "Enter a valid 6-digit Indian PIN code");
  }
  if (input.value.length === 6) validatePincodeWithServer(form, input.value);
  updateAddressSubmitState(form);
}

async function validatePincodeWithServer(form, pincode) {
  if (!/^\d{6}$/.test(String(pincode || ""))) {
    addressPincodeState = { pincode, valid: false, state: "", city: "", message: "Enter a valid 6-digit Indian PIN code" };
    setFieldError(form, "pincode", "Enter a valid 6-digit Indian PIN code");
    updateAddressSubmitState(form);
    return false;
  }
  setFieldError(form, "pincode", "Checking PIN code...");
  try {
    const result = await api(`/api/addresses/pincode/${pincode}`);
    addressPincodeState = {
      pincode,
      valid: true,
      state: result.state || "",
      city: result.city || "",
      message: ""
    };
    clearFieldError(form, "pincode");
    if (result.state) setSmartSelectValue(form, "state", result.state);
    if (result.state && result.city) {
      indiaAddressMeta[result.state] = indiaAddressMeta[result.state] || [];
      if (!indiaAddressMeta[result.state].some((city) => city.toLowerCase() === result.city.toLowerCase())) {
        indiaAddressMeta[result.state] = [result.city, ...indiaAddressMeta[result.state]];
      }
    }
    await setupSmartAddressControls(form);
    const cityOptions = (indiaAddressMeta || {})[result.state] || [];
    const city = cityOptions.find((item) => item.toLowerCase() === String(result.city || "").toLowerCase()) || cityOptions[0] || result.city || "";
    if (city) setSmartSelectValue(form, "city", city);
    validateSelectedPincodeMatch(form);
    updateAddressSubmitState(form);
    return true;
  } catch (error) {
    addressPincodeState = { pincode, valid: false, state: "", city: "", message: "Enter a valid 6-digit Indian PIN code" };
    setFieldError(form, "pincode", "Enter a valid 6-digit Indian PIN code");
    updateAddressSubmitState(form);
    return false;
  }
}

function validateSelectedPincodeMatch(form) {
  if (!addressPincodeState.pincode || addressPincodeState.pincode.length !== 6 || !addressPincodeState.valid) return true;
  const selectedState = form.elements.state.value;
  const selectedCity = form.elements.city.value;
  if (selectedState && addressPincodeState.state && selectedState !== addressPincodeState.state) {
    setFieldError(form, "state", "PIN code does not match selected state");
    return false;
  }
  if (selectedCity && addressPincodeState.city && selectedCity.toLowerCase() !== addressPincodeState.city.toLowerCase()) {
    setFieldError(form, "city", "PIN code does not match selected city");
    return false;
  }
  clearFieldError(form, "state");
  clearFieldError(form, "city");
  return true;
}

async function getAddressFormPayload(form) {
  const data = Object.fromEntries(new FormData(form));
  const phone = normalizePhoneNumber(data.phone);
  const alternatePhone = data.alternatePhone ? normalizePhoneNumber(data.alternatePhone) : "";
  const pincode = String(data.pincode || "").replace(/\D/g, "");
  const states = await getIndiaAddressMeta();
  const validState = getExactOption(Object.keys(states), data.state);
  const validCity = getExactOption(states[validState] || [], data.city);
  clearAddressValidationErrors(form);
  if (!String(data.fullName || "").trim()) setFieldError(form, "fullName", "Full name is required");
  if (!phone) setFieldError(form, "phone", "Enter a valid phone number");
  if (alternatePhone === "" && data.alternatePhone) setFieldError(form, "alternatePhone", "Enter a valid alternate phone number");
  if (!/^\d{6}$/.test(pincode)) setFieldError(form, "pincode", "Enter a valid 6-digit Indian PIN code");
  if (!validState) setFieldError(form, "state", "Select a valid state");
  if (!validCity) setFieldError(form, "city", validState ? "Select a valid city" : "Select a valid state first");
  ["area", "houseNo"].forEach((field) => {
    if (!String(data[field] || "").trim()) setFieldError(form, field, `${field === "houseNo" ? "Flat / House / Building" : "Locality / Area / Street"} is required`);
  });
  if (!data.addressType || !["Home", "Work", "Other"].includes(data.addressType)) {
    setFieldError(form, "addressType", "Choose a valid address type");
  }
  if (form.querySelector(".invalid")) throw new Error("Please complete the highlighted address fields.");
  if (addressPincodeState.pincode !== pincode || !addressPincodeState.valid) {
    await validatePincodeWithServer(form, pincode);
  }
  if (!addressPincodeState.valid) {
    setFieldError(form, "pincode", addressPincodeState.message || "Enter a valid 6-digit Indian PIN code");
    throw new Error("Please complete the highlighted address fields.");
  }
  if (!validateSelectedPincodeMatch(form)) throw new Error("Please complete the highlighted address fields.");
  return {
    fullName: String(data.fullName).trim(),
    phone,
    alternatePhone,
    pincode,
    city: validCity,
    state: validState,
    area: String(data.area).trim(),
    houseNo: String(data.houseNo).trim(),
    landmark: String(data.landmark || "").trim(),
    addressType: String(data.addressType || "Home"),
    isDefault: Boolean(data.isDefault)
  };
}

function clearAddressValidationErrors(form) {
  ["fullName", "phone", "alternatePhone", "pincode", "state", "city", "area", "houseNo", "addressType"].forEach((field) => clearFieldError(form, field));
}

function updateAddressSubmitState(form) {
  const button = form.querySelector("button[type='submit']");
  if (!button || button.classList.contains("is-loading")) return;
  const state = form.elements.state?.value || "";
  const city = form.elements.city?.value || "";
  const stateOptions = Object.keys(indiaAddressMeta || {});
  const cityOptions = state && indiaAddressMeta ? indiaAddressMeta[state] || [] : [];
  const requiredReady = Boolean(
    String(form.elements.fullName?.value || "").trim()
    && normalizePhoneNumber(form.elements.phone?.value || "")
    && String(form.elements.houseNo?.value || "").trim()
    && String(form.elements.area?.value || "").trim()
    && getExactOption(stateOptions, state)
    && getExactOption(cityOptions, city)
    && /^\d{6}$/.test(String(form.elements.pincode?.value || ""))
    && addressPincodeState.pincode === String(form.elements.pincode?.value || "")
    && addressPincodeState.valid
    && form.elements.addressType?.value
  );
  button.disabled = !requiredReady || !validateSelectedPincodeMatch(form);
}

async function saveAddress(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  let payload;
  try {
    payload = await getAddressFormPayload(form);
  } catch (error) {
    notify(error.message, "error");
    return;
  }

  setButtonLoading(button, true, "Saving...");
  try {
    const id = form.dataset.addressId;
    await api(id ? `/api/addresses/${id}` : "/api/addresses", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    addressCache = null;
    notify("Address saved successfully.", "success");
    location.hash = "#/profile/addresses";
  } catch (error) {
    showAuthError(error, error.message || "Could not save address.");
  } finally {
    setButtonLoading(button, false);
  }
}

async function setDefaultAddress(id) {
  try {
    await api(`/api/addresses/${id}/default`, { method: "PATCH" });
    addressCache = null;
    notify("Default address updated.", "success");
    profilePage("addresses");
  } catch (error) {
    showAuthError(error, error.message || "Could not set default address.");
  }
}

async function deleteAddress(id) {
  if (!confirm("Delete this address?")) return;
  try {
    await api(`/api/addresses/${id}`, { method: "DELETE" });
    addressCache = null;
    notify("Address deleted.", "success");
    profilePage("addresses");
  } catch (error) {
    showAuthError(error, error.message || "Could not delete address.");
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form));
  const name = String(data.name || "").trim();
  const email = String(data.email || "").trim();
  const currentEmail = String(getSession()?.user?.email || "").trim();
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
    if (email !== currentEmail) updatePayload.email = email;
    const { data: updated, error } = await client.auth.updateUser(updatePayload);
    if (error) {
      console.error(error);
      throw new Error(authErrorMessage(error, error.message || "Could not update profile."));
    }

    if (email !== currentEmail) {
      emailAuthState.email = email;
      emailAuthState.flow = "email_change";
      emailAuthState.profileData = { name, email, mobile, profile_image: profileImage };
      emailAuthState.pendingEmailChange = { name, email, mobile, profile_image: profileImage };
      emailAuthState.otpExpiresAt = Date.now() + EMAIL_OTP_EXPIRY_MS;
      emailAuthState.verifyAttempts = 0;
      const cooldownKey = `${OTP_COOLDOWN_KEY}:email_change:${email.toLowerCase()}`;
      startEmailAuthCooldown(cooldownKey);
      const panel = document.getElementById("profileEmailOtpPanel");
      if (panel) panel.hidden = false;
      resetEmailOtpInputs();
      notify("Verification OTP sent to your new email.", "success");
      return;
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
    cartCache = null;
    renderCounters();
    notify("Logged out from all devices.", "success");
    location.hash = "#/";
  } catch (error) {
    showAuthError(error, error.message || "Could not logout from all devices.");
  }
}

function settingsPage() {
  app.innerHTML = `
    <section class="profile-shell narrow settings-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile" aria-label="Back to account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>Settings</h1>
        <span aria-hidden="true"></span>
      </div>

      <section class="appearance-panel">
        <div>
          <p class="eyebrow">Appearance</p>
          <h2>Theme</h2>
          <p>Choose the Urban Kicks experience that matches your shopping style. Your preference stays saved after refresh.</p>
        </div>
        <div class="theme-card-grid" role="group" aria-label="Theme selector">
          ${themeCardMarkup("dark", "Black + Red", "Dark luxury sneaker mode")}
          ${themeCardMarkup("light", "White + Black", "Minimal ecommerce mode")}
        </div>
      </section>

      <div class="settings-list">
        <article class="settings-row"><span>${accountIcon("Settings")}</span><div><h3>App Preferences</h3><p>Mobile-first shopping, saved cart, theme, and smooth checkout defaults.</p></div></article>
        <article class="settings-row"><span>${accountIcon("Notifications")}</span><div><h3>Notification Preferences</h3><p>Drop, sale, restock, and order alerts without spam.</p>${notificationPreferencesMarkup()}</div></article>
        <a class="settings-row settings-link-row" href="#/profile/settings/privacy">
          <span>${accountIcon("Privacy & Data")}</span>
          <div><h3>Privacy & Data</h3><p>Review privacy policy, data use, saved account data, and deletion options.</p></div>
          <i class="settings-chevron" aria-hidden="true">&gt;</i>
        </a>
        <article class="settings-row"><span>${accountIcon("Security")}</span><div><h3>Account Protection</h3><p>Email OTP verification, password recovery, and logout controls.</p><a class="text-button" href="#/profile/security">Manage security</a></div></article>
      </div>
    </section>
  `;
  updateThemeCards();
  setupNotificationPreferenceControls();
}

function privacyDataPage(tab = "privacy") {
  const isDataTab = tab === "data";
  const policySections = [
    ["Information We Collect", "We collect basic account details like name, email, phone number, delivery address, order details, wishlist, cart activity and payment preference."],
    ["How We Use Your Information", "We use your data to manage your account, process orders, deliver products, improve shopping experience, send order updates and provide customer support."],
    ["Delivery & Address Data", "Your address is used only for order delivery, Cash on Delivery verification and customer support."],
    ["Notifications", "We may send order updates, restock alerts, sneaker drop alerts and promotional updates only when allowed by the user."],
    ["Payments", "Urban Kicks currently supports Cash on Delivery. Online payment details will not be stored unless payment features are added later."],
    ["Data Safety", "We do not sell your personal data. Your information is used only for Urban Kicks shopping, delivery and support purposes."],
    ["Account Control", "Users can update profile details, manage addresses, control notifications and request account deletion."]
  ];
  const dataCategories = ["Profile information", "Saved addresses", "Orders", "Wishlist", "Cart", "Notification preferences"];

  app.innerHTML = `
    <section class="profile-shell narrow privacy-data-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile/settings" aria-label="Back to settings">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>Privacy & Data</h1>
        <span aria-hidden="true"></span>
      </div>

      <div class="privacy-tabs" role="tablist" aria-label="Privacy and data sections">
        <a class="${isDataTab ? "" : "active"}" href="#/profile/settings/privacy" role="tab" aria-selected="${!isDataTab}">Privacy Policy</a>
        <a class="${isDataTab ? "active" : ""}" href="#/profile/settings/data" role="tab" aria-selected="${isDataTab}">Your Data</a>
      </div>

      <section class="privacy-card ${isDataTab ? "data-view" : "policy-view"}">
        ${isDataTab ? `
          <div class="privacy-copy-block">
            <p class="eyebrow">Your Data</p>
            <h2>Your Data</h2>
            <p>Urban Kicks respects your privacy. Your personal data is used only to provide shopping, delivery, order updates and customer support. We do not sell your data to third parties.</p>
          </div>
          <div class="data-category-grid">
            ${dataCategories.map((category) => `<article><span>${accountIcon(category === "Profile information" ? "Settings" : category === "Saved addresses" ? "Addresses" : category === "Notification preferences" ? "Notifications" : category)}</span><strong>${safe(category)}</strong></article>`).join("")}
          </div>
          <a class="button privacy-delete-button" href="#/profile/settings/delete-account">Delete Account</a>
        ` : `
          <div class="privacy-policy-list">
            ${policySections.map(([title, copy]) => `
              <article>
                <span>${accountIcon("Privacy & Data")}</span>
                <div>
                  <h2>${safe(title)}</h2>
                  <p>${safe(copy)}</p>
                </div>
              </article>
            `).join("")}
          </div>
        `}
      </section>
    </section>
  `;
}

function deleteAccountComingSoonPage() {
  app.innerHTML = `
    <section class="profile-shell narrow privacy-data-shell">
      <div class="edit-profile-topbar">
        <a class="edit-back-button" href="#/profile/settings/data" aria-label="Back to Privacy & Data">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5.4 9 12l6.6 6.6-1.4 1.4L6.2 12l8-8 1.4 1.4Z"/></svg>
        </a>
        <h1>Delete Account</h1>
        <span aria-hidden="true"></span>
      </div>
      <div class="premium-empty delete-account-card">
        <p class="eyebrow">Coming Soon</p>
        <h2>Delete Account</h2>
        <p>Account deletion is coming soon. You will soon be able to request permanent deletion of your Urban Kicks account and personal data.</p>
        <a class="button primary" href="#/profile/settings/data">Back to Privacy & Data</a>
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
      title: "Premium sneaker culture for India",
      copy: "Urban Kicks India is a premium sneaker and streetwear platform built for modern sneaker culture in India.",
      detail: "We focus on curated sneaker drops, stylish everyday footwear, and premium streetwear experiences for sneaker lovers.\n\nFrom classic silhouettes to modern hype releases, Urban Kicks India delivers fashion-forward collections designed for comfort, movement, and style.\n\nOur mission is to bring premium sneaker culture closer to the Indian audience with smooth shopping, secure checkout, and a modern mobile-first experience."
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
      <div class="about-card">${safe(page.detail).split("\n\n").map((paragraph) => `<p>${paragraph}</p>`).join("")}</div>
    </section>
  `;
}

function emptyPage(title, copy) {
  app.innerHTML = `<div class="empty-state"><h1>${safe(title)}</h1><p class="meta">${safe(copy)}</p><a class="button primary" href="#/">Back home</a></div>`;
}

function swapImage(image) {
  document.getElementById("mainProductImage").src = image;
}

function getCurrentTheme() {
  return document.body.classList.contains("light-mode") ? "light" : "dark";
}

function updateThemeCards() {
  const currentTheme = getCurrentTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((card) => {
    const active = card.dataset.themeChoice === currentTheme;
    card.classList.toggle("active", active);
    card.setAttribute("aria-pressed", String(active));
  });
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("light-mode", nextTheme === "light");
  localStorage.setItem(THEME_KEY, nextTheme);
  updateThemeCards();
  notify(`${nextTheme === "light" ? "White + Black" : "Black + Red"} theme applied.`, "success");
}

function toggleTheme() {
  setTheme(getCurrentTheme() === "light" ? "dark" : "light");
}

async function router() {
  await renderCounters();
  closeNav();
  const routeKey = location.hash || "#/";
  const shouldResetScroll = routeKey !== lastRouteKey;
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
    if (parts[0] === "profile") return profilePage(parts[1] || "overview", parts[2] || "", parts[3] || "");
    if (parts[0] === "settings") return settingsPage();
    if (parts[0] === "help") return supportPage();
    if (parts[0] === "admin") return adminPage();
    if (["about", "terms", "privacy"].includes(parts[0])) return infoPage(parts[0].replace(/^\w/, (c) => c.toUpperCase()));
    return homePage();
  } catch (error) {
    emptyPage("Something went wrong", error.message);
  } finally {
    if (shouldResetScroll) {
      lastRouteKey = routeKey;
      window.requestAnimationFrame(() => window.scrollTo(0, 0));
    }
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
window.setTheme = setTheme;
window.logout = logout;
window.logoutAllDevices = logoutAllDevices;
window.notify = notify;
window.editProduct = editProduct;
window.resetAdminForm = resetAdminForm;
window.deleteProduct = deleteProduct;
window.updateOrderStatus = updateOrderStatus;
window.setDefaultAddress = setDefaultAddress;
window.deleteAddress = deleteAddress;
window.selectCheckoutAddress = selectCheckoutAddress;

navToggle?.addEventListener("click", () => document.querySelector(".nav-links")?.classList.toggle("open"));
window.addEventListener("hashchange", router);
window.addEventListener("pageshow", () => window.scrollTo(0, 0));
window.addEventListener("urban-kicks-auth", (event) => {
  console.log(`[auth] state changed: ${event.detail.event}`);
  updateMobileAccountLink();
});

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem(THEME_KEY) === "light") document.body.classList.add("light-mode");
  setupSplashScreen();
  updateThemeCards();
  setupHeaderSearch();
  setupMobileBottomNav();
  maybeShowNotificationPrompt();
  updateMobileAccountLink();
  setupAuthStateListener().catch((error) => console.error("[auth] listener setup failed", error));
  verifySession();
  router();
});
