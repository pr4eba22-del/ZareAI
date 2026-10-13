
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get("/api/config", (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: "Falta configurar la autenticación en el servidor."
    });
  }

  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  });
});

async function verificarUsuario(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Inicia sesión para continuar." });
    }

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      return res.status(401).json({
        error: "Tu sesión ha caducado. Inicia sesión nuevamente."
      });
    }

    const user = await response.json();

    if (!user.email || !user.email_confirmed_at) {
      return res.status(403).json({
        error: "Debes verificar tu correo electrónico."
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Error verificando usuario:", error);
    res.status(500).json({ error: "No se pudo verificar tu sesión." });
  }
}

app.post("/api/chat", verificarUsuario, async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "Falta configurar OPENROUTER_API_KEY en Render."
      });
    }

    const messages = req.body.messages;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "Formato de mensajes inválido."
      });
    }

    if (messages.length > 50) {
      return res.status(400).json({
        error: "La conversación es demasiado larga."
      });
    }

    const safeMessages = messages
      .filter(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 12000)
      }));

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
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
              content:
                "Tu nombre es Zare. Eres una inteligencia artificial amable, útil y clara. Responde en español cuando el usuario hable español."
            },
            ...safeMessages
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Error de OpenRouter:", data);
      return res.status(502).json({
        error: "Zare no pudo obtener una respuesta. Inténtalo nuevamente."
      });
    }

    res.json({
      reply:
        data.choices?.[0]?.message?.content ||
        "No recibí una respuesta."
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
