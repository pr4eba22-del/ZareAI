
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Límite básico por IP: 500 mensajes cada 24 horas.
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
      error: "Has alcanzado el límite de 500 mensajes en 24 horas. Inténtalo más tarde."
    });
  }

  record.count += 1;
  next();
}

setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of usageByIp) {
    if (now - record.startedAt >= WINDOW_MS) {
      usageByIp.delete(ip);
    }
  }
}, 60 * 60 * 1000).unref();

// Configuración pública que necesita el navegador.
// La clave anon de Supabase puede utilizarse en el cliente;
// NUNCA publiques una service_role key.
app.get("/api/config", (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: "Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY en Render."
    });
  }

  res.json({
    authRequired: true,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  });
});

// Comprueba el token directamente con Supabase Auth.
async function requireSupabaseUser(req, res, next) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({
        error: "Supabase no está configurado en el servidor."
      });
    }

    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        error: "Debes iniciar sesión para usar Zare AI."
      });
    }

    const supabaseResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${match[1]}`
        }
      }
    );

    if (!supabaseResponse.ok) {
      return res.status(401).json({
        error: "Tu sesión no es válida o ha caducado. Inicia sesión nuevamente."
      });
    }

    const user = await supabaseResponse.json();

    if (!user?.id) {
      return res.status(401).json({
        error: "No se pudo verificar tu cuenta."
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Error verificando sesión de Supabase:", error);

    return res.status(503).json({
      error: "No se pudo verificar tu sesión. Inténtalo nuevamente."
    });
  }
}

// Estado de autenticación y configuración.
app.get("/api/me", requireSupabaseUser, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email || null,
    emailConfirmed: Boolean(req.user.email_confirmed_at)
  });
});

app.post(
  "/api/chat",
  requireSupabaseUser,
  rateLimitChat,
  async (req, res) => {
    try {
      if (!OPENROUTER_API_KEY) {
        return res.status(500).json({
          error: "Falta configurar OPENROUTER_API_KEY en Render."
        });
      }

      const messages = req.body?.messages;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Envía al menos un mensaje."
        });
      }

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

      if (
        !safeMessages.length ||
        safeMessages[safeMessages.length - 1].role !== "user"
      ) {
        return res.status(400).json({
          error: "El último mensaje debe ser del usuario."
        });
      }

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
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zare AI está funcionando en el puerto ${PORT}`);
});
