const DAILY_LIMIT = 10;
const MAX_PROMPT_LENGTH = 3000;
const MAX_PER_MINUTE = 3;

const userLimits = {};
const metrics = {
  totalRequests: 0,
  uniqueUsers: new Set(),
  perUserCount: {}
};

exports.handler = async function (event) {
  try {

    /* ───────────────────────────── */
    /* STATS ENDPOINT */
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

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Request body required" }) };
    }

    const parsed = JSON.parse(event.body);
    const message = parsed.message?.trim();

    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Message required" }) };
    }

    if (message.length > MAX_PROMPT_LENGTH) {
      return { statusCode: 400, body: JSON.stringify({ error: "Prompt too long." }) };
    }

    /* ───────────────────────────── */
    /* GREETING SHORTCUT */
    /* ───────────────────────────── */
    const lower = message.toLowerCase();

    if (
      lower.length < 25 &&
      /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)/i.test(lower)
    ) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply:
            "Hello 👋 I’m your Oracle APEX AI Agent. Ask any Oracle APEX development question and I’ll respond with a structured, production-focused answer.",
          remainingQuestions: DAILY_LIMIT
        })
      };
    }

    /* ───────────────────────────── */
    /* RATE LIMITING */
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
        dailyReset: now + 86400000,
        minuteCount: 0,
        minuteWindowStart: now
      };
    }

    const userData = userLimits[userIP];

    metrics.totalRequests++;
    metrics.uniqueUsers.add(userIP);
    metrics.perUserCount[userIP] =
      (metrics.perUserCount[userIP] || 0) + 1;

    if (now > userData.dailyReset) {
      userData.dailyCount = 0;
      userData.dailyReset = now + 86400000;
    }

    if (now - userData.minuteWindowStart > 60000) {
      userData.minuteCount = 0;
      userData.minuteWindowStart = now;
    }

    if (userData.minuteCount >= MAX_PER_MINUTE) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: "Too many requests. Wait a minute." })
      };
    }

    if (userData.dailyCount >= DAILY_LIMIT) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: "Daily limit reached." })
      };
    }

    userData.minuteCount++;
    userData.dailyCount++;

    /* ───────────────────────────── */
    /* INTENT DETECTION */
    /* ───────────────────────────── */

    const implementationIntent =
      /(how|create|implement|configure|setup|build|code|secure|optimize|plsql|sql|dynamic action|interactive)/i.test(lower);

    /* ───────────────────────────── */
    /* ADAPTIVE SYSTEM PROMPT */
    /* ───────────────────────────── */

    const systemPrompt = implementationIntent
      ? `
You are a senior Oracle APEX architect.

Interpret ALL user questions strictly within Oracle APEX development context.

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
- All code blocks use triple backticks with language tag.
- Follow-up Questions must contain exactly 3 questions starting with Q:
- Use Oracle APEX 24.2 property names.
`
      : `
You are a senior Oracle APEX architect.

Interpret ALL user questions strictly within Oracle APEX development context.

Respond using structured sections:

Overview
Key Points
Practical Guidance
Follow-up Questions

Rules:
- No filler.
- No generic advice.
- Follow-up Questions must contain exactly 3 practical questions starting with Q:
`;

    /* ───────────────────────────── */
    /* OPENROUTER CALL */
    /* ───────────────────────────── */

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
             Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
          error: data?.error?.message || "OpenRouter error"
        })
      };
    }

    const reply =
      data.choices?.[0]?.message?.content || "No response generated.";

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply,
        remainingQuestions: DAILY_LIMIT - userData.dailyCount
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" })
    };
  }
};
