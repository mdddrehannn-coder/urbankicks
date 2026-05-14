const express = require("express");
const { request, rest, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");
const { toProduct } = require("../lib/mappers");

const router = express.Router();

async function requireUser(req, res) {
  const token = getBearerToken(req);
  const user = await getAuthUser(token).catch(() => null);
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return null;
  }
  return { token, user };
}

function salePrice(product) {
  return Math.round(Number(product.price || 0) * (1 - Number(product.discountPercent || 0) / 100));
}

function normalizeCartItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.product_name,
    brand: row.brand || "Urban Kicks",
    price: Number(row.price || 0),
    originalPrice: Number(row.original_price || row.price || 0),
    imageUrl: row.image_url || "",
    size: row.size || "",
    color: row.color || "",
    quantity: Number(row.quantity || 1),
    createdAt: row.created_at || ""
  };
}

async function getProduct(token, productId) {
  const rows = await request(rest("products", `select=*&id=eq.${encodeURIComponent(productId)}&limit=1`), { token });
  return toProduct(rows[0]);
}

async function readUserCart(token, userId) {
  const rows = await request(rest("cart_items", `select=*&user_id=eq.${userId}&order=created_at.asc`), { token });
  return rows.map(normalizeCartItem);
}

function cleanText(value) {
  return String(value || "").trim();
}

router.get("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    res.json(await readUserCart(auth.token, auth.user.id));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch cart", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const productId = cleanText(req.body.productId || req.body.product_id);
    const size = cleanText(req.body.size);
    const color = cleanText(req.body.color);
    const quantity = Math.max(1, Number(req.body.quantity || 1));
    if (!productId) return res.status(400).json({ message: "Product is required" });

    const product = await getProduct(auth.token, productId);
    if (!product || product.stock < 1) return res.status(400).json({ message: "This sneaker is currently out of stock." });

    const existing = await request(rest("cart_items", `select=*&user_id=eq.${auth.user.id}&product_id=eq.${encodeURIComponent(productId)}&size=eq.${encodeURIComponent(size)}&color=eq.${encodeURIComponent(color)}&limit=1`), { token: auth.token });
    if (existing.length) {
      const nextQuantity = Math.min(Number(existing[0].quantity || 1) + quantity, product.stock);
      const rows = await request(`/rest/v1/cart_items?id=eq.${existing[0].id}&user_id=eq.${auth.user.id}`, {
        method: "PATCH",
        token: auth.token,
        headers: preferReturn(),
        body: { quantity: nextQuantity }
      });
      return res.json(normalizeCartItem(rows[0]));
    }

    const rows = await request("/rest/v1/cart_items", {
      method: "POST",
      token: auth.token,
      headers: preferReturn(),
      body: {
        user_id: auth.user.id,
        product_id: product.id,
        product_name: product.name,
        brand: product.brand,
        size,
        color,
        quantity: Math.min(quantity, product.stock),
        price: salePrice(product),
        original_price: Number(product.price || 0),
        image_url: product.imageUrl
      }
    });
    res.status(201).json(normalizeCartItem(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not save cart item", error: error.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const quantity = Math.max(1, Number(req.body.quantity || 1));
    const rows = await request(`/rest/v1/cart_items?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      token: auth.token,
      headers: preferReturn(),
      body: { quantity }
    });
    if (!rows.length) return res.status(404).json({ message: "Cart item not found" });
    res.json(normalizeCartItem(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not update cart item", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    await request(`/rest/v1/cart_items?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${auth.user.id}`, {
      method: "DELETE",
      token: auth.token
    });
    res.json({ message: "Cart item removed" });
  } catch (error) {
    res.status(400).json({ message: "Could not remove cart item", error: error.message });
  }
});

router.delete("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    await request(`/rest/v1/cart_items?user_id=eq.${auth.user.id}`, {
      method: "DELETE",
      token: auth.token
    });
    res.json({ message: "Cart cleared" });
  } catch (error) {
    res.status(400).json({ message: "Could not clear cart", error: error.message });
  }
});

module.exports = router;
