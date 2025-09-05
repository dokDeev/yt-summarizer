import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

// ───────────────────────────────────────────────────────────────────────────────
// Конфиг и базовая инициализация
// ───────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Абсолютный путь к директории проекта (для sendFile):
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Раздача статических файлов из /public
app.use(express.static(path.join(__dirname, "public")));

const {
  RAPIDAPI_KEY,
  RAPIDAPI_HOST,
  RAPIDAPI_URL,
  GEMINI_API_KEY,
  PORT = 5173,
} = process.env;

function assertEnv() {
  const miss = [];
  if (!RAPIDAPI_KEY) miss.push("RAPIDAPI_KEY");
  if (!RAPIDAPI_HOST) miss.push("RAPIDAPI_HOST");
  if (!RAPIDAPI_URL) miss.push("RAPIDAPI_URL");
  if (!GEMINI_API_KEY) miss.push("GEMINI_API_KEY");
  if (miss.length) throw new Error(`Нет переменных окружения: ${miss.join(", ")}`);
}
assertEnv();

// ───────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ───────────────────────────────────────────────────────────────────────────────
function normalizeTranscript(data) {
  if (typeof data?.transcript === "string") return data.transcript;
  if (Array.isArray(data) && data.length && typeof data[0]?.text === "string") {
    return data.map(s => s.text).join(" ").trim();
  }
  if (Array.isArray(data?.segments)) {
    return data.segments.map(s => s.text || "").join(" ").trim();
  }
  if (Array.isArray(data?.subtitles)) {
    return data.subtitles.map(s => s.subtitle || s.text || "").join(" ").trim();
  }
  if (typeof data === "string") return data;
  return JSON.stringify(data);
}

function stripMarkdownFence(s) {
  if (!s) return s;
  let cleaned = String(s).trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
  }
  return cleaned;
}

// ───────────────────────────────────────────────────────────────────────────────
// Роут главной страницы (чтобы "/" всегда отдавался на Vercel/Express)
// ───────────────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ───────────────────────────────────────────────────────────────────────────────
// 1) Эндпойнт: получить транскрипт через RapidAPI
// ───────────────────────────────────────────────────────────────────────────────
app.get("/api/transcript", async (req, res) => {
  try {
    const videoId = String(req.query.videoId || "").trim();
    if (!videoId) return res.status(400).json({ error: "Параметр videoId обязателен" });

    if (!RAPIDAPI_URL.includes("{videoId}")) {
      return res.status(500).json({
        error: "RAPIDAPI_URL должен содержать плейсхолдер {videoId}. Проверьте .env",
      });
    }
    const url = RAPIDAPI_URL.replace("{videoId}", encodeURIComponent(videoId));

    const r = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
    });

    const rawText = await r.text();
    if (!r.ok) {
      return res.status(r.status).json({ error: "RapidAPI error", details: rawText });
    }

    let data;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    const transcript = normalizeTranscript(data);

    res.json({ videoId, transcript, raw: data });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// 2) Эндпойнт: суммаризация через Gemini 2.5 Flash
// ───────────────────────────────────────────────────────────────────────────────
app.get("/api/summary", async (req, res) => {
  try {
    const videoId = String(req.query.videoId || "").trim();
    if (!videoId) return res.status(400).json({ error: "Параметр videoId обязателен" });

    // 2.1 транскрипт (через наш же API)
    const txResp = await fetch(
      `${req.protocol}://${req.get("host")}/api/transcript?videoId=${encodeURIComponent(videoId)}`
    );
    const txData = await txResp.json();
    if (!txResp.ok) return res.status(502).json(txData);

    const transcript = String(txData.transcript || "").slice(0, 15000);

    // 2.2 Gemini с требованием JSON
    const prompt = `
Ты — ассистент, делающий краткое русскоязычное описание видео на основе транскрипта.
Верни СТРОГО JSON (без Markdown-ограждений) со структурой:
{
  "title": "короткий заголовок (до 80 символов)",
  "summary": "3–5 предложений по сути, без воды",
  "bullets": ["3–6 тезисов"],
  "tags": ["до 8 ключевых тегов"],
  "language": "ru"
}
Транскрипт:
"""${transcript}"""
`.trim();

    const gResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        }),
      }
    );

    const gText = await gResp.text();
    if (!gResp.ok) {
      return res.status(gResp.status).json({ error: "Gemini error", details: gText });
    }

    let payload;
    try { payload = JSON.parse(gText); } catch { payload = gText; }

    let textOut =
      payload?.candidates?.[0]?.content?.parts?.[0]?.text ??
      payload?.text ??
      (typeof payload === "string" ? payload : JSON.stringify(payload));

    textOut = stripMarkdownFence(textOut);

    let summary;
    try { summary = JSON.parse(textOut); }
    catch { summary = { textRaw: textOut }; }

    res.json({ videoId, summary, transcriptPreview: transcript.slice(0, 1000) });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

// Health-check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ───────────────────────────────────────────────────────────────────────────────
// Экспорт для Vercel и локальный запуск
// ───────────────────────────────────────────────────────────────────────────────
export default app;

const isVercel = !!process.env.VERCEL;
if (!isVercel) {
  app.listen(Number(PORT), () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}