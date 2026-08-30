// Shamim IPTV — Visitor Counter Worker
// Deploy this on Cloudflare Workers with a KV namespace bound as VISITORS.
// Routes:
//   GET /hit    -> increments the counter by 1 and returns the new total
//   GET /count  -> just returns the current total, no increment
//
// Setup steps are in WORKER-README.md in this same folder.

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    let count = parseInt((await env.VISITORS.get("count")) || "0", 10);

    if (url.pathname === "/hit") {
      count += 1;
      await env.VISITORS.put("count", String(count));
    }

    return new Response(JSON.stringify({ count }), {
      headers: { "Content-Type": "application/json", ...cors },
    });
  },
};
