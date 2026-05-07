const express = require("express");
const { request, rest, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");

const router = express.Router();

async function requireUser(req, res) {
  const token = getBearerToken(req);
  const user = await getAuthUser(token);
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return null;
  }
  return { token, user };
}

router.get("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const rows = await request(rest("wishlist", `select=product_id&user_id=eq.${auth.user.id}`), { token: auth.token });
    res.json(rows.map((row) => row.product_id));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch wishlist", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const rows = await request("/rest/v1/wishlist", {
      method: "POST",
      token: auth.token,
      headers: { ...preferReturn(), Prefer: "resolution=ignore-duplicates,return=representation" },
      body: { user_id: auth.user.id, product_id: req.body.productId }
    });
    res.status(201).json(rows[0] || { product_id: req.body.productId });
  } catch (error) {
    res.status(400).json({ message: "Could not save wishlist item", error: error.message });
  }
});

router.delete("/:productId", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    await request(`/rest/v1/wishlist?user_id=eq.${auth.user.id}&product_id=eq.${encodeURIComponent(req.params.productId)}`, {
      method: "DELETE",
      token: auth.token
    });
    res.json({ message: "Wishlist item removed" });
  } catch (error) {
    res.status(400).json({ message: "Could not remove wishlist item", error: error.message });
  }
});

module.exports = router;
