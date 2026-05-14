const express = require("express");
const { request, preferReturn, getBearerToken, getAuthUser } = require("../lib/supabase");

const router = express.Router();

function isMissingPushTable(error) {
  const lower = String(error?.message || "").toLowerCase();
  return lower.includes("push_subscriptions") && (lower.includes("schema cache") || lower.includes("could not find") || lower.includes("does not exist"));
}

router.post("/subscribe", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await getAuthUser(token).catch(() => null);
    const subscription = req.body?.subscription || null;
    const endpoint = subscription?.endpoint || "";
    const permission = String(req.body?.permission || "default").slice(0, 32);
    const payload = {
      user_id: user?.id || null,
      endpoint,
      subscription,
      permission,
      preferences: req.body?.preferences || {},
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
      updated_at: new Date().toISOString()
    };

    if (!endpoint) {
      return res.json({ saved: false, permission });
    }

    const existing = await request(`/rest/v1/push_subscriptions?select=id&endpoint=eq.${encodeURIComponent(endpoint)}&limit=1`, { token })
      .catch((error) => {
        if (isMissingPushTable(error)) return null;
        throw error;
      });

    if (existing === null) {
      console.warn("[notifications] push_subscriptions table missing. Apply supabase/push_subscriptions.sql.");
      return res.json({ saved: false, permission, setupRequired: true });
    }

    if (existing.length) {
      await request(`/rest/v1/push_subscriptions?id=eq.${existing[0].id}`, {
        method: "PATCH",
        token,
        headers: preferReturn(),
        body: payload
      });
    } else {
      payload.created_at = payload.updated_at;
      await request("/rest/v1/push_subscriptions", {
        method: "POST",
        token,
        headers: preferReturn(),
        body: payload
      });
    }

    res.json({ saved: true, permission });
  } catch (error) {
    console.error("[notifications] subscription save failed:", error.message);
    res.status(200).json({ saved: false, permission: String(req.body?.permission || "default"), error: "Subscription save deferred" });
  }
});

module.exports = router;
