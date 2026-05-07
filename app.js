const express = require("express");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env.local") });
require("dotenv").config();

const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const authRoutes = require("./routes/auth");
const wishlistRoutes = require("./routes/wishlist");
const transactionRoutes = require("./routes/transactions");
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

app.get("/api/config/supabase", (_req, res) => {
  res.json({
    url: supabaseUrl,
    anonKey: supabaseAnonKey
  });
});

app.get("/api/config/payment", (_req, res) => {
  res.json({
    cod: { enabled: true, label: "Cash on Delivery" },
    note: "Cash on Delivery is the only enabled payment option."
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    app: "Urban Kicks",
    database: "supabase",
    auth: "supabase",
    integrations: ["Supabase Auth", "Supabase Database", "Cash on Delivery"]
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
