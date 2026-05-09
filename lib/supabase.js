const { createClient } = require("@supabase/supabase-js");

const DEFAULT_URL = "qvpkiusazqthlxwvesjk";

function normalizeSupabaseUrl(value) {
  const raw = (value || DEFAULT_URL).trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
  if (raw.includes(".")) return `https://${raw}`.replace(/\/$/, "");
  return `https://${raw}.supabase.co`;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
let supabaseClient = null;

function getSupabaseClient() {
  assertConfig();
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseClient;
}

function parseJson(text, fallbackMessage) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`${fallbackMessage}: ${preview || "non-JSON response"}`);
  }
}

function assertConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase config is missing. Set NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_URL/SUPABASE_ANON_KEY.");
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
    console.error(error);
    console.error("[supabase] network request failed:", error.message);
    throw new Error("Could not reach Supabase. Check network access and Supabase project configuration.");
  }

  const text = await response.text();
  const payload = parseJson(text, "Supabase returned an invalid response");
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
  get supabase() {
    return getSupabaseClient();
  },
  getSupabaseClient,
  supabaseUrl,
  supabaseAnonKey,
  request,
  rest,
  preferReturn,
  getBearerToken,
  getAuthUser
};
