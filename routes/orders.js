const express = require("express");
const { request, rest, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");
const { toProduct, toOrder } = require("../lib/mappers");

const router = express.Router();

async function currentUser(req) {
  const token = getBearerToken(req);
  const user = await getAuthUser(token).catch(() => null);
  return { token, user };
}

router.get("/", async (req, res) => {
  try {
    const { token, user } = await currentUser(req);
    const query = user
      ? `select=*&user_id=eq.${user.id}&order=created_at.desc`
      : "select=*&order=created_at.desc";
    const rows = await request(rest("orders", query), { token });
    res.json(rows.map(toOrder));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch orders", error: error.message });
  }
});

router.get("/mine", async (req, res) => {
  try {
    const { token, user } = await currentUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });
    const rows = await request(rest("orders", `select=*&user_id=eq.${user.id}&order=created_at.desc`), { token });
    res.json(rows.map(toOrder));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch order history", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { token, user } = await currentUser(req);
    const { customer, items } = req.body;
    const requestedPaymentMethod = String(req.body.paymentMethod || customer?.payment_method || customer?.paymentMethod || "cod").toLowerCase();
    if (!items || !items.length) return res.status(400).json({ message: "Cart is empty" });
    if (!["cod", "cash on delivery"].includes(requestedPaymentMethod)) {
      return res.status(400).json({ message: "UPI payments are coming soon. Please use Cash on Delivery for now." });
    }

    const ids = items.map((item) => item.productId);
    const products = await request(rest("products", `select=*&id=in.(${ids.join(",")})`), { token });
    const productMap = new Map(products.map((row) => [row.id, toProduct(row)]));

    const orderItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new Error("A product in your cart no longer exists.");
      if (product.stock < Number(item.quantity)) throw new Error(`${product.name} does not have enough stock.`);
      return {
        productId: product.id,
        name: product.name,
        brand: product.brand,
        price: Number(item.price || product.price),
        imageUrl: product.imageUrl,
        size: item.size,
        color: item.color || product.color || "",
        quantity: Number(item.quantity)
      };
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = subtotal > 20000 ? 0 : 149;
    const orderRows = await request("/rest/v1/orders", {
      method: "POST",
      token,
      headers: preferReturn(),
      body: {
        user_id: user?.id || null,
        customer,
        items: orderItems,
        subtotal,
        shipping,
        total: subtotal + shipping,
        payment_method: "Cash on Delivery",
        payment_reference: "",
        status: "Pending"
      }
    });

    const order = orderRows[0];
    await request("/rest/v1/transactions", {
      method: "POST",
      token,
      headers: preferReturn(),
      body: {
        order_id: order.id,
        user_id: user?.id || null,
        amount: order.total,
        payment_method: "Cash on Delivery",
        status: "pending",
        reference: `COD-${order.id}`
      }
    }).catch(() => null);

    await Promise.all(orderItems.map((item) => {
      const product = productMap.get(item.productId);
      return request(`/rest/v1/products?id=eq.${item.productId}`, {
        method: "PATCH",
        token,
        headers: preferReturn(),
        body: { stock: Math.max(0, product.stock - item.quantity) }
      }).catch(() => null);
    }));

    res.status(201).json(toOrder(order));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const rows = await request(`/rest/v1/orders?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: "PATCH",
      headers: preferReturn(),
      body: { status: req.body.status }
    });
    if (!rows.length) return res.status(404).json({ message: "Order not found" });
    res.json(toOrder(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not update order", error: error.message });
  }
});

module.exports = router;
