
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

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
  if (!FIREBASE_API_KEY) {
    return res.status(500).json({ error: "Falta configurar FIREBASE_API_KEY en Render." });
  }
  res.json({
    authRequired: true,
    firebaseConfig: {
      apiKey: FIREBASE_API_KEY,
      authDomain: "zare-ai.firebaseapp.com",
      projectId: "zare-ai",
      storageBucket: "zare-ai.firebasestorage.app",
      messagingSenderId: "477911318547",
      appId: "1:477911318547:web:e9caed64382ae6b2d7bfe6"
    }
  });
});

// Valida el ID token con Firebase Identity Toolkit.
async function requireFirebaseUser(req, res, next) {
  try {
    if (!FIREBASE_API_KEY) {
      return res.status(500).json({ error: "Firebase no está configurado en el servidor." });
    }
    const match = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: "Inicia sesión con Google para usar Zare AI." });

    const verification = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: match[1] })
      }
    );
    const result = await verification.json();
    const user = result.users?.[0];
    if (!verification.ok || !user?.localId) {
      return res.status(401).json({ error: "Tu sesión no es válida. Inicia sesión nuevamente." });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("Error verificando sesión de Firebase:", error);
    return res.status(503).json({ error: "No se pudo verificar tu sesión. Inténtalo nuevamente." });
  }
}

app.get("/api/me", requireFirebaseUser, (req, res) => {
  res.json({ id: req.user.localId, email: req.user.email || null, emailVerified: Boolean(req.user.emailVerified) });
});

app.post(
  "/api/chat",
  requireFirebaseUser,
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
