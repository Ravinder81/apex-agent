exports.handler = async function (event) {
  try {
    // ✅ Only allow POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    // ✅ Safe JSON parsing
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Request body is required" })
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(event.body);
    } catch (err) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON format" })
      };
    }

    const message = parsed.message;
    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Message is required" })
      };
    }

    // ✅ Call OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://apexagent01.netlify.app",
        "X-Title": "Oracle APEX AI Agent"
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-haiku",
        messages: [
          {
            role: "system",
            content: "You are an Oracle APEX expert assistant."
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 800
      })
    });

    const data = await response.json();

    console.log("FULL OPENROUTER RESPONSE:", JSON.stringify(data, null, 2));

    // ✅ Handle API-level errors
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data?.error || "OpenRouter API error"
        })
      };
    }

    // ✅ Extract reply safely
    let reply = "No response generated.";

    if (data.choices && data.choices.length > 0) {
      const msg = data.choices[0].message;

      if (typeof msg.content === "string") {
        reply = msg.content;
      } else if (Array.isArray(msg.content)) {
        reply = msg.content
          .map(part => part.text || "")
          .join(" ");
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
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
