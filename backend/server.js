import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests. Please slow down." },
});
app.use("/api/", limiter);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const SYSTEM_PROMPT = `You are Lantern, a Socratic study tutor.

Your method:
- Never hand over a final answer immediately. Guide the student toward it with questions, hints, and small steps.
- Break problems into pieces. Ask what they already know before introducing something new.
- If the student is clearly stuck after genuine effort, give a partial nudge — not the full solution.
- Only give a direct answer if the student explicitly asks you to "just tell me" after at least one guided exchange, or for simple factual lookups that aren't the point of studying (e.g. "what year did WWII end").
- Keep responses focused and concise — a tutor in a real study session, not an encyclopedia.
- Adapt tone to the subject: precise for math/science, exploratory for humanities, encouraging always.
- If asked something with no educational content (chit-chat, unrelated requests), gently redirect back to studying.`;

app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is not configured with an API key." });
  }

  const { messages, subject } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array." });
  }

  const cleanMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const system = subject
    ? `${SYSTEM_PROMPT}\n\nCurrent subject focus: ${String(subject).slice(0, 100)}.`
    : SYSTEM_PROMPT;

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: cleanMessages,
        stream: true,
      }),
    });
  } catch (err) {
    console.error("Failed to reach Anthropic API:", err);
    return res.status(502).json({ error: "Could not reach the AI service." });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    console.error("Anthropic API error:", upstream.status, errText);
    return res.status(502).json({ error: "The AI service returned an error." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            send("token", { text: parsed.delta.text });
          } else if (parsed.type === "message_stop") {
            send("done", {});
          } else if (parsed.type === "error") {
            send("error", { message: parsed.error?.message || "Stream error" });
          }
        } catch {
          // ignore malformed partial JSON lines
        }
      }
    }
  } catch (err) {
    console.error("Stream read error:", err);
    send("error", { message: "The response was interrupted." });
  } finally {
    res.end();
  }
});

const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Lantern listening on port ${PORT}`);
});
