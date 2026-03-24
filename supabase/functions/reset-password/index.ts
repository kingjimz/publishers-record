import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_PASSWORD_LEN = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid email address." }, 400);
    }

    if (password.length < MIN_PASSWORD_LEN) {
      return json(
        { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
        400,
      );
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("reset-password: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const normalized = email.toLowerCase();
    let page = 1;
    const perPage = 200;
    let userId: string | null = null;

    for (;;) {
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage });
      if (listError) {
        console.error("reset-password listUsers:", listError);
        return json({ error: "Unable to look up user." }, 500);
      }

      const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
      if (match) {
        userId = match.id;
        break;
      }

      if (data.users.length < perPage) break;
      page += 1;
      if (page > 500) break;
    }

    if (!userId) {
      return json({ error: "No account found for that email." }, 404);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      return json({ error: updateError.message || "Could not update password." }, 400);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("reset-password:", e);
    return json({ error: "Unexpected error." }, 500);
  }
});

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
