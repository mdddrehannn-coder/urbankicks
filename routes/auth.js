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

async function signupHandler(req, res) {
  try {
    if (!req.body.email || !req.body.password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    console.log(`[auth] signup attempt for ${req.body.email}`);
    const result = await request("/auth/v1/signup", {
      method: "POST",
      body: {
        email: req.body.email,
        password: req.body.password,
        data: {
          name: req.body.name || req.body.full_name,
          full_name: req.body.full_name || req.body.name,
          mobile: req.body.mobile || req.body.phone_number,
          phone_number: req.body.phone_number || req.body.mobile
        }
      }
    });

    if (result.user && result.access_token) {
      await request("/rest/v1/users", {
        method: "POST",
        headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
        token: result.access_token,
        body: profilePayload(result.user, req.body)
      }).catch((profileError) => {
        console.error(profileError);
        console.warn("[auth] profile upsert skipped:", profileError.message);
      });
    }

    console.log(`[auth] signup accepted for ${req.body.email}`);
    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    console.error("[auth] signup failed:", error.message);
    res.status(400).json({ message: error.message, error: error.message });
  }
}

router.post("/signup", signupHandler);

router.post("/login", async (req, res) => {
  try {
    const email = req.body.email || req.body.identifier;
    if (!email || !req.body.password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    console.log(`[auth] login attempt for ${email}`);
    const result = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: {
        email,
        password: req.body.password
      }
    });

    if (result.user && result.access_token) {
      await request("/rest/v1/users", {
        method: "POST",
        headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
        token: result.access_token,
        body: profilePayload(result.user, req.body)
      }).catch((profileError) => {
        console.error(profileError);
        console.warn("[auth] profile sync skipped:", profileError.message);
      });
    }

    console.log(`[auth] login success for ${email}`);
    res.json(result);
  } catch (error) {
    console.error(error);
    console.error("[auth] login failed:", error.message);
    res.status(401).json({ message: error.message, error: error.message });
  }
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
    const profiles = await request(`/rest/v1/users?select=*&id=eq.${user.id}&limit=1`, { token }).catch((profileError) => {
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
