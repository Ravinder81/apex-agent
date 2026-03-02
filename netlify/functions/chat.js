const DAILY_LIMIT = 10;
const MAX_PROMPT_LENGTH = 3000;
const MAX_PER_MINUTE = 3;

/*
Structure:
{
  "IP": {
      dailyCount: Number,
      dailyReset: Timestamp,
      minuteCount: Number,
      minuteWindowStart: Timestamp
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
    const rawIP =
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "unknown";

    const userIP = rawIP.split(",")[0].trim();
    const now = Date.now();

    if (!userLimits[userIP]) {
      userLimits[userIP] = {
        dailyCount: 0,
        dailyReset: now + (24 * 60 * 60 * 1000),
        minuteCount: 0,
        minuteWindowStart: now
      };
    }

    const userData = userLimits[userIP];

    /* ───────────────────────────── */
    /* 3️⃣ RESET DAILY IF NEEDED */
    /* ───────────────────────────── */
    if (now > userData.dailyReset) {
      userData.dailyCount = 0;
      userData.dailyReset = now + (24 * 60 * 60 * 1000);
    }

    /* ───────────────────────────── */
    /* 4️⃣ RESET MINUTE WINDOW */
    /* ───────────────────────────── */
    if (now - userData.minuteWindowStart > 60 * 1000) {
      userData.minuteCount = 0;
      userData.minuteWindowStart = now;
    }

    /* ───────────────────────────── */
    /* 5️⃣ MINUTE RATE LIMIT CHECK */
    /* ───────────────────────────── */
    if (userData.minuteCount >= MAX_PER_MINUTE) {
      return {
        statusCode: 429,
        body: JSON.stringify({
          error: "Too many requests. Please wait a minute before trying again."
        })
      };
    }

    /* ───────────────────────────── */
    /* 6️⃣ DAILY LIMIT CHECK */
    /* ───────────────────────────── */
    if (userData.dailyCount >= DAILY_LIMIT) {
      const hoursLeft = Math.ceil(
        (userData.dailyReset - now) / (60 * 60 * 1000)
      );

      return {
        statusCode: 429,
        body: JSON.stringify({
          error: `Daily limit reached. You can ask only 10 questions every 24 hours.`,
          retryAfterHours: hoursLeft
        })
      };
    }

    /* Increment counters */
    userData.minuteCount++;
    userData.dailyCount++;

    console.log({
      ip: userIP,
      dailyUsed: userData.dailyCount,
      minuteUsed: userData.minuteCount,
      remainingToday: DAILY_LIMIT - userData.dailyCount
    });

    /* ───────────────────────────── */
    /* 7️⃣ SYSTEM PROMPT */
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
    /* 8️⃣ CALL OPENROUTER */
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
    /* 9️⃣ EXTRACT RESPONSE */
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply,
        remainingQuestions: DAILY_LIMIT - userData.dailyCount
      })
    };

  } catch (error) {
    console.error("Function crashed:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error"
      })
    };
  }
};
