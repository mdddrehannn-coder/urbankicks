const express = require("express");
const { request, rest, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");
const { toProduct, toOrder } = require("../lib/mappers");

const router = express.Router();

async function currentUser(req) {
  const token = getBearerToken(req);
  const user = await getAuthUser(token).catch(() => null);
  return { token, user };
}

function normalizeAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name || "",
    phone: row.phone || "",
    state: row.state || "",
    city: row.city || "",
    pincode: row.pincode || "",
    locality: row.locality || row.area || "",
    addressLine: row.address_line || row.house_no || "",
    landmark: row.landmark || ""
  };
}

function normalizeCartItem(row) {
  return {
    productId: row.product_id,
    name: row.product_name,
    brand: row.brand || "Urban Kicks",
    size: row.size || "",
    color: row.color || "",
    quantity: Number(row.quantity || 1),
    price: Number(row.price || 0),
    imageUrl: row.image_url || ""
  };
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
    if (!user) return res.status(401).json({ message: "Login required" });
    const requestedPaymentMethod = String(req.body.paymentMethod || req.body.payment_method || "cod").toLowerCase();
    if (!["cod", "cash on delivery"].includes(requestedPaymentMethod)) {
      return res.status(400).json({ message: "UPI payments are coming soon. Please use Cash on Delivery for now." });
    }

    const addressId = String(req.body.addressId || req.body.address_id || req.body.customer?.address_id || "").trim();
    if (!addressId) return res.status(400).json({ message: "Select a saved delivery address" });

    const addressRows = await request(rest("addresses", `select=*&id=eq.${encodeURIComponent(addressId)}&user_id=eq.${user.id}&limit=1`), { token });
    const address = normalizeAddress(addressRows[0]);
    if (!address) return res.status(400).json({ message: "Selected address was not found" });

    const cartRows = await request(rest("cart_items", `select=*&user_id=eq.${user.id}&order=created_at.asc`), { token });
    if (!cartRows.length) return res.status(400).json({ message: "Cart is empty" });
    const orderItems = cartRows.map(normalizeCartItem);
    const ids = orderItems.map((item) => item.productId);
    const products = await request(rest("products", `select=*&id=in.(${ids.join(",")})`), { token });
    const productMap = new Map(products.map((row) => [row.id, toProduct(row)]));

    orderItems.forEach((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new Error("A product in your cart no longer exists.");
      if (product.stock < Number(item.quantity)) throw new Error(`${product.name} does not have enough stock.`);
    });

    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = subtotal > 20000 ? 0 : 149;
    const total = subtotal + shipping;
    const customer = {
      address_id: address.id,
      name: address.fullName,
      email: user.email || "",
      phone: address.phone,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      address: [address.addressLine, address.locality, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(", "),
      paymentMethod: "cod"
    };
    const orderRows = await request("/rest/v1/orders", {
      method: "POST",
      token,
      headers: preferReturn(),
      body: {
        user_id: user.id,
        address_id: address.id,
        customer,
        items: orderItems,
        subtotal,
        shipping,
        total,
        total_amount: total,
        payment_method: "Cash on Delivery",
        payment_status: "pending",
        order_status: "placed",
        payment_reference: "",
        status: "Pending"
      }
    });

    const order = orderRows[0];
    await request("/rest/v1/order_items", {
      method: "POST",
      token,
      headers: preferReturn(),
      body: orderItems.map((item) => ({
        order_id: order.id,
        product_id: item.productId,
        product_name: item.name,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        price: item.price,
        image_url: item.imageUrl
      }))
    });

    await request("/rest/v1/transactions", {
      method: "POST",
      token,
      headers: preferReturn(),
      body: {
        order_id: order.id,
        user_id: user.id,
        amount: total,
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

    await request(`/rest/v1/cart_items?user_id=eq.${user.id}`, {
      method: "DELETE",
      token
    });

    res.status(201).json(toOrder(order));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const nextStatus = req.body.status;
    const orderStatus = String(nextStatus || "").toLowerCase();
    const rows = await request(`/rest/v1/orders?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: "PATCH",
      headers: preferReturn(),
      body: { status: nextStatus, order_status: orderStatus || "placed" }
    });
    if (!rows.length) return res.status(404).json({ message: "Order not found" });
    res.json(toOrder(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not update order", error: error.message });
  }
});

module.exports = router;
