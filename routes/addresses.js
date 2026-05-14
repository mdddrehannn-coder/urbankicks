const express = require("express");
const { request, rest, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");

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

function normalizeAddress(row) {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name || "",
    phone: row.phone || "",
    alternatePhone: row.alternate_phone || "",
    pincode: row.pincode || "",
    state: row.state || "",
    city: row.city || "",
    area: row.area || "",
    houseNo: row.house_no || "",
    landmark: row.landmark || "",
    addressType: row.address_type || "Home",
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function addressPayload(body, userId) {
  return {
    user_id: userId,
    full_name: String(body.fullName || body.full_name || "").trim(),
    phone: String(body.phone || "").trim(),
    alternate_phone: String(body.alternatePhone || body.alternate_phone || "").trim(),
    pincode: String(body.pincode || "").trim(),
    state: String(body.state || "").trim(),
    city: String(body.city || "").trim(),
    area: String(body.area || "").trim(),
    house_no: String(body.houseNo || body.house_no || "").trim(),
    landmark: String(body.landmark || "").trim(),
    address_type: String(body.addressType || body.address_type || "Home").trim(),
    is_default: Boolean(body.isDefault ?? body.is_default)
  };
}

function validateAddress(payload) {
  if (!payload.full_name) return "Full name is required";
  if (!/^\+?\d{10,15}$/.test(payload.phone.replace(/[^\d+]/g, ""))) return "Enter a valid phone number";
  if (!/^\d{6}$/.test(payload.pincode)) return "Enter a valid 6-digit pincode";
  if (!payload.city) return "City is required";
  if (!payload.state) return "State is required";
  if (!payload.area) return "Locality / Area / Street is required";
  if (!payload.house_no) return "Flat / House / Building is required";
  if (!["Home", "Work", "Other"].includes(payload.address_type)) return "Choose a valid address type";
  return "";
}

function isMissingAddressTable(error) {
  const lower = String(error?.message || "").toLowerCase();
  return lower.includes("addresses") && (lower.includes("schema cache") || lower.includes("could not find") || lower.includes("does not exist"));
}

function addressSetupResponse(res) {
  return res.status(503).json({
    message: "Address book is being prepared. Please try again soon."
  });
}

async function clearDefaultAddress(token, userId, exceptId = "") {
  const filter = exceptId
    ? `user_id=eq.${userId}&is_default=eq.true&id=neq.${encodeURIComponent(exceptId)}`
    : `user_id=eq.${userId}&is_default=eq.true`;
  await request(`/rest/v1/addresses?${filter}`, {
    method: "PATCH",
    token,
    body: { is_default: false, updated_at: new Date().toISOString() }
  });
}

router.get("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const rows = await request(rest("addresses", `select=*&user_id=eq.${auth.user.id}&order=is_default.desc,created_at.desc`), { token: auth.token });
    res.json(rows.map(normalizeAddress));
  } catch (error) {
    if (isMissingAddressTable(error)) {
      console.warn("[addresses] table missing in Supabase. Apply supabase/addresses.sql.");
      return res.json([]);
    }
    res.status(500).json({ message: "Could not fetch addresses", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const payload = addressPayload(req.body, auth.user.id);
    const validationError = validateAddress(payload);
    if (validationError) return res.status(400).json({ message: validationError });

    const existing = await request(rest("addresses", `select=id&user_id=eq.${auth.user.id}&limit=1`), { token: auth.token });
    if (payload.is_default || !existing.length) {
      payload.is_default = true;
      await clearDefaultAddress(auth.token, auth.user.id);
    }

    const rows = await request("/rest/v1/addresses", {
      method: "POST",
      token: auth.token,
      headers: preferReturn(),
      body: payload
    });
    res.status(201).json(normalizeAddress(rows[0]));
  } catch (error) {
    if (isMissingAddressTable(error)) return addressSetupResponse(res);
    res.status(400).json({ message: "Could not save address", error: error.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const payload = addressPayload(req.body, auth.user.id);
    const validationError = validateAddress(payload);
    if (validationError) return res.status(400).json({ message: validationError });

    if (payload.is_default) await clearDefaultAddress(auth.token, auth.user.id, req.params.id);
    delete payload.user_id;
    payload.updated_at = new Date().toISOString();

    const rows = await request(`/rest/v1/addresses?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      token: auth.token,
      headers: preferReturn(),
      body: payload
    });
    if (!rows.length) return res.status(404).json({ message: "Address not found" });
    res.json(normalizeAddress(rows[0]));
  } catch (error) {
    if (isMissingAddressTable(error)) return addressSetupResponse(res);
    res.status(400).json({ message: "Could not update address", error: error.message });
  }
});

router.patch("/:id/default", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    await clearDefaultAddress(auth.token, auth.user.id, req.params.id);
    const rows = await request(`/rest/v1/addresses?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      token: auth.token,
      headers: preferReturn(),
      body: { is_default: true, updated_at: new Date().toISOString() }
    });
    if (!rows.length) return res.status(404).json({ message: "Address not found" });
    res.json(normalizeAddress(rows[0]));
  } catch (error) {
    if (isMissingAddressTable(error)) return addressSetupResponse(res);
    res.status(400).json({ message: "Could not set default address", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    await request(`/rest/v1/addresses?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${auth.user.id}`, {
      method: "DELETE",
      token: auth.token
    });
    res.json({ message: "Address deleted" });
  } catch (error) {
    if (isMissingAddressTable(error)) return addressSetupResponse(res);
    res.status(400).json({ message: "Could not delete address", error: error.message });
  }
});

module.exports = router;
