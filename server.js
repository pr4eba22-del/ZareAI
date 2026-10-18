const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render está detrás de un proxy. Esto permite identificar la IP del visitante.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Límite básico: hasta 500 mensajes por IP cada 24 horas.
// Es una protección inicial en memoria; al reiniciar el servidor se reinicia el contador.
const DAILY_LIMIT = 500;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const usageByIp = new Map();

function rateLimitChat(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let record = usageByIp.get(ip);

  if (!record || now - record.startedAt >= WINDOW_MS) {
    record = { startedAt: now, count: 0 };
    usageByIp.set(ip, record);
  }

  if (record.count >= DAILY_LIMIT) {
    return res.status(429).json({
      error: "Has alcanzado el límite de 500 mensajes en 24 horas para esta conexión. Inténtalo más tarde."
    });
  }

  record.count += 1;
  next();
}

// Limpia registros expirados para que el mapa no crezca indefinidamente.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of usageByIp) {
    if (now - record.startedAt >= WINDOW_MS) usageByIp.delete(ip);
  }
}, 60 * 60 * 1000).unref();

app.get("/api/config", (req, res) => {
  res.json({ authRequired: false });
});

app.post("/api/chat", rateLimitChat, async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "Falta configurar OPENROUTER_API_KEY en Render."
      });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Envía al menos un mensaje." });
    }

    // Conserva solo los últimos 30 mensajes y limita el tamaño de cada uno.
    const safeMessages = messages
      .slice(-30)
      .filter(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      )
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 12000)
      }));

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "El último mensaje debe ser del usuario." });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Zare AI"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content: "Tu nombre es Zare. Eres una inteligencia artificial amable, útil y clara. Responde en español cuando el usuario hable español."
          },
          ...safeMessages
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error de OpenRouter:", data);
      return res.status(502).json({
        error: "Zare no pudo obtener una respuesta. Inténtalo nuevamente."
      });
    }

    res.json({
      reply: data.choices?.[0]?.message?.content || "No recibí una respuesta."
    });
  } catch (error) {
    console.error("Error del chat:", error);
    res.status(500).json({
      error: "Ocurrió un error al comunicarse con Zare."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zare AI está funcionando en el puerto ${PORT}`);
});
