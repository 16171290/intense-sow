// Netlify function: dictated walk-through -> room-by-room Scope of Work.
// Uses Node's built-in https (no global fetch dependency) so it runs on any Node version.
// API key comes from the ANTHROPIC_API_KEY environment variable. Never sent to the browser.

const https = require("https");

const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap

const SYSTEM = `You convert a real estate investor's dictated walk-through into a room-by-room renovation Scope of Work.
Return ONLY compact JSON, no prose, no markdown:
{"rooms":[{"room":"<ROOM NAME, UPPERCASE>","items":["<one task per line>"]}]}
Rules:
- Split the text at each room the investor names.
- Each distinct task is its own item, line by line.
- Keep the investor's wording, lightly cleaned into an imperative: "demo cabinets" -> "Demo cabinets", "new countertops" -> "Install new countertops".
- If a demo list and an install list are given, list each item separately.
- Do NOT invent specs, materials, sizes, quantities, or tasks that were not said.`;

function callAnthropic(key, transcript) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: "Walk-through:\n" + transcript }],
  });
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const key = process.env.ANTHROPIC_API_KEY;
  console.log("sow invoked | method:", event.httpMethod, "| hasKey:", !!key);

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  if (!key) { console.log("ERROR: ANTHROPIC_API_KEY missing at runtime"); return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) }; }

  let raw = event.body || "{}";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  let transcript = "";
  try { transcript = (JSON.parse(raw).transcript || "").trim(); } catch (e) { console.log("body parse error:", String(e)); }
  console.log("transcript length:", transcript.length);
  if (!transcript) return { statusCode: 400, body: JSON.stringify({ error: "no transcript" }) };

  try {
    const r = await callAnthropic(key, transcript);
    console.log("anthropic status:", r.status);
    if (r.status !== 200) {
      console.log("anthropic error body:", r.body.slice(0, 600));
      return { statusCode: 502, body: JSON.stringify({ error: "anthropic", status: r.status, detail: r.body }) };
    }
    const result = JSON.parse(r.body);
    let text = (result.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(s, e + 1));
    console.log("rooms parsed:", (parsed.rooms || []).length);
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ rooms: parsed.rooms || [] }) };
  } catch (err) {
    console.log("FUNCTION ERROR:", String(err));
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
