export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_PROVIDER: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
}

type Metadata = {
  client_company?: string;
  client_contact_name?: string;
  michael_manager?: string;
  communication_channel?: string;
};

const REQUIRED_OUTPUT = `
Вывод должен строго содержать разделы:
A. Краткое резюме
B. Извлеченные данные
C. Решение для 1С
D. Черновик для клиента
E. Вопросы для уточнения
F. Финальный юридический статус сделки
`;

const SYSTEM_PROMPT = `
Вы — интеллектуальный ассистент менеджера по продажам ТОО Michael, Казахстан.
Работайте только по данным заявки. Не выдумывайте товары, цены, остатки, сроки, единицы измерения, аналоги или скидки.
Если данных нет, пишите «уточняется».

Обязательные настройки:
- Все коммерческие предложения, счета и клиентские цены формируются от ТОО Michael.
- Для клиента всегда готовить цены в формате «с НДС». НДС для Казахстана — 16%, если документы сделки не говорят иное.
- Если видна цена со стороннего сайта/прайса, не использовать ее как финальную цену ТОО Michael без подтверждения.
- Клиент ТОО KBI Energy / KBI Energy / КБИ Энерджи — VIP/оптовый покупатель с высоким приоритетом.
- По ТОО KBI Energy работа идет по годовому договору. Каждый счет должен сопровождаться приложением к договору.
- В каждой заявке фиксировать компанию клиента, контакт/менеджера клиента, ответственного менеджера Michael и канал связи.
- Канал связи важен: WhatsApp, Telegram и Email считаются основными рабочими каналами. В разделе D готовить текст под указанный канал.
- Голосовые сообщения после транскрибации считать полноценным входящим запросом.

${REQUIRED_OUTPUT}
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ status: "ok", runtime: "cloudflare-workers" });
      }
      if (request.method === "GET" && url.pathname === "/api/requests") {
        return json(await listRequests(env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/text") {
        return json(await processText(request, env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/upload") {
        return json(await processUpload(request, env));
      }

      const requestMatch = url.pathname.match(/^\/api\/requests\/(\d+)$/);
      if (request.method === "GET" && requestMatch) {
        const item = await getRequest(env, Number(requestMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      return json({ detail: "Endpoint не найден." }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      return json({ detail: message }, 500);
    }
  },
};

async function processText(request: Request, env: Env) {
  const payload = (await request.json()) as Metadata & { original_text?: string };
  const body = (payload.original_text || "").trim();
  if (!body) throw new Error("Текст заявки пустой.");

  const originalText = buildContextPrefix(payload) + body;
  const aiResult = await analyzeText(env, originalText);
  return insertRequest(env, {
    source_type: "text",
    ...payload,
    original_text: originalText,
    uploaded_file_name: null,
    ai_result: aiResult,
  });
}

async function processUpload(request: Request, env: Env) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Файл не передан.");

  const metadata: Metadata = {
    client_company: stringValue(formData.get("client_company")),
    client_contact_name: stringValue(formData.get("client_contact_name")),
    michael_manager: stringValue(formData.get("michael_manager")),
    communication_channel: stringValue(formData.get("communication_channel")),
  };
  const managerNote = stringValue(formData.get("manager_note"));
  const context = buildContextPrefix(metadata);
  const fileName = file.name || "uploaded-file";
  const lowerName = fileName.toLowerCase();

  let originalText = "";
  let aiResult = "";
  let sourceType = "file";

  if (isImage(lowerName)) {
    const filePayload = await fileToPayload(file);
    originalText = `${context}Загружено изображение для vision-анализа: ${fileName}`;
    if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
    aiResult = await analyzeImage(env, filePayload, fileName, `${context}${managerNote}`.trim());
    sourceType = "image";
  } else if (isAudio(lowerName)) {
    const transcription = await transcribeAudio(env, file, managerNote);
    originalText = `${context}Голосовое сообщение: ${fileName}\n\nТранскрибация:\n${transcription}`;
    if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
    aiResult = await analyzeText(env, originalText);
    sourceType = "audio";
  } else {
    const text = await file.text().catch(() => "");
    originalText = `${context}Файл: ${fileName}\n\n${managerNote ? `Пояснение менеджера:\n${managerNote}\n\n` : ""}${text || "Текст файла не извлечен в Worker MVP. Для PDF/DOCX/XLSX используйте текущую Docker-версию или добавьте отдельный parser/R2 pipeline."}`;
    aiResult = await analyzeText(env, originalText);
  }

  return insertRequest(env, {
    source_type: sourceType,
    ...metadata,
    original_text: originalText,
    uploaded_file_name: fileName,
    ai_result: aiResult,
  });
}

async function analyzeText(env: Env, originalText: string): Promise<string> {
  if (useGemini(env)) {
    return analyzeTextGemini(env, originalText);
  }
  requireOpenAI(env);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: SYSTEM_PROMPT,
      input: `Проанализируй входящую заявку менеджера по продажам.\n\nЗаявка:\n${originalText}`,
    }),
  });
  return readOpenAIText(response);
}

async function analyzeImage(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  if (useGemini(env)) {
    return analyzeImageGemini(env, filePayload, fileName, managerNote);
  }
  requireOpenAI(env);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Проанализируй изображение как входящую заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
            },
            { type: "input_image", image_url: filePayload.dataUrl },
          ],
        },
      ],
    }),
  });
  return readOpenAIText(response);
}

async function transcribeAudio(env: Env, file: File, managerNote: string): Promise<string> {
  if (useGemini(env)) {
    const filePayload = await fileToPayload(file);
    return transcribeAudioGemini(env, filePayload, file.name, managerNote);
  }
  requireOpenAI(env);
  const formData = new FormData();
  formData.append("model", env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
  formData.append("file", file, file.name);
  formData.append("response_format", "text");
  formData.append("prompt", `Голосовое сообщение из WhatsApp/Telegram по B2B-продажам электротехники. Контекст: ${managerNote || "нет"}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
  });
  if (!response.ok) throw new Error(`Ошибка OpenAI transcription: ${await response.text()}`);
  return (await response.text()).trim();
}

async function analyzeTextGemini(env: Env, originalText: string): Promise<string> {
  requireGemini(env);
  const response = await fetch(geminiGenerateUrl(env), {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              text: `Проанализируй входящую заявку менеджера по продажам.\n\nЗаявка:\n${originalText}`,
            },
          ],
        },
      ],
    }),
  });
  return readGeminiText(response);
}

async function analyzeImageGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  const response = await fetch(geminiGenerateUrl(env), {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              text: `Проанализируй изображение как входящую заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
            },
            {
              inline_data: {
                mime_type: filePayload.mimeType,
                data: filePayload.base64,
              },
            },
          ],
        },
      ],
    }),
  });
  return readGeminiText(response);
}

async function transcribeAudioGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  const response = await fetch(geminiGenerateUrl(env), {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Расшифруй голосовое сообщение дословно на языке оригинала. Это B2B-заявка по электротехнике. Имя файла: ${fileName}. Контекст: ${managerNote || "нет"}`,
            },
            {
              inline_data: {
                mime_type: filePayload.mimeType,
                data: filePayload.base64,
              },
            },
          ],
        },
      ],
    }),
  });
  return readGeminiText(response);
}

async function readOpenAIText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(`Ошибка OpenAI API: ${raw}`);
  const data = JSON.parse(raw);
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const text = data.output?.flatMap((item: any) => item.content || [])
    ?.map((content: any) => content.text || "")
    ?.join("\n")
    ?.trim();
  if (!text) throw new Error("OpenAI API вернул пустой ответ.");
  return text;
}

async function readGeminiText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(`Ошибка Gemini API: ${raw}`);
  const data = JSON.parse(raw);
  const text = data.candidates?.flatMap((candidate: any) => candidate.content?.parts || [])
    ?.map((part: any) => part.text || "")
    ?.join("\n")
    ?.trim();
  if (!text) throw new Error("Gemini API вернул пустой ответ.");
  return text;
}

async function listRequests(env: Env) {
  const result = await env.DB.prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT 100").all();
  return result.results;
}

async function getRequest(env: Env, id: number) {
  return env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
}

async function insertRequest(env: Env, item: Record<string, any>) {
  const result = await env.DB.prepare(`
    INSERT INTO requests (
      source_type, client_company, client_contact_name, michael_manager,
      communication_channel, original_text, uploaded_file_name, ai_result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      item.source_type,
      item.client_company || null,
      item.client_contact_name || null,
      item.michael_manager || null,
      item.communication_channel || null,
      item.original_text,
      item.uploaded_file_name || null,
      item.ai_result,
    )
    .run();
  return getRequest(env, Number(result.meta.last_row_id));
}

function buildContextPrefix(metadata: Metadata): string {
  const parts = [
    metadata.client_company ? `Компания клиента: ${metadata.client_company}` : "",
    metadata.client_contact_name ? `Контакт/менеджер клиента: ${metadata.client_contact_name}` : "",
    metadata.michael_manager ? `Менеджер Michael: ${metadata.michael_manager}` : "",
    metadata.communication_channel ? `Канал связи: ${metadata.communication_channel}` : "",
  ].filter(Boolean);
  return parts.length ? `Контекст заявки:\n${parts.join("\n")}\n\n` : "";
}

function isImage(fileName: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp"].some((extension) => fileName.endsWith(extension));
}

function isAudio(fileName: string): boolean {
  return [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm"].some((extension) => fileName.endsWith(extension));
}

type FilePayload = {
  mimeType: string;
  base64: string;
  dataUrl: string;
};

async function fileToPayload(file: File): Promise<FilePayload> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const mimeType = file.type || "application/octet-stream";
  const base64 = btoa(binary);
  return {
    mimeType,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireOpenAI(env: Env): void {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не задан. Установите secret через Wrangler.");
}

function requireGemini(env: Env): void {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан. Установите secret через Wrangler.");
}

function useGemini(env: Env): boolean {
  return (env.AI_PROVIDER || "").toLowerCase() === "gemini";
}

function openAIHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function geminiGenerateUrl(env: Env): string {
  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function geminiHeaders(env: Env): HeadersInit {
  return {
    "x-goog-api-key": env.GEMINI_API_KEY,
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
