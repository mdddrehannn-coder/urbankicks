const express = require("express");
const { request, getBearerToken, getAuthUser, preferReturn } = require("../lib/supabase");

const router = express.Router();

router.get("/status", (_req, res) => {
  res.json({
    status: "ok"
  });
});

function profilePayload(user, body = {}) {
  const fullName = body.full_name || body.name || user.user_metadata?.full_name || user.user_metadata?.name || "Urban Kicks Member";
  const phoneNumber = body.phone_number || body.mobile || user.phone || user.user_metadata?.phone_number || user.user_metadata?.mobile || "";
  const profileImage = body.profile_image || user.user_metadata?.profile_image || "";

  return {
    id: user.id,
    name: fullName,
    full_name: fullName,
    email: user.email || body.email || "",
    mobile: phoneNumber,
    phone_number: phoneNumber,
    profile_image: profileImage,
    role: "customer"
  };
}

function legacyProfilePayload(user, body = {}) {
  const payload = profilePayload(user, body);
  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    mobile: payload.mobile,
    role: payload.role
  };
}

function publicProfilePayload(user, body = {}) {
  const payload = profilePayload(user, body);
  return {
    id: payload.id,
    full_name: payload.full_name,
    email: payload.email,
    phone: payload.phone_number
  };
}

async function syncPublicProfile(token, user, body = {}) {
  return request("/rest/v1/profiles", {
    method: "POST",
    token,
    headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: publicProfilePayload(user, body)
  }).catch((error) => {
    console.warn("[auth] profiles sync skipped:", error.message);
    return [];
  });
}

async function signupHandler(req, res) {
  res.status(410).json({
    message: "Direct API account creation is disabled. Urban Kicks uses browser Supabase signup with email OTP verification."
  });
}

router.post("/signup", signupHandler);

router.post("/login", async (req, res) => {
  res.status(410).json({
    message: "Direct API login is disabled. Urban Kicks uses browser Supabase email and password login."
  });
});

router.post("/refresh", async (req, res) => {
  try {
    if (!req.body.refresh_token) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const result = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: req.body.refresh_token }
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    console.error("[auth] refresh failed:", error.message);
    res.status(401).json({ message: error.message, error: error.message });
  }
});

router.post("/profile", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token);
    if (!user) return res.status(401).json({ message: "Login required" });

    let rows;
    try {
      rows = await request("/rest/v1/users", {
        method: "POST",
        token,
        headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: profilePayload(user, req.body)
      });
    } catch (profileError) {
      console.error(profileError);
      console.warn("[auth] profile sync falling back to legacy columns:", profileError.message);
      rows = await request("/rest/v1/users", {
        method: "POST",
        token,
        headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: legacyProfilePayload(user, req.body)
      });
    }
    await syncPublicProfile(token, user, req.body);

    console.log(`[auth] profile synced for ${user.email || user.id}`);
    res.status(201).json(rows[0] || profilePayload(user, req.body));
  } catch (error) {
    console.error(error);
    console.error("[auth] profile sync failed:", error.message);
    res.status(400).json({ message: error.message, error: error.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (token) {
      await request("/auth/v1/logout", { method: "POST", token });
    }
    console.log("[auth] logout success");
    res.json({ message: "Logged out" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message, error: error.message });
  }
});

router.get("/me", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token);
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const publicProfiles = await request(`/rest/v1/profiles?select=*&id=eq.${user.id}&limit=1`, { token }).catch((profileError) => {
      console.warn("[auth] profiles read skipped:", profileError.message);
      return [];
    });
    const profiles = publicProfiles.length ? publicProfiles : await request(`/rest/v1/users?select=*&id=eq.${user.id}&limit=1`, { token }).catch((profileError) => {
      console.error(profileError);
      console.warn("[auth] profile read skipped:", profileError.message);
      return [];
    });
    res.json({ user, profile: profiles[0] || null });
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: error.message, error: error.message });
  }
});

router.post("/register", signupHandler);

module.exports = router;
