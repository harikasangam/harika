import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/generative-ai";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-2.5-flash";

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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
  if (!ai) {
    return res.status(500).json({ error: "Server is not configured with a Gemini API key." });
  }

  const { messages, subject } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array." });
  }

  // Format messages into Gemini contents array
  const contents = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 4000) }],
    }));

  const systemInstruction = subject
    ? `${SYSTEM_PROMPT}\n\nCurrent subject focus: ${String(subject).slice(0, 100)}.`
    : SYSTEM_PROMPT;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const responseStream = await ai.models.generateContentStream({
      model: MODEL,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        maxOutputTokens: 700,
      },
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        send("token", { text: chunk.text });
      }
    }

    send("done", {});
  } catch (err) {
    console.error("Gemini API error:", err);
    send("error", { message: err.message || "The AI service returned an error." });
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
