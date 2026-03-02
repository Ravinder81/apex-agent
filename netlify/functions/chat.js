const DAILY_LIMIT = 10;
const MAX_PROMPT_LENGTH = 3000;

/*
Structure:
{
  "IP": {
      count: Number,
      resetTime: Timestamp
  }
}
*/
const userLimits = {};

exports.handler = async function (event) {
  try {

    /* ───────────────────────────── */
    /* 1️⃣ METHOD VALIDATION */
    /* ───────────────────────────── */
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

    if (message.length > MAX_PROMPT_LENGTH) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Prompt too long. Please shorten your question."
        })
      };
    }

    /* ───────────────────────────── */
    /* 2️⃣ USER IDENTIFICATION */
    /* ───────────────────────────── */
    const userIP =
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "unknown";

    const now = Date.now();

    if (!userLimits[userIP]) {
      userLimits[userIP] = {
        count: 0,
        resetTime: now + (24 * 60 * 60 * 1000)
      };
    }

    const userData = userLimits[userIP];

    /* Reset after 24 hours */
    if (now > userData.resetTime) {
      userData.count = 0;
      userData.resetTime = now + (24 * 60 * 60 * 1000);
    }

    /* ───────────────────────────── */
    /* 3️⃣ DAILY LIMIT CHECK */
    /* ───────────────────────────── */
    if (userData.count >= DAILY_LIMIT) {
      const remainingTime = Math.ceil(
        (userData.resetTime - now) / (60 * 60 * 1000)
      );

      return {
        statusCode: 429,
        body: JSON.stringify({
          error: `Daily limit reached. You can ask only 10 questions every 24 hours.`,
          retryAfterHours: remainingTime
        })
      };
    }

    userData.count++;

    console.log("User IP:", userIP);
    console.log("Question Count:", userData.count);

    /* ───────────────────────────── */
    /* 4️⃣ STRICT SYSTEM PROMPT */
    /* ───────────────────────────── */
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

    /* ───────────────────────────── */
    /* 5️⃣ CALL OPENROUTER */
    /* ───────────────────────────── */
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

    /* ───────────────────────────── */
    /* 6️⃣ TOKEN LOGGING */
    /* ───────────────────────────── */
    if (data.usage) {
      console.log("Token usage:", data.usage);
    }

    /* ───────────────────────────── */
    /* 7️⃣ SAFE REPLY EXTRACTION */
    /* ───────────────────────────── */
    let reply = "No response generated.";

    if (data.choices && data.choices.length > 0) {
      const msg = data.choices[0].message;

      if (typeof msg.content === "string") {
        reply = msg.content;
      } else if (Array.isArray(msg.content)) {
        reply = msg.content.map(p => p.text || "").join(" ");
      }
    }

    /* Anti-truncation indicator */
    if (!reply.endsWith("```") && reply.length > 1400) {
      reply += "\n\n⚠️ Response may be truncated due to model token limit.";
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply,
        remainingQuestions: DAILY_LIMIT - userData.count
      })
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
