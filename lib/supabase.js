const { createClient } = require("@supabase/supabase-js");

const DEFAULT_URL = "qvpkiusazqthlxwvesjk";

function normalizeSupabaseUrl(value) {
  const raw = (value || DEFAULT_URL).trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
  if (raw.includes(".")) return `https://${raw}`.replace(/\/$/, "");
  return `https://${raw}.supabase.co`;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function assertConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase config is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
}

async function request(path, options = {}) {
  assertConfig();
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${options.token || supabaseAnonKey}`,
    "Content-Type": "application/json",
    ...options.headers
  };

  let response;
  try {
    response = await fetch(`${supabaseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    console.error("[supabase] network request failed:", error.message);
    throw new Error("Could not reach Supabase. Check network access and Supabase project configuration.");
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.hint || "Supabase request failed");
  }
  return payload;
}

function rest(table, query = "select=*") {
  return `/rest/v1/${table}?${query}`;
}

function preferReturn() {
  return { Prefer: "return=representation" };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function getAuthUser(token) {
  if (!token) return null;
  return request("/auth/v1/user", { token });
}

module.exports = {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  request,
  rest,
  preferReturn,
  getBearerToken,
  getAuthUser
};
