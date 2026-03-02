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

/* Metrics store */
const metrics = {
  totalRequests: 0,
  uniqueUsers: new Set(),
  perUserCount: {}
};

exports.handler = async function (event) {
  try {

    /* ───────────────────────────── */
    /* 📊 STATS ENDPOINT (GET) */
    /* ───────────────────────────── */
    if (event.httpMethod === "GET") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalRequests: metrics.totalRequests,
          uniqueUsers: metrics.uniqueUsers.size,
          perUserCount: metrics.perUserCount
        })
      };
    }

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

    /* Initialize tracking */
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
    /* 📊 METRICS UPDATE */
    /* ───────────────────────────── */
    metrics.totalRequests++;
    metrics.uniqueUsers.add(userIP);

    if (!metrics.perUserCount[userIP]) {
      metrics.perUserCount[userIP] = 0;
    }
    metrics.perUserCount[userIP]++;

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
    /* 5️⃣ GREETING FILTER */
    /* ───────────────────────────── */
    const lowerMsg = message.trim().toLowerCase();

    if (
      lowerMsg.length < 20 &&
      /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|thanks|thank you)/.test(lowerMsg)
    ) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reply:
            "Hello 👋 I'm your Oracle APEX AI assistant. Ask me any Oracle APEX technical question and I’ll provide a structured implementation guide.",
          remainingQuestions: DAILY_LIMIT - userData.dailyCount
        })
      };
    }

    /* ───────────────────────────── */
    /* 6️⃣ ORACLE APEX TOPIC FILTER */
    /* ───────────────────────────── */
    if (!/apex|oracle|interactive report|interactive grid|dynamic action|plsql|ords|collection|authentication|authorization|sql workshop/i.test(message)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reply:
            "This assistant is dedicated to Oracle APEX technical questions only. Please ask a specific Oracle APEX development question.",
          remainingQuestions: DAILY_LIMIT - userData.dailyCount
        })
      };
    }

    /* ───────────────────────────── */
    /* 7️⃣ MINUTE RATE LIMIT */
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
    /* 8️⃣ DAILY LIMIT */
    /* ───────────────────────────── */
    if (userData.dailyCount >= DAILY_LIMIT) {
      return {
        statusCode: 429,
        body: JSON.stringify({
          error: "Daily limit reached. You can ask only 10 questions every 24 hours."
        })
      };
    }

    /* Increment counters */
    userData.minuteCount++;
    userData.dailyCount++;

    /* ───────────────────────────── */
    /* 9️⃣ SYSTEM PROMPT */
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
    /* 🔟 CALL OPENROUTER */
    /* ───────────────────────────── */
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
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

    /* Extract reply */
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
