# YouTube Summarizer (RapidAPI + Gemini 2.5 Flash)

Учебный проект: веб-сервис, который получает транскрипт YouTube-ролика через RapidAPI и формирует краткое описание при помощи Gemini 2.5 Flash API. Результат отображается на веб-странице.

---

## Структура проекта
- `server.js` — Express-сервер (работает локально и как serverless-функция на Vercel).
- `api/index.js` — обёртка для Vercel (через `serverless-http`).
- `public/index.html` — фронтенд с полем для videoId и кнопкой.
- `package.json` — зависимости проекта.
- `.env.example` — образец переменных окружения.
- `vercel.json` — маршрутизация для деплоя на Vercel.

---

## Переменные окружения
Создайте файл `.env` по образцу `.env.example`:

```ini
RAPIDAPI_KEY=ваш_ключ_RapidAPI
RAPIDAPI_HOST=youtube-transcriptor.p.rapidapi.com
RAPIDAPI_URL=https://youtube-transcriptor.p.rapidapi.com/transcript?video_id={videoId}&lang=en
GEMINI_API_KEY=ваш_ключ_Gemini
PORT=5173