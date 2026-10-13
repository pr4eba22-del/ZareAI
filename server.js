
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.post("/api/chat", async (req, res) => {
  try {
    const messages = req.body.messages;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Formato de mensajes inválido." });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "Falta configurar la clave API en el archivo .env."
      });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Zare AI"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content: "Tu nombre es Zare. Eres una inteligencia artificial amable, útil y clara. Responde en español cuando el usuario hable español."
          },
          ...messages
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error de OpenRouter:", data);
      return res.status(response.status).json({
        error: data.error?.message || "No se pudo obtener una respuesta de la IA."
      });
    }

    res.json({
      reply: data.choices?.[0]?.message?.content || "No recibí una respuesta."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al comunicarse con la inteligencia artificial." });
  }
});

app.listen(PORT, () => {
  console.log(`Zare está funcionando en http://localhost:${PORT}`);
});
