export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_PROVIDER: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  ACCESS_USERNAME: string;
  ACCESS_PASSWORD: string;
}

type Metadata = {
  client_company?: string;
  client_contact_name?: string;
  michael_manager?: string;
  communication_channel?: string;
  priority?: string;
  next_action?: string;
};

type CrmLink = {
  clientId: number | null;
  contactId: number | null;
  michaelManagerId: number | null;
  clientType: "standard" | "vip";
  requiresContractAppendix: boolean;
};

type FormValue = string | File;

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

    if (!(await isAuthorized(request, env))) {
      return unauthorizedResponse(env);
    }

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
      if (request.method === "GET" && url.pathname === "/api/crm/summary") {
        return json(await getCrmSummary(env));
      }
      if (request.method === "GET" && url.pathname === "/api/email/messages") {
        return json(await listEmailMessages(env));
      }
      if (request.method === "POST" && url.pathname === "/api/email/check") {
        return json({
          imported: 0,
          skipped: 0,
          total_seen: 0,
          detail: "IMAP mailcow/Yandex не поддерживается напрямую в Cloudflare Worker. Нужен отдельный email bridge-сервис.",
        });
      }

      const requestMatch = url.pathname.match(/^\/api\/requests\/(\d+)$/);
      if (request.method === "GET" && requestMatch) {
        const item = await getRequest(env, Number(requestMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const statusMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/status$/);
      if (request.method === "PATCH" && statusMatch) {
        const item = await updateRequestStatus(request, env, Number(statusMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const dealDocsMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/deal-documents$/);
      if (request.method === "PATCH" && dealDocsMatch) {
        const item = await updateDealDocuments(request, env, Number(dealDocsMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const tasksMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks$/);
      if (tasksMatch) {
        const requestId = Number(tasksMatch[1]);
        if (request.method === "GET") return json(await listRequestTasks(env, requestId));
        if (request.method === "POST") {
          const task = await createRequestTask(request, env, requestId);
          return task ? json(task) : json({ detail: "Заявка не найдена." }, 404);
        }
      }

      const taskMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks\/(\d+)$/);
      if (request.method === "PATCH" && taskMatch) {
        const task = await updateRequestTask(request, env, Number(taskMatch[1]), Number(taskMatch[2]));
        return task ? json(task) : json({ detail: "Задача не найдена." }, 404);
      }

      const eventsMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/events$/);
      if (request.method === "GET" && eventsMatch) {
        return json(await listRequestEvents(env, Number(eventsMatch[1])));
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
  if (!isUploadedFile(file)) throw new Error("Файл не передан.");

  const metadata: Metadata = {
    client_company: stringValue(formData.get("client_company")),
    client_contact_name: stringValue(formData.get("client_contact_name")),
    michael_manager: stringValue(formData.get("michael_manager")),
    communication_channel: stringValue(formData.get("communication_channel")),
    priority: stringValue(formData.get("priority")),
    next_action: stringValue(formData.get("next_action")),
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

async function listEmailMessages(env: Env) {
  const result = await env.DB.prepare("SELECT * FROM email_messages ORDER BY created_at DESC LIMIT 100").all();
  return result.results;
}

async function getRequest(env: Env, id: number) {
  return env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
}

async function insertRequest(env: Env, item: Record<string, any>) {
  const crm = await ensureCrmLink(env, item);
  const status = normalizeStatus(item.status);
  const priority = normalizePriority(item.priority);
  const nextAction = normalizeOptionalText(item.next_action);
  const appendixStatus = crm.requiresContractAppendix ? "required" : "not_required";

  const result = await env.DB.prepare(`
    INSERT INTO requests (
      source_type, client_company, client_contact_name, michael_manager,
      communication_channel, original_text, uploaded_file_name, ai_result,
      status, priority, client_type, requires_contract_appendix,
      next_action, client_id, contact_id, michael_manager_id,
      invoice_status, contract_appendix_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      status,
      priority,
      crm.clientType,
      crm.requiresContractAppendix ? 1 : 0,
      nextAction,
      crm.clientId,
      crm.contactId,
      crm.michaelManagerId,
      "not_required",
      appendixStatus,
    )
    .run();
  const requestId = Number(result.meta.last_row_id);
  await createRequestEvent(env, requestId, "request.created", item.michael_manager || "system", {
    source_type: item.source_type,
    status,
    priority,
    client_company: item.client_company || null,
    client_contact_name: item.client_contact_name || null,
    michael_manager: item.michael_manager || null,
    communication_channel: item.communication_channel || null,
    requires_contract_appendix: crm.requiresContractAppendix,
    invoice_status: "not_required",
    contract_appendix_status: appendixStatus,
  });
  await createDefaultTasks(env, requestId, item, crm.requiresContractAppendix);
  return getRequest(env, requestId);
}

async function updateRequestStatus(request: Request, env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    status?: string;
    priority?: string;
    next_action?: string;
    actor?: string;
  };
  const status = normalizeStatus(payload.status || existing.status || "new");
  const priority = normalizePriority(payload.priority || existing.priority || "normal");
  const nextAction = normalizeOptionalText(payload.next_action);
  const actor = normalizeOptionalText(payload.actor) || existing.michael_manager || "system";

  await env.DB.prepare(`
    UPDATE requests
    SET status = ?, priority = ?, next_action = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, priority, nextAction, id).run();

  await createRequestEvent(env, id, "request.status_updated", actor, {
    previous_status: existing.status || "new",
    status,
    priority,
    next_action: nextAction,
  });

  return getRequest(env, id);
}

async function updateDealDocuments(request: Request, env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    invoice_number?: string;
    invoice_date?: string;
    invoice_status?: string;
    contract_appendix_status?: string;
    contract_appendix_note?: string;
    customer_sent_at?: string;
    actor?: string;
  };

  const invoiceNumber = normalizeOptionalText(payload.invoice_number);
  const invoiceDate = normalizeIsoDate(payload.invoice_date);
  const invoiceStatus = normalizeInvoiceStatus(payload.invoice_status || existing.invoice_status || "not_required");
  const appendixStatus = normalizeAppendixStatus(
    payload.contract_appendix_status ||
      existing.contract_appendix_status ||
      (existing.requires_contract_appendix ? "required" : "not_required"),
  );
  const appendixNote = normalizeOptionalText(payload.contract_appendix_note);
  const customerSentAt = normalizeOptionalText(payload.customer_sent_at);
  const actor = normalizeOptionalText(payload.actor) || existing.michael_manager || "system";

  await env.DB.prepare(`
    UPDATE requests
    SET invoice_number = ?,
        invoice_date = ?,
        invoice_status = ?,
        contract_appendix_status = ?,
        contract_appendix_note = ?,
        customer_sent_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    invoiceNumber || null,
    invoiceDate || null,
    invoiceStatus,
    appendixStatus,
    appendixNote || null,
    customerSentAt || null,
    id,
  ).run();

  await createRequestEvent(env, id, "request.deal_documents_updated", actor, {
    invoice_number: invoiceNumber || null,
    invoice_date: invoiceDate || null,
    invoice_status: invoiceStatus,
    contract_appendix_status: appendixStatus,
    contract_appendix_note: appendixNote || null,
    customer_sent_at: customerSentAt || null,
  });

  return getRequest(env, id);
}

async function listRequestEvents(env: Env, requestId: number) {
  const result = await env.DB.prepare(`
    SELECT * FROM request_events
    WHERE request_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).bind(requestId).all();
  return result.results;
}

async function listRequestTasks(env: Env, requestId: number) {
  const result = await env.DB.prepare(`
    SELECT * FROM request_tasks
    WHERE request_id = ?
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
      COALESCE(due_date, '9999-12-31') ASC,
      id ASC
  `).bind(requestId).all();
  return result.results;
}

async function getRequestTask(env: Env, requestId: number, taskId: number) {
  return env.DB.prepare(`
    SELECT * FROM request_tasks
    WHERE request_id = ? AND id = ?
  `).bind(requestId, taskId).first();
}

async function createRequestTask(request: Request, env: Env, requestId: number) {
  const existingRequest = await getRequest(env, requestId);
  if (!existingRequest) return null;

  const payload = (await request.json()) as {
    title?: string;
    status?: string;
    owner_name?: string;
    due_date?: string;
    actor?: string;
  };
  const title = normalizeOptionalText(payload.title);
  if (!title) throw new Error("Название задачи пустое.");

  const status = normalizeTaskStatus(payload.status || "open");
  const ownerName = normalizeOptionalText(payload.owner_name);
  const dueDate = normalizeIsoDate(payload.due_date);
  const completedAt = status === "done" ? new Date().toISOString() : null;
  const actor = normalizeOptionalText(payload.actor) || "manager";

  const result = await env.DB.prepare(`
    INSERT INTO request_tasks (request_id, title, status, owner_name, due_date, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(requestId, title, status, ownerName || null, dueDate || null, completedAt).run();

  const taskId = Number(result.meta.last_row_id);
  await createRequestEvent(env, requestId, "request.task_created", actor, {
    task_id: taskId,
    title,
    status,
    owner_name: ownerName || null,
    due_date: dueDate || null,
  });

  return getRequestTask(env, requestId, taskId);
}

async function updateRequestTask(request: Request, env: Env, requestId: number, taskId: number) {
  const existing = await getRequestTask(env, requestId, taskId) as Record<string, any> | null;
  if (!existing) return null;

  const payload = (await request.json()) as {
    title?: string;
    status?: string;
    owner_name?: string;
    due_date?: string;
    actor?: string;
  };
  const title = normalizeOptionalText(payload.title ?? existing.title);
  if (!title) throw new Error("Название задачи пустое.");

  const status = normalizeTaskStatus(payload.status || existing.status || "open");
  const ownerName = normalizeOptionalText(payload.owner_name ?? existing.owner_name);
  const dueDate = normalizeIsoDate(payload.due_date ?? existing.due_date);
  const completedAt = status === "done" ? (existing.completed_at || new Date().toISOString()) : null;
  const actor = normalizeOptionalText(payload.actor) || "manager";

  await env.DB.prepare(`
    UPDATE request_tasks
    SET title = ?, status = ?, owner_name = ?, due_date = ?, completed_at = ?
    WHERE request_id = ? AND id = ?
  `).bind(title, status, ownerName || null, dueDate || null, completedAt, requestId, taskId).run();

  await createRequestEvent(env, requestId, "request.task_updated", actor, {
    task_id: taskId,
    title,
    previous_status: existing.status || "open",
    status,
    owner_name: ownerName || null,
    due_date: dueDate || null,
    completed_at: completedAt,
  });

  return getRequestTask(env, requestId, taskId);
}

async function createDefaultTasks(
  env: Env,
  requestId: number,
  item: Record<string, any>,
  requiresContractAppendix: boolean,
) {
  const ownerName = normalizeOptionalText(item.michael_manager);
  const tasks = [
    "Проверить наличие и цену с НДС",
    "Подготовить ответ клиенту",
  ];

  if (item.source_type === "audio") {
    tasks.unshift("Проверить транскрибацию голосового сообщения");
  }

  if (requiresContractAppendix) {
    tasks.push("Подготовить счет от ТОО Michael");
    tasks.push("Подготовить приложение к годовому договору");
  }

  for (const title of tasks) {
    await env.DB.prepare(`
      INSERT INTO request_tasks (request_id, title, owner_name)
      VALUES (?, ?, ?)
    `).bind(requestId, title, ownerName || null).run();
  }

  await createRequestEvent(env, requestId, "request.tasks_created", ownerName || "system", {
    count: tasks.length,
    requires_contract_appendix: requiresContractAppendix,
  });
}

async function getCrmSummary(env: Env) {
  const [clients, contacts, managers, openRequests, vipRequests, statusCounts] = await Promise.all([
    env.DB.prepare("SELECT * FROM crm_clients ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM crm_contacts ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM michael_managers ORDER BY display_name ASC LIMIT 100").all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE status NOT IN ('done', 'closed', 'lost')").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE client_type = 'vip'").first(),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM requests GROUP BY status ORDER BY count DESC").all(),
  ]);

  return {
    clients: clients.results,
    contacts: contacts.results,
    managers: managers.results,
    open_requests: Number((openRequests as Record<string, unknown> | null)?.count || 0),
    vip_requests: Number((vipRequests as Record<string, unknown> | null)?.count || 0),
    status_counts: statusCounts.results,
  };
}

async function ensureCrmLink(env: Env, metadata: Metadata): Promise<CrmLink> {
  const company = normalizeOptionalText(metadata.client_company);
  const contactName = normalizeOptionalText(metadata.client_contact_name);
  const managerName = normalizeOptionalText(metadata.michael_manager);
  const clientIsKbi = company ? isKbiEnergy(company) : false;
  const clientType: "standard" | "vip" = clientIsKbi ? "vip" : "standard";
  const contractNote = clientIsKbi
    ? "VIP клиент. Работа по годовому договору; каждый счет должен сопровождаться приложением к договору."
    : null;

  let clientId: number | null = null;
  let contactId: number | null = null;
  let michaelManagerId: number | null = null;

  if (company) {
    const normalized = normalizeKey(company);
    await env.DB.prepare(`
      INSERT INTO crm_clients (display_name, normalized_name, client_type, is_vip, contract_note, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        client_type = CASE
          WHEN crm_clients.client_type = 'vip' OR excluded.client_type = 'vip' THEN 'vip'
          ELSE excluded.client_type
        END,
        is_vip = CASE
          WHEN crm_clients.is_vip = 1 OR excluded.is_vip = 1 THEN 1
          ELSE excluded.is_vip
        END,
        contract_note = COALESCE(excluded.contract_note, crm_clients.contract_note),
        updated_at = datetime('now')
    `).bind(company, normalized, clientType, clientIsKbi ? 1 : 0, contractNote).run();
    const client = await env.DB.prepare("SELECT id FROM crm_clients WHERE normalized_name = ?").bind(normalized).first();
    clientId = client ? Number((client as Record<string, unknown>).id) : null;
  }

  if (clientId && contactName) {
    const normalized = normalizeKey(contactName);
    await env.DB.prepare(`
      INSERT INTO crm_contacts (client_id, display_name, normalized_name, channel_hint, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(client_id, normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        channel_hint = COALESCE(excluded.channel_hint, crm_contacts.channel_hint),
        updated_at = datetime('now')
    `).bind(clientId, contactName, normalized, metadata.communication_channel || null).run();
    const contact = await env.DB.prepare(`
      SELECT id FROM crm_contacts WHERE client_id = ? AND normalized_name = ?
    `).bind(clientId, normalized).first();
    contactId = contact ? Number((contact as Record<string, unknown>).id) : null;
  }

  if (managerName) {
    const normalized = normalizeKey(managerName);
    await env.DB.prepare(`
      INSERT INTO michael_managers (display_name, normalized_name, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = datetime('now')
    `).bind(managerName, normalized).run();
    const manager = await env.DB.prepare("SELECT id FROM michael_managers WHERE normalized_name = ?").bind(normalized).first();
    michaelManagerId = manager ? Number((manager as Record<string, unknown>).id) : null;
  }

  return {
    clientId,
    contactId,
    michaelManagerId,
    clientType,
    requiresContractAppendix: clientIsKbi,
  };
}

async function createRequestEvent(
  env: Env,
  requestId: number,
  eventType: string,
  actor: string,
  payload: Record<string, unknown>,
) {
  await env.DB.prepare(`
    INSERT INTO request_events (request_id, event_type, actor, payload_json)
    VALUES (?, ?, ?, ?)
  `).bind(requestId, eventType, actor, JSON.stringify(payload)).run();
}

function buildContextPrefix(metadata: Metadata): string {
  const parts = [
    metadata.client_company ? `Компания клиента: ${metadata.client_company}` : "",
    metadata.client_contact_name ? `Контакт/менеджер клиента: ${metadata.client_contact_name}` : "",
    metadata.michael_manager ? `Менеджер Michael: ${metadata.michael_manager}` : "",
    metadata.communication_channel ? `Канал связи: ${metadata.communication_channel}` : "",
    metadata.priority ? `Приоритет: ${metadata.priority}` : "",
    metadata.next_action ? `Следующее действие: ${metadata.next_action}` : "",
  ].filter(Boolean);
  return parts.length ? `Контекст заявки:\n${parts.join("\n")}\n\n` : "";
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function isKbiEnergy(company: string): boolean {
  const normalized = normalizeKey(company);
  return normalized.includes("kbi energy") || normalized.includes("кби энерджи");
}

function normalizeStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "new";
  const allowed = new Set([
    "new",
    "in_progress",
    "need_clarification",
    "reply_ready",
    "quote_sent",
    "invoice_required",
    "invoice_sent",
    "done",
    "closed",
    "lost",
  ]);
  return allowed.has(normalized) ? normalized : "new";
}

function normalizePriority(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "normal";
  return ["low", "normal", "high", "urgent"].includes(normalized) ? normalized : "normal";
}

function normalizeInvoiceStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "not_required";
  const allowed = ["not_required", "required", "prepared", "sent", "paid", "cancelled"];
  return allowed.includes(normalized) ? normalized : "not_required";
}

function normalizeAppendixStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "not_required";
  const allowed = ["not_required", "required", "prepared", "sent", "signed", "cancelled"];
  return allowed.includes(normalized) ? normalized : "not_required";
}

function normalizeTaskStatus(value: unknown): string {
  const normalized = normalizeOptionalText(value) || "open";
  return ["open", "done", "cancelled"].includes(normalized) ? normalized : "open";
}

function normalizeIsoDate(value: unknown): string {
  const normalized = normalizeOptionalText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
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

function stringValue(value: FormValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUploadedFile(value: FormValue | null): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      "arrayBuffer" in value &&
      typeof value.arrayBuffer === "function",
  );
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

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.ACCESS_PASSWORD) return false;

  const authorization = request.headers.get("Authorization") || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  const expectedUsername = env.ACCESS_USERNAME || "manager";

  return (await safeEquals(username, expectedUsername)) && (await safeEquals(password, env.ACCESS_PASSWORD));
}

async function safeEquals(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const actualHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(actual)));
  const expectedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(expected)));

  let diff = actualHash.length ^ expectedHash.length;
  const length = Math.max(actualHash.length, expectedHash.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (actualHash[index] || 0) ^ (expectedHash[index] || 0);
  }
  return diff === 0;
}

function unauthorizedResponse(env: Env): Response {
  const body = env.ACCESS_PASSWORD
    ? "Нужен логин и пароль для доступа к ИИ-менеджеру."
    : "ACCESS_PASSWORD не задан. Установите Cloudflare Worker secret ACCESS_PASSWORD.";

  return new Response(body, {
    status: 401,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Sales AI Manager", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
