exports.handler = async function (event) {
  try {
    /* ─────────────────────────────────────────── */
    /* 1️⃣ METHOD VALIDATION */
    /* ─────────────────────────────────────────── */
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Request body is required" })
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON format" })
      };
    }

    const message = parsed.message;
    if (!message || typeof message !== "string") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Message is required" })
      };
    }

    /* ─────────────────────────────────────────── */
    /* 2️⃣ STRICT SYSTEM PROMPT (BACKEND ENFORCED) */
    /* ─────────────────────────────────────────── */
    const systemPrompt = `
You are a senior Oracle APEX architect.

Respond using EXACTLY these sections in this order:

Overview
Secure Implementation
APEX Configuration Steps
Where to Place the Code
Important Notes
Optional Advanced Improvement
Follow-up Questions

Rules:
- No beginner explanations.
- No filler text.
- No generic advice.
- All code must use triple backticks with language tag.
- Where to Place section must map to every code block.
- Follow-up Questions must contain exactly 3 questions starting with Q:
- Use Oracle APEX 24.2 property names.
- Use → arrows for navigation paths.
`;

    /* ─────────────────────────────────────────── */
    /* 3️⃣ CALL OPENROUTER SAFELY */
    /* ─────────────────────────────────────────── */
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://oracle-apex-agent.netlify.app",
          "X-Title": "Oracle APEX AI Agent"
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-haiku",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          temperature: 0.2,
          max_tokens: 1500
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data?.error?.message || "OpenRouter API error"
        })
      };
    }

    /* ─────────────────────────────────────────── */
    /* 4️⃣ SAFE REPLY EXTRACTION */
    /* ─────────────────────────────────────────── */
    let reply = "No response generated.";

    if (data.choices && data.choices.length > 0) {
      const msg = data.choices[0].message;

      if (typeof msg.content === "string") {
        reply = msg.content;
      } else if (Array.isArray(msg.content)) {
        reply = msg.content.map(p => p.text || "").join(" ");
      }
    }

    /* ─────────────────────────────────────────── */
    /* 5️⃣ ANTI-TRUNCATION CHECK */
    /* If model stopped early, gently warn */
    /* ─────────────────────────────────────────── */
    if (!reply.endsWith("```") && reply.length > 1400) {
      reply += "\n\n⚠️ Response may be truncated due to model token limit.";
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };

  } catch (error) {
    console.error("Function crashed:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: error.message
      })
    };
  }
};
