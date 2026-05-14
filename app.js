const express = require("express");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env.local") });
require("dotenv").config();

const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const authRoutes = require("./routes/auth");
const wishlistRoutes = require("./routes/wishlist");
const transactionRoutes = require("./routes/transactions");
const addressRoutes = require("./routes/addresses");
const { supabaseUrl, supabaseAnonKey } = require("./lib/supabase");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/addresses", addressRoutes);

app.get("/api/config/supabase", (_req, res) => {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({
        message: "Authentication is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel."
      });
    }

    res.json({
      url: supabaseUrl,
      anonKey: supabaseAnonKey
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not load authentication settings",
      error: error.message
    });
  }
});

app.get("/api/config/payment", (_req, res) => {
  res.json({
    cod: { enabled: true, label: "Cash on Delivery" },
    upi: { enabled: false, label: "UPI Payment", status: "Coming soon" },
    note: "Cash on Delivery is live. UPI/Razorpay is prepared in the UI but disabled until integration."
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    app: "Urban Kicks",
    status: "ok"
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    message: "API route not found",
    path: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(error);
  console.error("[api] unhandled error:", error.message);
  res.status(error.status || 500).json({
    message: "Server error",
    error: error.message
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Urban Kicks running at http://localhost:${PORT}`);
  });
}

module.exports = app;
