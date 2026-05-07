const express = require("express");
const upload = require("../middleware/upload");
const { request, rest, preferReturn } = require("../lib/supabase");
const { toProduct, toProductRow, parseList } = require("../lib/mappers");

const router = express.Router();

function productPayload(body, file) {
  const image = file ? `/uploads/${file.filename}` : body.image || body.imageUrl;
  return toProductRow({
    ...body,
    image,
    imageUrl: image,
    sizes: parseList(body.sizes || "39, 40, 41, 42"),
    colors: parseList(body.colors || body.color),
    gallery: parseList(body.gallery || image),
    featured: body.featured === "true" || body.featured === true,
    trending: body.trending === "true" || body.trending === true
  });
}

router.get("/brands", async (_req, res) => {
  try {
    const rows = await request(rest("products", "select=brand&order=brand.asc"));
    res.json([...new Set(rows.map((row) => row.brand))]);
  } catch (error) {
    res.status(500).json({ message: "Could not fetch brands", error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const query = new URLSearchParams({ select: "*", order: "featured.desc,created_at.desc" });
    if (req.query.brand) query.set("brand", `ilike.${req.query.brand}`);
    if (req.query.category) query.set("category", `ilike.%${req.query.category}%`);
    if (req.query.q) {
      const q = String(req.query.q).replace(/[(),]/g, " ");
      query.set("or", `(name.ilike.%${q}%,brand.ilike.%${q}%,category.ilike.%${q}%,description.ilike.%${q}%)`);
    }
    const rows = await request(rest("products", query.toString()));
    res.json(rows.map(toProduct));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch products", error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await request(rest("products", `select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`));
    if (!rows.length) return res.status(404).json({ message: "Product not found" });
    res.json(toProduct(rows[0]));
  } catch (error) {
    res.status(500).json({ message: "Could not fetch product", error: error.message });
  }
});

router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file && !req.body.image && !req.body.imageUrl) {
      return res.status(400).json({ message: "Product image is required" });
    }
    const rows = await request("/rest/v1/products", {
      method: "POST",
      headers: preferReturn(),
      body: productPayload(req.body, req.file)
    });
    res.status(201).json(toProduct(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not create product", error: error.message });
  }
});

router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const payload = productPayload(req.body, req.file);
    if (!payload.image) {
      delete payload.image;
      delete payload.image_url;
    }
    const rows = await request(`/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: "PATCH",
      headers: preferReturn(),
      body: payload
    });
    if (!rows.length) return res.status(404).json({ message: "Product not found" });
    res.json(toProduct(rows[0]));
  } catch (error) {
    res.status(400).json({ message: "Could not update product", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const rows = await request(`/rest/v1/products?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: "DELETE",
      headers: preferReturn()
    });
    if (!rows.length) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(400).json({ message: "Could not delete product", error: error.message });
  }
});

module.exports = router;
