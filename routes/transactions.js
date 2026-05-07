const express = require("express");
const { request, rest, getBearerToken, getAuthUser } = require("../lib/supabase");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token);
    if (!user) return res.status(401).json({ message: "Login required" });
    const rows = await request(rest("transactions", `select=*&user_id=eq.${user.id}&order=created_at.desc`), { token });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not fetch transactions", error: error.message });
  }
});

module.exports = router;
