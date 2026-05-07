const express = require("express");
const { request, getBearerToken, getAuthUser, preferReturn } = require("../lib/supabase");

const router = express.Router();

router.get("/status", (_req, res) => {
  res.json({
    status: "ok"
  });
});

function profilePayload(user, body = {}) {
  return {
    id: user.id,
    name: body.name || user.user_metadata?.name || "Urban Kicks Member",
    email: user.email || body.email || "",
    mobile: body.mobile || user.phone || user.user_metadata?.mobile || "",
    role: "customer"
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
        data: { name: req.body.name, mobile: req.body.mobile }
      }
    });

    if (result.user && result.access_token) {
      await request("/rest/v1/users", {
        method: "POST",
        headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
        token: result.access_token,
        body: profilePayload(result.user, req.body)
      }).catch((profileError) => {
        console.warn("[auth] profile upsert skipped:", profileError.message);
      });
    }

    console.log(`[auth] signup accepted for ${req.body.email}`);
    res.status(201).json(result);
  } catch (error) {
    console.error("[auth] signup failed:", error.message);
    res.status(400).json({ message: "Could not sign up", error: error.message });
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
        console.warn("[auth] profile sync skipped:", profileError.message);
      });
    }

    console.log(`[auth] login success for ${email}`);
    res.json(result);
  } catch (error) {
    console.error("[auth] login failed:", error.message);
    res.status(401).json({ message: "Could not log in", error: error.message });
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
    console.error("[auth] refresh failed:", error.message);
    res.status(401).json({ message: "Could not refresh session", error: error.message });
  }
});

router.post("/profile", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token);
    if (!user) return res.status(401).json({ message: "Login required" });

    const rows = await request("/rest/v1/users", {
      method: "POST",
      token,
      headers: { ...preferReturn(), Prefer: "resolution=merge-duplicates,return=representation" },
      body: profilePayload(user, req.body)
    });

    console.log(`[auth] profile synced for ${user.email || user.id}`);
    res.status(201).json(rows[0] || profilePayload(user, req.body));
  } catch (error) {
    console.error("[auth] profile sync failed:", error.message);
    res.status(400).json({ message: "Could not sync profile", error: error.message });
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
    res.status(400).json({ message: "Could not log out", error: error.message });
  }
});

router.get("/me", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token);
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const profiles = await request(`/rest/v1/users?select=*&id=eq.${user.id}&limit=1`, { token }).catch((profileError) => {
      console.warn("[auth] profile read skipped:", profileError.message);
      return [];
    });
    res.json({ user, profile: profiles[0] || null });
  } catch (error) {
    res.status(401).json({ message: "Not authenticated", error: error.message });
  }
});

router.post("/register", signupHandler);

module.exports = router;
