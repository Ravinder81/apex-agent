exports.handler = async function (event) {
  const { message } = JSON.parse(event.body);

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
        { role: "system", content: "You are an Oracle APEX expert assistant." },
        { role: "user", content: message }
      ],
      max_tokens: 500
    })
  });

  const data = await response.json();

console.log("FULL OPENROUTER RESPONSE:", JSON.stringify(data, null, 2));

  return {
    statusCode: 200,
    body: JSON.stringify({
      reply: data.choices?.[0]?.message?.content || "No response"
    })
  };
};

