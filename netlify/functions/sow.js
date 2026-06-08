// Netlify serverless function: turns a dictated walk-through into a room-by-room SOW.
// The Anthropic API key is read from the ANTHROPIC_API_KEY environment variable.
// It is NEVER sent to the browser.

const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap; swap to a sonnet model for richer parsing

const SYSTEM = `You convert a real estate investor's dictated walk-through into a room-by-room renovation Scope of Work.
Return ONLY compact JSON, no prose, no markdown:
{"rooms":[{"room":"<ROOM NAME, UPPERCASE>","items":["<one task per line>"]}]}
Rules:
- Split the text at each room the investor names.
- Each distinct task is its own item, line by line.
- Keep the investor's wording, lightly cleaned into an imperative: "demo cabinets" -> "Demo cabinets", "new countertops" -> "Install new countertops".
- If a demo list and an install list are given, list each item separately.
- Do NOT invent specs, materials, sizes, quantities, or tasks that were not said.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };
  }
  let transcript = "";
  try { transcript = (JSON.parse(event.body || "{}").transcript || "").trim(); } catch (_) {}
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: "no transcript" }) };
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: "user", content: "Walk-through:\n" + transcript }],
      }),
    });
    const result = await resp.json();
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: "anthropic error", detail: result }) };
    }
    let text = (result.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(s, e + 1));
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rooms: parsed.rooms || [] }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
