export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_PROVIDER: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_TRANSCRIBE_MODEL: string;
  GEMINI_FALLBACK_MODELS: string;
  GEMINI_RETRY_ATTEMPTS: string;
  GEMINI_RETRY_BASE_DELAY_MS: string;
  PARSER_SERVICE_URL: string;
  PARSER_SERVICE_TOKEN: string;
  EMAIL_BRIDGE_URL: string;
  EMAIL_BRIDGE_TOKEN: string;
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

type CurrentUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
};

type FormValue = string | File;

type ParsedDocumentPage = {
  page_number?: number;
  text?: string;
  image_base64?: string;
  image_mime_type?: string;
  image_data_url?: string;
};

type ParsedDocument = {
  text?: string;
  pages?: ParsedDocumentPage[];
  parser?: string;
  warnings?: string[];
  filename?: string;
  extension?: string;
};

type ParsedImagePage = {
  pageNumber: number;
  payload: FilePayload;
};

const SESSION_COOKIE_NAME = "sales_ai_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

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
- Если входящий документ является счетом на оплату, в разделе B обязательно извлечь все строки табличной части без сокращений.
- Для счета в разделе B обязательно указать таблицу с колонками: Код, Наименование, Ед. изм., Кол-во, Цена с НДС 16%, Сумма с НДС 16%, Гарантия.
- Код товара, количество, цена и сумма из счета являются юридически значимыми данными для приложения к договору; нельзя заменять их словом «уточняется», если они видны в документе.

${REQUIRED_OUTPUT}
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);

    try {
      await ensureInitialUser(env);

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const user = await authenticateRequest(request, env);
        return json({ user });
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return login(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return logout(request, env);
      }

      const currentUser = await authenticateRequest(request, env);
      if (!currentUser) return json({ detail: "Нужно войти в программу." }, 401);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ status: "ok", runtime: "cloudflare-workers" });
      }
      if (request.method === "GET" && url.pathname === "/api/parser/health") {
        return json(await checkParserService(env));
      }
      if (request.method === "GET" && url.pathname === "/api/users") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await listUsers(env));
      }
      if (request.method === "POST" && url.pathname === "/api/users") {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await createUser(request, env));
      }
      const userPasswordMatch = url.pathname.match(/^\/api\/users\/(\d+)\/password$/);
      if (request.method === "PATCH" && userPasswordMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const user = await resetUserPassword(request, env, Number(userPasswordMatch[1]));
        return user ? json(user) : json({ detail: "Пользователь не найден." }, 404);
      }
      const userActiveMatch = url.pathname.match(/^\/api\/users\/(\d+)\/active$/);
      if (request.method === "PATCH" && userActiveMatch) {
        if (!isAdmin(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const userId = Number(userActiveMatch[1]);
        if (userId === currentUser.id) return json({ detail: "Нельзя отключить текущего пользователя." }, 400);
        const payload = (await request.json()) as { is_active?: unknown };
        if (typeof payload.is_active !== "boolean") return json({ detail: "Передайте is_active true/false." }, 400);
        const user = await updateUserActive(env, userId, payload.is_active);
        return user ? json(user) : json({ detail: "Пользователь не найден." }, 404);
      }
      if (request.method === "GET" && url.pathname === "/api/requests") {
        return json(await listRequests(env));
      }
      if (request.method === "GET" && url.pathname === "/api/tasks/open") {
        return json(await listOpenTasks(env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/text") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await processText(request, env));
      }
      if (request.method === "POST" && url.pathname === "/api/requests/upload") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await processUpload(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/crm/summary") {
        return json(await getCrmSummary(env));
      }
      if (request.method === "GET" && url.pathname === "/api/email/messages") {
        return json(await listEmailMessages(env));
      }
      if (request.method === "GET" && url.pathname === "/api/email/smtp/health") {
        return json(await checkEmailBridge(env));
      }
      if (request.method === "POST" && url.pathname === "/api/email/check") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json({
          imported: 0,
          skipped: 0,
          total_seen: 0,
          detail: "IMAP mailcow/Yandex не поддерживается напрямую в Cloudflare Worker. Нужен отдельный email bridge-сервис.",
        });
      }
      if (request.method === "POST" && url.pathname === "/api/email/send") {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        return json(await sendEmailReply(request, env, currentUser));
      }

      const emailProcessMatch = url.pathname.match(/^\/api\/email\/messages\/(\d+)\/process$/);
      if (request.method === "POST" && emailProcessMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await processEmailMessage(env, Number(emailProcessMatch[1]));
        return item ? json(item) : json({ detail: "Письмо не найдено." }, 404);
      }

      const requestMatch = url.pathname.match(/^\/api\/requests\/(\d+)$/);
      if (request.method === "GET" && requestMatch) {
        const item = await getRequest(env, Number(requestMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }
      if (request.method === "DELETE" && requestMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const result = await deleteRequest(env, Number(requestMatch[1]));
        return result ? json(result) : json({ detail: "Заявка не найдена." }, 404);
      }

      const statusMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/status$/);
      if (request.method === "PATCH" && statusMatch) {
        if (!canManageRequests(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await updateRequestStatus(request, env, Number(statusMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const dealDocsMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/deal-documents$/);
      if (request.method === "PATCH" && dealDocsMatch) {
        if (!canManageDocuments(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const item = await updateDealDocuments(request, env, Number(dealDocsMatch[1]));
        return item ? json(item) : json({ detail: "Заявка не найдена." }, 404);
      }

      const appendixMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/contract-appendix$/);
      if (request.method === "POST" && appendixMatch) {
        if (!canManageDocuments(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
        const appendix = await generateContractAppendix(env, Number(appendixMatch[1]), currentUser);
        return appendix ? json(appendix) : json({ detail: "Заявка не найдена." }, 404);
      }

      const tasksMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks$/);
      if (tasksMatch) {
        const requestId = Number(tasksMatch[1]);
        if (request.method === "GET") return json(await listRequestTasks(env, requestId));
        if (request.method === "POST") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const task = await createRequestTask(request, env, requestId);
          return task ? json(task) : json({ detail: "Заявка не найдена." }, 404);
        }
      }

      const taskMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/tasks\/(\d+)$/);
      if (taskMatch) {
        if (request.method === "PATCH") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const task = await updateRequestTask(request, env, Number(taskMatch[1]), Number(taskMatch[2]));
          return task ? json(task) : json({ detail: "Задача не найдена." }, 404);
        }
        if (request.method === "DELETE") {
          if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
          const result = await deleteRequestTask(env, Number(taskMatch[1]), Number(taskMatch[2]), currentUser);
          return result ? json(result) : json({ detail: "Задача не найдена." }, 404);
        }
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

async function ensureInitialUser(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_users").first() as Record<string, unknown> | null;
  if (Number(row?.count || 0) > 0) return;
  if (!env.ACCESS_PASSWORD) throw new Error("ACCESS_PASSWORD не задан. Нельзя создать первого пользователя.");

  const username = normalizeUsername(env.ACCESS_USERNAME || "manager");
  const password = await hashPassword(env.ACCESS_PASSWORD);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO app_users (username, display_name, role, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?)
  `).bind(username, "Администратор", "admin", password.hash, password.salt).run();
}

async function login(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as { username?: string; password?: string };
  const username = normalizeUsername(payload.username || "");
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!username || !password) return json({ detail: "Введите имя пользователя и пароль." }, 400);

  const user = await env.DB.prepare(`
    SELECT * FROM app_users WHERE username = ? AND is_active = 1
  `).bind(username).first() as Record<string, any> | null;

  if (!user || !(await verifyPassword(password, String(user.password_salt), String(user.password_hash)))) {
    return json({ detail: "Неверное имя пользователя или пароль." }, 401);
  }

  const token = generateSessionToken();
  const tokenHash = await sha256Base64(token);
  const expiresAt = toSqlDateTime(new Date(Date.now() + SESSION_TTL_SECONDS * 1000));

  await env.DB.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(Number(user.id), tokenHash, expiresAt).run();
  await env.DB.prepare(`
    UPDATE app_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).bind(Number(user.id)).run();

  const currentUser = userToCurrentUser(user);
  return jsonWithHeaders({ user: currentUser }, 200, {
    "Set-Cookie": buildSessionCookie(request, token, SESSION_TTL_SECONDS),
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (token) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256Base64(token)).run();
  }
  return jsonWithHeaders({ ok: true }, 200, {
    "Set-Cookie": buildSessionCookie(request, "", 0),
  });
}

async function authenticateRequest(request: Request, env: Env): Promise<CurrentUser | null> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const tokenHash = await sha256Base64(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM auth_sessions s
    INNER JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > datetime('now')
      AND u.is_active = 1
  `).bind(tokenHash).first() as Record<string, any> | null;
  if (!row) return null;

  await env.DB.prepare(`
    UPDATE auth_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?
  `).bind(tokenHash).run();

  return userToCurrentUser(row);
}

async function listUsers(env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at
    FROM app_users
    ORDER BY id ASC
  `).all();
  return result.results;
}

async function createUser(request: Request, env: Env) {
  const payload = (await request.json()) as {
    username?: string;
    display_name?: string;
    role?: string;
    password?: string;
  };
  const username = normalizeUsername(payload.username || "");
  const displayName = normalizeOptionalText(payload.display_name) || username;
  const role = normalizeRole(payload.role);
  const passwordValue = typeof payload.password === "string" ? payload.password : "";
  if (!username) throw new Error("Имя пользователя пустое.");
  if (passwordValue.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");

  const password = await hashPassword(passwordValue);
  const result = await env.DB.prepare(`
    INSERT INTO app_users (username, display_name, role, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?)
  `).bind(username, displayName, role, password.hash, password.salt).run();
  const id = Number(result.meta.last_row_id);
  return env.DB.prepare(`
    SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(id).first();
}

async function resetUserPassword(request: Request, env: Env, userId: number) {
  const payload = (await request.json()) as { password?: string };
  const passwordValue = typeof payload.password === "string" ? payload.password : "";
  if (passwordValue.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");

  const password = await hashPassword(passwordValue);
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET password_hash = ?, password_salt = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(password.hash, password.salt, userId).run();
  if (!result.meta.changes) return null;
  await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  return env.DB.prepare(`
    SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(userId).first();
}

async function updateUserActive(env: Env, userId: number, isActive: boolean) {
  const result = await env.DB.prepare(`
    UPDATE app_users
    SET is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(isActive ? 1 : 0, userId).run();
  if (!result.meta.changes) return null;

  if (!isActive) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  }

  return env.DB.prepare(`
    SELECT id, username, display_name, role, is_active, created_at, updated_at, last_login_at
    FROM app_users WHERE id = ?
  `).bind(userId).first();
}

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
  } else if (isDocument(lowerName)) {
    if (isPdf(lowerName) && useGemini(env) && !isParserServiceConfigured(env)) {
      const filePayload = await fileToPayload(file);
      originalText = `${context}PDF-файл обработан напрямую через Gemini: ${fileName}`;
      if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;
      aiResult = await analyzePdfGemini(env, filePayload, fileName, `${context}${managerNote}`.trim());
    } else {
      const parsed = await parseDocumentWithService(env, file);
      const parsedText = parsedDocumentText(parsed);
      const warningsText = parsed.warnings?.length
        ? `\n\nПредупреждения parser-service:\n${parsed.warnings.join("\n")}`
        : "";
      originalText = `${context}Файл: ${fileName}\nParser: ${parsed.parser || "parser-service"}${warningsText}`;
      if (managerNote) originalText += `\n\nПояснение менеджера:\n${managerNote}`;

      if (parsedText) {
        originalText += `\n\nИзвлеченный текст:\n${limitText(parsedText, 120000)}`;
        aiResult = await analyzeText(env, originalText);
      } else {
        const imagePages = parsedImagePages(parsed);
        if (!imagePages.length) {
          throw new Error("Parser service не нашел текст и не вернул изображения страниц для vision-анализа.");
        }
        originalText += `\n\nДокумент похож на скан. Parser service вернул ${imagePages.length} страниц для vision-анализа.`;
        aiResult = await analyzeDocumentImages(env, imagePages, fileName, `${context}${managerNote}`.trim());
      }
    }
  } else {
    const text = await file.text().catch(() => "");
    originalText = `${context}Файл: ${fileName}\n\n${managerNote ? `Пояснение менеджера:\n${managerNote}\n\n` : ""}${text || "Текст файла не извлечен. Поддерживаются изображения, голосовые файлы и документы PDF/DOCX/XLSX через parser-service."}`;
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

async function checkParserService(env: Env) {
  const baseUrl = (env.PARSER_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      status: "not_configured",
      detail: "PARSER_SERVICE_URL не задан.",
    };
  }

  let serviceOrigin = baseUrl;
  try {
    serviceOrigin = new URL(baseUrl).origin;
  } catch {
    return {
      configured: true,
      reachable: false,
      status: "invalid_url",
      detail: "PARSER_SERVICE_URL задан в неверном формате.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = new Headers();
    if (env.PARSER_SERVICE_TOKEN) headers.set("X-Parser-Token", env.PARSER_SERVICE_TOKEN);

    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: "error",
        service_origin: serviceOrigin,
        detail: data?.detail || raw || response.statusText,
      };
    }

    return {
      configured: true,
      reachable: true,
      status: data?.status || "ok",
      service: data?.service || "parser-service",
      service_origin: serviceOrigin,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parser-service недоступен.";
    return {
      configured: true,
      reachable: false,
      status: "unreachable",
      service_origin: serviceOrigin,
      detail: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkEmailBridge(env: Env) {
  const baseUrl = (env.EMAIL_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      configured: false,
      reachable: false,
      status: "not_configured",
      detail: "EMAIL_BRIDGE_URL не задан.",
    };
  }

  let serviceOrigin = baseUrl;
  try {
    serviceOrigin = new URL(baseUrl).origin;
  } catch {
    return {
      configured: true,
      reachable: false,
      status: "invalid_url",
      detail: "EMAIL_BRIDGE_URL задан в неверном формате.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = new Headers();
    if (env.EMAIL_BRIDGE_TOKEN) headers.set("X-Email-Bridge-Token", env.EMAIL_BRIDGE_TOKEN);

    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        status: "error",
        service_origin: serviceOrigin,
        detail: data?.detail || raw || response.statusText,
      };
    }

    return {
      configured: true,
      reachable: true,
      status: data?.status || "ok",
      service: data?.service || "email-bridge",
      service_origin: serviceOrigin,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email bridge недоступен.";
    return {
      configured: true,
      reachable: false,
      status: "unreachable",
      service_origin: serviceOrigin,
      detail: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendEmailReply(request: Request, env: Env, currentUser: CurrentUser) {
  const payload = (await request.json()) as {
    request_id?: number;
    to?: string;
    subject?: string;
    body?: string;
  };
  const to = normalizeOptionalText(payload.to);
  const subject = normalizeOptionalText(payload.subject);
  const body = normalizeOptionalText(payload.body);
  const requestId = Number(payload.request_id || 0);

  if (!to || !to.includes("@")) throw new Error("Укажите email получателя.");
  if (!subject) throw new Error("Тема письма пустая.");
  if (!body) throw new Error("Текст письма пустой.");

  const baseUrl = (env.EMAIL_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("EMAIL_BRIDGE_URL не задан. Для SMTP-отправки запустите email-bridge и укажите его URL в настройках Worker.");
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.EMAIL_BRIDGE_TOKEN) headers.set("X-Email-Bridge-Token", env.EMAIL_BRIDGE_TOKEN);

  const response = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, subject, body }),
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(`Ошибка email-bridge: ${data?.detail || raw || response.statusText}`);
  }

  if (requestId) {
    const existing = await getRequest(env, requestId);
    if (existing) {
      await createRequestEvent(env, requestId, "email.sent", currentUser.display_name || currentUser.username, {
        to,
        subject,
        bridge_status: data?.status || "sent",
      });
    }
  }

  return {
    sent: true,
    to,
    subject,
    detail: data?.detail || "Письмо отправлено через email-bridge.",
  };
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

async function analyzeDocumentImages(
  env: Env,
  pages: ParsedImagePage[],
  fileName: string,
  managerNote: string,
): Promise<string> {
  if (useGemini(env)) {
    return analyzeDocumentImagesGemini(env, pages, fileName, managerNote);
  }

  requireOpenAI(env);
  const content: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: `Проанализируй страницы документа как входящую B2B-заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
    },
  ];
  for (const page of pages) {
    content.push({ type: "input_text", text: `Страница ${page.pageNumber}` });
    content.push({ type: "input_image", image_url: page.payload.dataUrl });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.5",
      instructions: SYSTEM_PROMPT,
      input: [{ role: "user", content }],
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
  const response = await fetchGeminiGenerateContent(env, {
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
  });
  return readGeminiText(response);
}

async function analyzeImageGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  const response = await fetchGeminiGenerateContent(env, {
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
  });
  return readGeminiText(response);
}

async function analyzePdfGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  if (filePayload.base64.length > 28_000_000) {
    throw new Error("PDF слишком большой для прямой обработки через Gemini. Настройте parser-service или загрузите файл меньше 20 МБ.");
  }

  const response = await fetchGeminiInteractions(env, {
    input: [
      {
        type: "text",
        text: `${SYSTEM_PROMPT}\n\nПроанализируй PDF-документ как входящую B2B-заявку или счет. Если это счет на оплату, точно извлеки все строки товара: код, наименование, единицу измерения, количество, цену с НДС 16%, сумму с НДС 16% и гарантию. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
      },
      {
        type: "document",
        data: filePayload.base64,
        mime_type: "application/pdf",
      },
    ],
  });
  return readGeminiInteractionText(response);
}

async function analyzeDocumentImagesGemini(
  env: Env,
  pages: ParsedImagePage[],
  fileName: string,
  managerNote: string,
): Promise<string> {
  requireGemini(env);
  const parts: Array<Record<string, unknown>> = [
    {
      text: `Проанализируй страницы документа как входящую B2B-заявку. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
    },
  ];
  for (const page of pages) {
    parts.push({ text: `Страница ${page.pageNumber}` });
    parts.push({
      inline_data: {
        mime_type: page.payload.mimeType,
        data: page.payload.base64,
      },
    });
  }

  const response = await fetchGeminiGenerateContent(env, {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts }],
  });
  return readGeminiText(response);
}

async function transcribeAudioGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  const response = await fetchGeminiGenerateContent(
    env,
    {
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
    },
    env.GEMINI_TRANSCRIBE_MODEL,
  );
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
  if (!response.ok) throw new Error(formatGeminiError("Gemini API", response.status, raw));
  const data = JSON.parse(raw);
  const text = data.candidates?.flatMap((candidate: any) => candidate.content?.parts || [])
    ?.map((part: any) => part.text || "")
    ?.join("\n")
    ?.trim();
  if (!text) throw new Error("Gemini API вернул пустой ответ.");
  return text;
}

async function readGeminiInteractionText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(formatGeminiError("Gemini Interactions API", response.status, raw));
  const data = JSON.parse(raw);
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  if (typeof data.outputText === "string" && data.outputText.trim()) return data.outputText.trim();

  const lastStep = Array.isArray(data.steps) ? data.steps[data.steps.length - 1] : null;
  const stepText = Array.isArray(lastStep?.content)
    ? lastStep.content.map((part: any) => part?.text || "").join("\n").trim()
    : "";
  if (stepText) return stepText;

  const outputText = Array.isArray(data.outputs)
    ? data.outputs.map((part: any) => part?.text || "").join("\n").trim()
    : "";
  if (outputText) return outputText;

  throw new Error("Gemini Interactions API вернул пустой ответ.");
}

async function listRequests(env: Env) {
  const result = await env.DB.prepare(`
    SELECT
      r.*,
      COALESCE(task_counts.open_task_count, 0) AS open_task_count,
      COALESCE(task_counts.done_task_count, 0) AS done_task_count,
      COALESCE(task_counts.total_task_count, 0) AS total_task_count
    FROM requests r
    LEFT JOIN (
      SELECT
        request_id,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_task_count,
        COUNT(*) AS total_task_count
      FROM request_tasks
      GROUP BY request_id
    ) task_counts ON task_counts.request_id = r.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();
  return result.results;
}

async function listEmailMessages(env: Env) {
  const result = await env.DB.prepare("SELECT * FROM email_messages ORDER BY created_at DESC LIMIT 100").all();
  return result.results;
}

async function getEmailMessage(env: Env, id: number) {
  return env.DB.prepare("SELECT * FROM email_messages WHERE id = ?").bind(id).first() as Promise<Record<string, any> | null>;
}

async function processEmailMessage(env: Env, emailId: number) {
  const emailItem = await getEmailMessage(env, emailId);
  if (!emailItem) return null;

  if (emailItem.processed_request_id) {
    const existing = await getRequest(env, Number(emailItem.processed_request_id));
    if (existing) return existing;
  }

  const emailText = buildEmailAnalysisText(emailItem);
  const clientCompany = detectKbiEnergy(emailText) ? "ТОО KBI Energy" : "";
  const metadata: Metadata = {
    client_company: clientCompany,
    client_contact_name: normalizeOptionalText(emailItem.from_address),
    michael_manager: normalizeOptionalText(emailItem.michael_manager),
    communication_channel: "Email",
    priority: clientCompany ? "high" : "normal",
    next_action: "Подготовить ответ клиенту",
  };
  const originalText = `${buildContextPrefix(metadata)}${emailText}`;
  const aiResult = await analyzeText(env, originalText);

  const item = await insertRequest(env, {
    source_type: "email",
    ...metadata,
    original_text: originalText,
    uploaded_file_name: emailItem.attachment_names || null,
    ai_result: aiResult,
  }) as Record<string, any> | null;

  if (!item?.id) throw new Error("Не удалось создать заявку из письма.");

  await env.DB.prepare(`
    UPDATE email_messages
    SET processed_request_id = ?
    WHERE id = ?
  `).bind(Number(item.id), emailId).run();

  await createRequestEvent(env, Number(item.id), "email.processed", metadata.michael_manager || "system", {
    email_id: emailId,
    from_address: emailItem.from_address || null,
    mailbox_email: emailItem.mailbox_email || null,
    subject: emailItem.subject || null,
  });

  return getRequest(env, Number(item.id));
}

function buildEmailAnalysisText(emailItem: Record<string, any>): string {
  const parts = [
    "Входящее письмо из почтового ящика Michael.",
    `От: ${emailItem.from_address || "уточняется"}`,
    `Кому: ${emailItem.to_address || "уточняется"}`,
    `Почтовый ящик Michael: ${emailItem.mailbox_email || "уточняется"}`,
    `Ответственный менеджер Michael: ${emailItem.michael_manager || "уточняется"}`,
    `Тема: ${emailItem.subject || "без темы"}`,
    `Дата письма: ${emailItem.received_at || "уточняется"}`,
    "",
    "Тело письма:",
    emailItem.body_text || "уточняется",
  ];
  if (emailItem.attachment_names) parts.push("", "Вложения:", emailItem.attachment_names);
  if (emailItem.attachment_text) parts.push("", "Текст из поддерживаемых вложений:", emailItem.attachment_text);
  return parts.join("\n");
}

async function getRequest(env: Env, id: number) {
  return env.DB.prepare(`
    SELECT
      r.*,
      COALESCE(task_counts.open_task_count, 0) AS open_task_count,
      COALESCE(task_counts.done_task_count, 0) AS done_task_count,
      COALESCE(task_counts.total_task_count, 0) AS total_task_count
    FROM requests r
    LEFT JOIN (
      SELECT
        request_id,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_task_count,
        COUNT(*) AS total_task_count
      FROM request_tasks
      GROUP BY request_id
    ) task_counts ON task_counts.request_id = r.id
    WHERE r.id = ?
  `).bind(id).first();
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

async function deleteRequest(env: Env, id: number) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE email_messages
    SET processed_request_id = NULL
    WHERE processed_request_id = ?
  `).bind(id).run();
  await env.DB.prepare("DELETE FROM request_tasks WHERE request_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM request_events WHERE request_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(id).run();

  return { ok: true, request_id: id };
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

async function generateContractAppendix(env: Env, id: number, currentUser: CurrentUser) {
  const existing = await getRequest(env, id) as Record<string, any> | null;
  if (!existing) return null;

  const appendix = buildContractAppendix(existing);
  const actor = currentUser.display_name || currentUser.username || existing.michael_manager || "system";
  const generatedAt = new Date().toISOString();
  const eventNote = `Приложение сформировано ${generatedAt} по заявке #${id}.`;
  const previousNote = normalizeOptionalText(existing.contract_appendix_note);
  const nextNote = previousNote ? `${previousNote}\n${eventNote}` : eventNote;

  await env.DB.prepare(`
    UPDATE requests
    SET contract_appendix_status = ?,
        contract_appendix_note = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind("prepared", nextNote, id).run();

  await createRequestEvent(env, id, "request.contract_appendix_generated", actor, {
    file_name: appendix.file_name,
    invoice_number: existing.invoice_number || null,
    invoice_date: existing.invoice_date || null,
    generated_at: generatedAt,
  });

  return {
    ...appendix,
    request: await getRequest(env, id),
  };
}

function buildContractAppendix(item: Record<string, any>) {
  const requestId = Number(item.id || 0);
  const sourceText = [
    normalizeOptionalText(item.ai_result),
    normalizeOptionalText(item.original_text),
  ].filter(Boolean).join("\n\n");
  const invoiceNumber = normalizeOptionalText(item.invoice_number) || extractInvoiceNumber(sourceText) || "уточняется";
  const invoiceDate = normalizeOptionalText(item.invoice_date) || extractInvoiceDate(sourceText) || "уточняется";
  const data = buildKbiAppendixData(item, requestId, invoiceNumber, invoiceDate);

  return {
    appendix_text: buildKbiAppendixText(data),
    appendix_html: buildAppendixHtml(data),
    file_name: buildAppendixFileName(requestId, invoiceNumber, "KBI-Energy-Group"),
  };
}

type AppendixTableRow = {
  number: number;
  code: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  sum: string;
  warranty: string;
  sumValue: number | null;
};

type KbiAppendixData = {
  requestId: number;
  appendixDateRu: string;
  contractNumber: string;
  contractDateRu: string;
  rows: AppendixTableRow[];
  totalText: string;
  totalWords: string;
  paymentTerm: string;
  deliveryPlace: string;
};

const KBI_CONTRACT_NUMBER = "71-02-26/СН";
const KBI_CONTRACT_DATE_RU = "17 февраля 2026 года";
const KBI_DEFAULT_DELIVERY_PLACE = "DDP, г. Экибастуз.";
const KBI_DEFAULT_PAYMENT_TERM = "20 календарных дней с момента получения Товара.";
const KBI_DEFAULT_WARRANTY = "14 дней";
const KBI_BUYER_SIGNATORY = "Абдрахманов Д.Е.";
const MICHAEL_SUPPLIER_SIGNATORY = "Эйрих М.М.";

const KBI_BUYER_REQUISITES = [
  "Покупатель:",
  "ТОО «KBI Energy Group»",
  "БИН 060340017540",
  "юридический адрес:",
  "010000, Республика Казахстан,",
  "г. Астана, район Нура",
  "ул. Кайым Мухамедханова",
  "здание 5 н.п. 43",
  "фактический адрес:",
  "S15F6F4, Павлодарская область,",
  "г. Экибастуз, ул. Железнодорожная строение 28",
  "Свидетельство по НДС",
  "Серии 62001 от 1044193 от 24.07.2023г.",
  "Банковские реквизиты:",
  "АО «Народный банк Казахстана»",
  "ИИК KZ76601A361000707821 KZT",
  "БИК HSBKKZKX",
  "тел: 8 (7187) 278-543",
  "эл.почта: too_kbc@mail.ru",
];

const MICHAEL_SUPPLIER_REQUISITES = [
  "Поставщик:",
  "ТОО «Michael»",
  "БИН 170940023817",
  "Юридический и фактический адрес:",
  "141200, Республика Казахстан,",
  "Павлодарская обл., г. Экибастуз,",
  "ул. Абая, здание 60/1, офис 113",
  "Банковские реквизиты:",
  "Банк: АО \"ForteBank\"",
  "БИК IRTYKZKA",
  "ИИК KZ0396506F0007735246",
  "Свидетельство НДС Серия 45001 № 0057470 от",
  "20 сентября 2017 года.",
  "Телефоны: +7(7187) 74-08-64",
  "+77775550016",
  "Эл.почта: direktor@edel.kz",
];

function buildKbiAppendixData(
  item: Record<string, any>,
  requestId: number,
  invoiceNumber: string,
  invoiceDate: string,
): KbiAppendixData {
  const sourceText = [
    normalizeOptionalText(item.ai_result),
    normalizeOptionalText(item.original_text),
    invoiceNumber !== "уточняется" ? `Номер счета: ${invoiceNumber}` : "",
    invoiceDate !== "уточняется" ? `Дата счета: ${invoiceDate}` : "",
  ].filter(Boolean).join("\n\n");
  const rows = parseAppendixRows(sourceText);
  const appendixRows = rows;
  const totalValue = appendixRows.reduce((sum, row) => row.sumValue !== null ? sum + row.sumValue : sum, 0);
  const hasTotal = appendixRows.some((row) => row.sumValue !== null);
  const totalText = hasTotal ? formatMoney(totalValue) : "________";

  return {
    requestId,
    appendixDateRu: formatRuDate(invoiceDate) || formatRuDate(new Date().toISOString().slice(0, 10)) || "____ __________ ____ года",
    contractNumber: KBI_CONTRACT_NUMBER,
    contractDateRu: KBI_CONTRACT_DATE_RU,
    rows: appendixRows,
    totalText,
    totalWords: hasTotal ? capitalizeFirst(moneyToRussianWords(totalValue)) : "________________",
    deliveryPlace: extractDeliveryPlace(sourceText) || KBI_DEFAULT_DELIVERY_PLACE,
    paymentTerm: extractPaymentTerm(sourceText) || KBI_DEFAULT_PAYMENT_TERM,
  };
}

function extractAiSection(value: string, letter: string): string {
  if (!value) return "";
  const escapedLetter = letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedLetter}\\.\\s[\\s\\S]*?(?=^[A-F]\\.\\s|$)`, "m");
  const match = value.match(pattern);
  return match ? match[0].trim() : "";
}

function cleanAiSectionTitle(value: string): string {
  return value.replace(/^[A-F]\.\s+[^\n]+\n*/u, "").trim();
}

function parseAppendixRows(sourceText: string): AppendixTableRow[] {
  const numberedRows = parseNumberedSpecificationRows(sourceText);
  if (numberedRows.length) return numberedRows;

  const markdownRows = parseMarkdownTableRows(sourceText);
  if (markdownRows.length) return markdownRows;

  const sectionB = cleanAiSectionTitle(extractAiSection(sourceText, "B"));
  const source = sectionB || sourceText;
  const name = firstMatch(source, [
    /Наименование(?: товара)?\s*[:\-]\s*([^\n]+)/i,
    /Товар\s*[:\-]\s*([^\n]+)/i,
    /Номенклатура\s*[:\-]\s*([^\n]+)/i,
  ]);
  const quantity = firstMatch(source, [
    /Кол-?во\s*[:\-]\s*([^\n]+)/i,
    /Количество(?: по запросу клиента)?\s*[:\-]\s*([^\n]+)/i,
  ]);
  const price = firstMatch(source, [
    /Цена(?: за ед\.? изм\.?)?(?:[^:\n]*НДС[^:\n]*)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
    /Цена с НДС\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
  ]);
  const sum = firstMatch(source, [
    /Сумма(?: с НДС[^:\n]*)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
    /Итого(?: с НДС)?\s*[:\-]\s*([0-9][0-9\s.,]*)/i,
  ]);
  const unit = firstMatch(source, [
    /Ед\.?\s*изм\.?\s*[:\-]\s*([^\n]+)/i,
    /Единица измерения\s*[:\-]\s*([^\n]+)/i,
  ]) || unitFromQuantity(quantity);
  const code = firstMatch(source, [
    /Код\s*[:\-]\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /Артикул\s*[:\-]\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
  ]);
  const warranty = firstMatch(source, [/Гарантия\s*[:\-]\s*([^\n]+)/i]) || KBI_DEFAULT_WARRANTY;
  const computedSum = sum || computeRowSum(quantity, price);

  if (!name && !code) return [];

  return [
    makeAppendixRow(1, {
      code,
      name,
      unit,
      quantity,
      price,
      sum: computedSum,
      warranty,
    }),
  ];
}

function parseNumberedSpecificationRows(sourceText: string): AppendixTableRow[] {
  const codeRows = parseCodeRows(sourceText);
  const rows: AppendixTableRow[] = [];
  const linePattern = /^\s*(\d+)\.\s+\*?(.+?)\*?\s+—\s+\*\*?([0-9\s.,]+)\s*([A-Za-zА-Яа-я.]+)\.?\*?\*?\s+—\s+Цена:\s*([0-9\s.,]+)[^\n—]*(?:—\s+Сумма:\s*([0-9\s.,]+))?/gim;
  for (const match of sourceText.matchAll(linePattern)) {
    const index = rows.length;
    const name = cleanAppendixValue(match[2]).replace(/,\s*$/, "");
    const quantity = cleanAppendixValue(match[3]);
    const unit = cleanAppendixValue(match[4]);
    const price = cleanAppendixValue(match[5]);
    const sum = cleanAppendixValue(match[6]) || computeRowSum(quantity, price);
    const codeRow = codeRows[index] || null;

    rows.push(makeAppendixRow(rows.length + 1, {
      code: codeRow?.code || "",
      name,
      unit: codeRow?.unit || normalizeUnit(unit),
      quantity: codeRow?.quantity || quantity,
      price: codeRow?.price || price,
      sum: codeRow?.sum || sum,
      warranty: KBI_DEFAULT_WARRANTY,
    }));
  }
  return rows;
}

function parseCodeRows(sourceText: string): Array<Partial<AppendixTableRow>> {
  const rows: Array<Partial<AppendixTableRow>> = [];
  const codePattern = /Код\s+`?([^`\s—]+)`?\s+—\s+Количество:\s*([0-9\s.,]+)\s*([A-Za-zА-Яа-я.]+)?\s*—\s+Цена:\s*([0-9\s.,]+)/gim;
  for (const match of sourceText.matchAll(codePattern)) {
    const quantity = cleanAppendixValue(match[2]);
    const unit = normalizeUnit(match[3] || "шт");
    const price = cleanAppendixValue(match[4]);
    rows.push({
      code: cleanAppendixValue(match[1]),
      unit,
      quantity,
      price,
      sum: computeRowSum(quantity, price),
    });
  }
  return rows;
}

function parseMarkdownTableRows(sourceText: string): AppendixTableRow[] {
  const rows: AppendixTableRow[] = [];
  const tableLines = sourceText.split(/\r?\n/).filter((line) => line.includes("|"));
  for (const line of tableLines) {
    const cells = line.split("|").map((cell) => normalizeTableCell(cell)).filter(Boolean);
    if (cells.length < 6) continue;
    if (isMarkdownSeparatorRow(cells)) continue;
    if (isAppendixTableHeaderRow(cells)) continue;

    const row = cells.length >= 8
      ? makeAppendixRow(rows.length + 1, {
          code: cells[1],
          name: cells[2],
          unit: cells[3],
          quantity: cells[4],
          price: cells[5],
          sum: cells[6],
          warranty: cells[7],
        })
      : makeAppendixRow(rows.length + 1, {
          code: cells[0],
          name: cells[1],
          unit: cells[2],
          quantity: cells[3],
          price: cells[4],
          sum: cells[5],
          warranty: cells[6] || KBI_DEFAULT_WARRANTY,
        });
    if (isAppendixHeaderLikeRow(row)) continue;
    rows.push(row);
  }
  return rows;
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.some((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function isAppendixTableHeaderRow(cells: string[]): boolean {
  const normalizedCells = cells.map(normalizeHeaderCell);
  const firstCell = normalizedCells[0] || "";
  if (firstCell.startsWith("№") || ["#", "n", "no"].includes(firstCell)) return true;

  const headerHits = normalizedCells.filter((cell) => {
    return cell === "код"
      || cell.includes("товар")
      || cell.includes("работ")
      || cell.includes("услуг")
      || cell.includes("наименование")
      || cell.includes("ед")
      || cell.includes("кол")
      || cell.includes("цена")
      || cell.includes("ставка ндс")
      || cell.includes("сумма")
      || cell.includes("гарантия");
  }).length;

  return headerHits >= 2;
}

function isAppendixHeaderLikeRow(row: AppendixTableRow): boolean {
  const code = normalizeHeaderCell(row.code);
  const name = normalizeHeaderCell(row.name);
  return code === "код"
    || name.startsWith("№")
    || name === "товары"
    || name.includes("товары работы")
    || name.includes("работы услуги")
    || name.includes("наименование");
}

function normalizeHeaderCell(value: string): string {
  return cleanAppendixValue(value)
    .toLowerCase()
    .replace(/[().,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeAppendixRow(number: number, raw: Partial<AppendixTableRow>): AppendixTableRow {
  const sum = cleanAppendixValue(raw.sum) || computeRowSum(raw.quantity || "", raw.price || "");
  return {
    number,
    code: cleanAppendixValue(raw.code) || "уточняется",
    name: cleanAppendixValue(raw.name) || "Наименование товара уточняется по счету",
    unit: cleanAppendixValue(raw.unit) || unitFromQuantity(raw.quantity || "") || "шт.",
    quantity: cleanQuantity(raw.quantity) || "уточняется",
    price: formatMoneyText(raw.price),
    sum: formatMoneyText(sum),
    warranty: normalizeWarranty(raw.warranty),
    sumValue: parseMoneyText(sum),
  };
}

function buildKbiAppendixText(data: KbiAppendixData): string {
  const rows = data.rows
    .map((row) => `${row.number}. ${row.code} | ${row.name} | ${row.unit} | ${row.quantity} | ${row.price} | ${row.sum} | ${row.warranty}`)
    .join("\n");
  return [
    `Приложение № ____ от ${data.appendixDateRu}`,
    `к Договору поставки № ${data.contractNumber}`,
    `от ${data.contractDateRu}`,
    "",
    "№ | Код | Наименование | Ед. изм. | Кол-во | Цена за ед. изм., с НДС 16% | Сумма с НДС 16% | Гарантия",
    rows,
    "",
    `Общая стоимость составляет ${data.totalText} (${data.totalWords}) тенге 00 тиын, с учетом НДС 16%.`,
    `Условия поставки и место: ${data.deliveryPlace}`,
    `Срок оплаты: ${data.paymentTerm}`,
    "",
    "Подписи Сторон:",
    "",
    KBI_BUYER_REQUISITES.join("\n"),
    "",
    MICHAEL_SUPPLIER_REQUISITES.join("\n"),
  ].join("\n");
}

function buildAppendixHtml(data: KbiAppendixData): string {
  const tableRows = data.rows.map((row) => `
      <tr>
        <td class="center">${row.number}</td>
        <td class="center">${escapeHtml(row.code)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="center">${escapeHtml(row.unit)}</td>
        <td class="center">${escapeHtml(row.quantity)}</td>
        <td class="money">${escapeHtml(row.price)}</td>
        <td class="money">${escapeHtml(row.sum)}</td>
        <td class="center">${escapeHtml(row.warranty)}</td>
      </tr>
    `).join("");
  const buyerRequisites = renderRequisites(KBI_BUYER_REQUISITES);
  const supplierRequisites = renderRequisites(MICHAEL_SUPPLIER_REQUISITES);

  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Приложение к договору - заявка ${data.requestId}</title>`,
    "<style>",
    "@page { size: A4; margin: 16mm 12mm 14mm 12mm; }",
    "body { font-family: 'Times New Roman', Times, serif; color: #111; font-size: 12pt; line-height: 1.15; }",
    "p { margin: 0 0 8px; }",
    ".appendix-title { font-weight: 700; margin: 0 auto 42px; text-align: center; width: 360px; }",
    ".appendix-title p { margin: 0; }",
    "table.items { border-collapse: collapse; margin: 0 auto 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; table-layout: fixed; width: 100%; }",
    ".items th, .items td { border: 1px solid #333; font-size: 9pt; overflow-wrap: anywhere; padding: 2px 3px; vertical-align: middle; word-break: break-word; word-wrap: break-word; }",
    ".items th { font-weight: 700; line-height: 1.05; text-align: center; }",
    ".center { text-align: center; }",
    ".money { text-align: right; }",
    ".summary { margin-top: 0; }",
    ".terms { margin-top: 18px; }",
    ".sign-title { font-weight: 700; margin: 54px 0 16px; text-align: center; }",
    ".requisites-table { border-collapse: collapse; table-layout: fixed; width: 100%; }",
    ".requisites-table td { border: 0; padding: 0; vertical-align: top; width: 50%; }",
    ".requisites-table td:first-child { padding-right: 29px; }",
    ".requisites-table td:last-child { padding-left: 29px; }",
    ".party p { margin: 0; }",
    ".party p:nth-child(1), .party p:nth-child(2), .party .bold { font-weight: 700; }",
    ".party .italic { font-style: italic; }",
    ".signature-cell { padding-top: 46px !important; }",
    ".signature-role { font-weight: 400; margin: 0 0 2px; }",
    ".signature-name { margin: 0; }",
    "</style>",
    "</head>",
    "<body>",
    '<div class="appendix-title">',
    `<p>Приложение №____ от ${escapeHtml(data.appendixDateRu)}</p>`,
    `<p>к Договору поставки № ${escapeHtml(data.contractNumber)}</p>`,
    `<p>от ${escapeHtml(data.contractDateRu)}</p>`,
    "</div>",
    '<table class="items">',
    "<colgroup>",
    '<col style="width: 3%">',
    '<col style="width: 12.5%">',
    '<col style="width: 47%">',
    '<col style="width: 4%">',
    '<col style="width: 4.5%">',
    '<col style="width: 11.5%">',
    '<col style="width: 11%">',
    '<col style="width: 6.5%">',
    "</colgroup>",
    "<thead>",
    "<tr>",
    "<th>№</th>",
    "<th>Код</th>",
    "<th>Наименование</th>",
    "<th>Ед.<br>изм.</th>",
    "<th>Кол-<br>во</th>",
    "<th>Цена за ед. изм.,<br>с НДС 16%</th>",
    "<th>Сумма с<br>НДС 16%</th>",
    "<th>Гарантия</th>",
    "</tr>",
    "</thead>",
    `<tbody>${tableRows}</tbody>`,
    "</table>",
    `<p class="summary">Общая стоимость составляет ${escapeHtml(data.totalText)} (${escapeHtml(data.totalWords)}) тенге 00 тиын, с учетом НДС 16%.</p>`,
    '<div class="terms">',
    `<p>Условия поставки и место: ${escapeHtml(data.deliveryPlace)}</p>`,
    `<p>Срок оплаты: ${escapeHtml(data.paymentTerm)}</p>`,
    "</div>",
    '<p class="sign-title">Подписи Сторон:</p>',
    '<table class="requisites-table">',
    "<tr>",
    `<td class="party">${buyerRequisites}</td>`,
    `<td class="party">${supplierRequisites}</td>`,
    "</tr>",
    "<tr>",
    `<td class="signature-cell">${renderPartySignature(KBI_BUYER_SIGNATORY)}</td>`,
    `<td class="signature-cell">${renderPartySignature(MICHAEL_SUPPLIER_SIGNATORY)}</td>`,
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderPartySignature(name: string): string {
  return [
    '<div>',
    '<p class="signature-role">Директор</p>',
    `<p class="signature-name">${escapeHtml(name)}</p>`,
    "</div>",
  ].join("");
}

function renderRequisites(lines: string[]): string {
  return lines.map((line) => {
    const className = ["юридический адрес:", "фактический адрес:"].includes(line)
        ? "italic"
        : line.endsWith(":")
          ? "bold"
          : "";
    return `<p${className ? ` class="${className}"` : ""}>${escapeHtml(line)}</p>`;
  }).join("\n");
}

function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return cleanAppendixValue(match[1]);
  }
  return "";
}

function cleanAppendixValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/^\s*[-•]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTableCell(value: string): string {
  return cleanAppendixValue(value.replace(/<br\s*\/?>/gi, " "));
}

function cleanQuantity(value: unknown): string {
  const text = cleanAppendixValue(value);
  if (!text) return "";
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)/);
  return match ? match[1].replace(".", ",") : text;
}

function normalizeWarranty(value: unknown): string {
  const text = cleanAppendixValue(value);
  if (!text || text.toLowerCase().includes("уточняется")) return KBI_DEFAULT_WARRANTY;
  return text;
}

function normalizeUnit(value: string): string {
  const normalized = cleanAppendixValue(value).toLowerCase().replace(/\.$/, "");
  if (!normalized) return "";
  if (normalized === "шт" || normalized.includes("штук")) return "шт.";
  if (normalized === "м" || normalized.includes("метр")) return "м";
  if (normalized === "кг") return "кг";
  if (normalized.includes("компл")) return "компл.";
  return cleanAppendixValue(value);
}

function unitFromQuantity(value: string): string {
  const text = cleanAppendixValue(value).toLowerCase();
  if (!text) return "";
  if (/\bм\b|метр/.test(text)) return "м";
  if (/шт/.test(text)) return "шт.";
  if (/компл/.test(text)) return "компл.";
  if (/кг/.test(text)) return "кг";
  return "";
}

function formatMoneyText(value: unknown): string {
  const amount = parseMoneyText(value);
  return amount === null ? "уточняется" : formatMoney(amount);
}

function computeRowSum(quantityValue: unknown, priceValue: unknown): string {
  const quantityText = cleanAppendixValue(quantityValue);
  const price = parseMoneyText(priceValue);
  const quantityMatch = quantityText.match(/([0-9]+(?:[,.][0-9]+)?)/);
  if (price === null || !quantityMatch) return "";
  const quantity = Number(quantityMatch[1].replace(",", "."));
  if (!Number.isFinite(quantity)) return "";
  return formatMoney(quantity * price);
}

function parseMoneyText(value: unknown): number | null {
  const text = cleanAppendixValue(value);
  if (!text || text === "уточняется") return null;
  const match = text.match(/-?[0-9][0-9\s]*(?:[,.][0-9]{1,2})?/);
  if (!match) return null;
  const normalized = match[0].replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [integerPart, fractionPart] = rounded.toFixed(2).split(".");
  return `${integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fractionPart}`;
}

function formatRuDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const months = [
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  return `${day} ${months[month]} ${year} года`;
}

function extractDeliveryPlace(sourceText: string): string {
  const delivery = firstMatch(sourceText, [
    /Условия поставки и место\s*[:\-]\s*([^\n]+)/i,
    /Место поставки\s*[:\-]\s*([^\n]+)/i,
    /Доставка\s*[:\-]\s*([^\n]+)/i,
  ]);
  return delivery.toLowerCase().includes("ddp") ? delivery : "";
}

function extractPaymentTerm(sourceText: string): string {
  return firstMatch(sourceText, [
    /Срок оплаты\s*[:\-]\s*([^\n]+)/i,
    /Условия оплаты\s*[:\-]\s*([^\n]+)/i,
  ]);
}

function moneyToRussianWords(amount: number): string {
  const integer = Math.max(0, Math.floor(amount));
  if (integer === 0) return "ноль";

  const units = [
    { forms: ["", "", ""], gender: "male" },
    { forms: ["тысяча", "тысячи", "тысяч"], gender: "female" },
    { forms: ["миллион", "миллиона", "миллионов"], gender: "male" },
    { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "male" },
  ];
  const parts: string[] = [];
  let rest = integer;
  let groupIndex = 0;

  while (rest > 0 && groupIndex < units.length) {
    const group = rest % 1000;
    if (group > 0) {
      const unit = units[groupIndex];
      const words = triadToRussianWords(group, unit.gender);
      const form = unit.forms[0] ? pluralRu(group, unit.forms) : "";
      parts.unshift([words, form].filter(Boolean).join(" "));
    }
    rest = Math.floor(rest / 1000);
    groupIndex += 1;
  }

  return parts.join(" ");
}

function triadToRussianWords(value: number, gender: string): string {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "десять", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const onesMale = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const ones = gender === "female" ? onesFemale : onesMale;
  const result: string[] = [];
  const hundred = Math.floor(value / 100);
  const lastTwo = value % 100;
  const one = value % 10;

  if (hundred) result.push(hundreds[hundred]);
  if (lastTwo >= 10 && lastTwo <= 19) {
    result.push(teens[lastTwo - 10]);
  } else {
    const ten = Math.floor(lastTwo / 10);
    if (ten) result.push(tens[ten]);
    if (one) result.push(ones[one]);
  }
  return result.join(" ");
}

function pluralRu(value: number, forms: string[]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function capitalizeFirst(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function extractInvoiceNumber(value: string): string {
  return firstMatch(value, [
    /счет(?:а|у)?\s+на\s+оплату\s*№\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /счет\s*№\s*([0-9A-Za-zА-Яа-я._/-]+)/i,
    /№\s*([0-9]{3,})\s+от\s+\d{1,2}[.\s]/i,
  ]);
}

function extractInvoiceDate(value: string): string {
  const numeric = value.match(/(?:счет(?:а|у)?(?:\s+на\s+оплату)?\s*№\s*[0-9A-Za-zА-Яа-я._/-]+\s*от\s*)(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;

  const ru = value.match(/(?:счет(?:а|у)?(?:\s+на\s+оплату)?\s*№\s*[0-9A-Za-zА-Яа-я._/-]+\s*от\s*)(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (!ru) return "";
  const months: Record<string, string> = {
    января: "01",
    февраля: "02",
    марта: "03",
    апреля: "04",
    мая: "05",
    июня: "06",
    июля: "07",
    августа: "08",
    сентября: "09",
    октября: "10",
    ноября: "11",
    декабря: "12",
  };
  const month = months[ru[2].toLowerCase()];
  return month ? `${ru[3]}-${month}-${ru[1].padStart(2, "0")}` : "";
}

function buildAppendixFileName(requestId: number, invoiceNumber: string, clientCompany: string): string {
  const invoicePart = invoiceNumber === "уточняется" ? `request-${requestId}` : `invoice-${invoiceNumber}`;
  return sanitizeFileName(`appendix-${clientCompany}-${invoicePart}.doc`);
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

async function listOpenTasks(env: Env) {
  const result = await env.DB.prepare(`
    SELECT
      t.*,
      r.client_company,
      r.client_contact_name,
      r.michael_manager,
      r.communication_channel,
      r.priority,
      r.requires_contract_appendix,
      r.invoice_status,
      r.contract_appendix_status
    FROM request_tasks t
    INNER JOIN requests r ON r.id = t.request_id
    WHERE t.status = 'open'
      AND r.status NOT IN ('done', 'closed', 'lost')
    ORDER BY
      CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(t.due_date, '9999-12-31') ASC,
      t.created_at ASC
    LIMIT 50
  `).all();
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

async function deleteRequestTask(env: Env, requestId: number, taskId: number, currentUser: CurrentUser) {
  const existing = await getRequestTask(env, requestId, taskId) as Record<string, any> | null;
  if (!existing) return null;

  await env.DB.prepare(`
    DELETE FROM request_tasks
    WHERE request_id = ? AND id = ?
  `).bind(requestId, taskId).run();

  await createRequestEvent(
    env,
    requestId,
    "request.task_deleted",
    currentUser.display_name || currentUser.username || "manager",
    {
      task_id: taskId,
      title: String(existing.title || ""),
      previous_status: existing.status || "open",
    },
  );

  return { ok: true, task_id: taskId };
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
  const [clients, contacts, managers, openRequests, vipRequests, openTasks, overdueTasks, statusCounts] = await Promise.all([
    env.DB.prepare("SELECT * FROM crm_clients ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM crm_contacts ORDER BY updated_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT * FROM michael_managers ORDER BY display_name ASC LIMIT 100").all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE status NOT IN ('done', 'closed', 'lost')").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE client_type = 'vip'").first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM request_tasks t
      INNER JOIN requests r ON r.id = t.request_id
      WHERE t.status = 'open'
        AND r.status NOT IN ('done', 'closed', 'lost')
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM request_tasks t
      INNER JOIN requests r ON r.id = t.request_id
      WHERE t.status = 'open'
        AND t.due_date IS NOT NULL
        AND t.due_date < date('now')
        AND r.status NOT IN ('done', 'closed', 'lost')
    `).first(),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM requests GROUP BY status ORDER BY count DESC").all(),
  ]);

  return {
    clients: clients.results,
    contacts: contacts.results,
    managers: managers.results,
    open_requests: Number((openRequests as Record<string, unknown> | null)?.count || 0),
    vip_requests: Number((vipRequests as Record<string, unknown> | null)?.count || 0),
    open_tasks: Number((openTasks as Record<string, unknown> | null)?.count || 0),
    overdue_tasks: Number((overdueTasks as Record<string, unknown> | null)?.count || 0),
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

function detectKbiEnergy(value: string): boolean {
  const normalized = normalizeKey(value);
  return normalized.includes("kbi") || normalized.includes("кби");
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

function isDocument(fileName: string): boolean {
  return [".pdf", ".docx", ".xlsx"].some((extension) => fileName.endsWith(extension));
}

function isPdf(fileName: string): boolean {
  return fileName.endsWith(".pdf");
}

function isParserServiceConfigured(env: Env): boolean {
  return Boolean((env.PARSER_SERVICE_URL || "").trim());
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

async function parseDocumentWithService(env: Env, file: File): Promise<ParsedDocument> {
  const baseUrl = (env.PARSER_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(
      "PARSER_SERVICE_URL не задан. Для DOCX/XLSX запустите parser-service и укажите его URL в настройках Worker. PDF при AI_PROVIDER=gemini обрабатывается напрямую.",
    );
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "uploaded-file");

  const headers = new Headers();
  if (env.PARSER_SERVICE_TOKEN) headers.set("X-Parser-Token", env.PARSER_SERVICE_TOKEN);

  const response = await fetch(`${baseUrl}/parse`, {
    method: "POST",
    headers,
    body: formData,
  });
  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : raw || response.statusText;
    throw new Error(`Ошибка parser-service: ${detail}`);
  }

  if (!data || typeof data !== "object") throw new Error("Parser service вернул пустой ответ.");
  return data as ParsedDocument;
}

function parsedDocumentText(parsed: ParsedDocument): string {
  const rootText = normalizeOptionalText(parsed.text);
  if (rootText) return rootText;

  const parts: string[] = [];
  for (const page of parsed.pages || []) {
    const text = normalizeOptionalText(page.text);
    if (text) {
      const pageNumber = Number(page.page_number || 0);
      parts.push(pageNumber ? `Страница ${pageNumber}:\n${text}` : text);
    }
  }

  return parts.join("\n\n").trim();
}

function parsedImagePages(parsed: ParsedDocument): ParsedImagePage[] {
  const pages: ParsedImagePage[] = [];
  for (const [index, page] of (parsed.pages || []).entries()) {
    const payload = filePayloadFromParsedPage(page);
    if (payload) pages.push({ pageNumber: Number(page.page_number || index + 1), payload });
  }
  return pages;
}

function filePayloadFromParsedPage(page: ParsedDocumentPage): FilePayload | null {
  const dataUrl = normalizeOptionalText(page.image_data_url);
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) return { mimeType: match[1], base64: match[2], dataUrl };
  }

  const base64 = normalizeOptionalText(page.image_base64);
  if (!base64) return null;
  const mimeType = normalizeOptionalText(page.image_mime_type) || "image/jpeg";
  return {
    mimeType,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[Текст обрезан до ${maxLength} символов перед отправкой в ИИ.]`;
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

async function fetchGeminiGenerateContent(
  env: Env,
  body: Record<string, unknown>,
  preferredModel = env.GEMINI_MODEL,
): Promise<Response> {
  return fetchGeminiWithRetry(env, "generateContent", body, preferredModel);
}

async function fetchGeminiInteractions(
  env: Env,
  body: Record<string, unknown>,
  preferredModel = env.GEMINI_MODEL,
): Promise<Response> {
  return fetchGeminiWithRetry(env, "interactions", body, preferredModel);
}

async function fetchGeminiWithRetry(
  env: Env,
  endpoint: "generateContent" | "interactions",
  body: Record<string, unknown>,
  preferredModel: string,
): Promise<Response> {
  const attempts = geminiRetryAttempts(env);
  const baseDelayMs = geminiRetryBaseDelayMs(env);
  let lastResponse: Response | null = null;
  let lastNetworkError = "";

  for (const model of geminiModelCandidates(env, preferredModel)) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const url = endpoint === "interactions" ? geminiInteractionsUrl() : geminiGenerateUrl(model);
        const requestBody = endpoint === "interactions" ? { ...body, model } : body;
        const response = await fetch(url, {
          method: "POST",
          headers: geminiHeaders(env),
          body: JSON.stringify(requestBody),
        });
        const raw = await response.text();
        lastResponse = cloneTextResponse(response, raw);

        if (response.ok) return lastResponse;
        if (!isGeminiRetryable(response.status, raw)) break;
        if (attempt < attempts) await sleep(geminiBackoffDelayMs(baseDelayMs, attempt));
      } catch (error) {
        lastNetworkError = error instanceof Error ? error.message : String(error);
        if (attempt < attempts) await sleep(geminiBackoffDelayMs(baseDelayMs, attempt));
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(`Не удалось соединиться с Gemini API после автоматических повторов: ${lastNetworkError || "нет ответа"}.`);
}

function cloneTextResponse(response: Response, raw: string): Response {
  return new Response(raw, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
    },
  });
}

function geminiModelCandidates(env: Env, preferredModel: string): string[] {
  const primary = (preferredModel || env.GEMINI_MODEL || "gemini-3.5-flash").trim();
  const fallbackModels = (env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...fallbackModels].filter(Boolean)));
}

function geminiRetryAttempts(env: Env): number {
  const value = Number(env.GEMINI_RETRY_ATTEMPTS || 3);
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.trunc(value), 1), 5);
}

function geminiRetryBaseDelayMs(env: Env): number {
  const value = Number(env.GEMINI_RETRY_BASE_DELAY_MS || 800);
  if (!Number.isFinite(value)) return 800;
  return Math.min(Math.max(Math.trunc(value), 100), 5_000);
}

function geminiBackoffDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 8_000);
}

function isGeminiRetryable(status: number, raw: string): boolean {
  if (status === 429 || [500, 502, 503, 504].includes(status)) return true;
  const text = `${extractGeminiErrorMessage(raw)} ${raw}`.toLowerCase();
  return text.includes("high demand")
    || text.includes("spikes in demand")
    || text.includes("try again later")
    || text.includes("overloaded")
    || text.includes("temporarily unavailable")
    || text.includes("resource exhausted")
    || text.includes("rate limit");
}

function formatGeminiError(apiName: string, status: number, raw: string): string {
  const message = extractGeminiErrorMessage(raw);
  if (isGeminiRetryable(status, raw)) {
    return `${apiName} временно перегружен или ограничил запросы. Программа уже выполнила автоматические повторы, но ответ не получен. Повторите обработку через 1-2 минуты или укажите резервные модели в GEMINI_FALLBACK_MODELS. Детали: ${message}`;
  }
  return `Ошибка ${apiName}: ${message}`;
}

function extractGeminiErrorMessage(raw: string): string {
  try {
    const data = JSON.parse(raw);
    if (typeof data?.error?.message === "string") return data.error.message;
    if (typeof data?.message === "string") return data.message;
    if (typeof data?.error === "string") return data.error;
  } catch {
    // Use raw text below.
  }
  return raw || "пустой ответ";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openAIHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function geminiInteractionsUrl(): string {
  return "https://generativelanguage.googleapis.com/v1beta/interactions";
}

function geminiHeaders(env: Env): HeadersInit {
  return {
    "x-goog-api-key": env.GEMINI_API_KEY,
    "Content-Type": "application/json",
  };
}

function isAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}

function canManageRequests(user: CurrentUser): boolean {
  return ["admin", "manager"].includes(user.role);
}

function canManageDocuments(user: CurrentUser): boolean {
  return ["admin", "manager", "accountant"].includes(user.role);
}

function canManageTasks(user: CurrentUser): boolean {
  return ["admin", "manager", "accountant"].includes(user.role);
}

function userToCurrentUser(row: Record<string, any>): CurrentUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    role: String(row.role),
  };
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function normalizeRole(value: unknown): string {
  const role = normalizeOptionalText(value) || "manager";
  return ["admin", "manager", "accountant", "viewer"].includes(role) ? role : "manager";
}

async function hashPassword(password: string, saltBase64 = ""): Promise<{ hash: string; salt: string }> {
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 100000,
    },
    key,
    256,
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  return timingSafeEqualBytes(base64ToBytes(actual.hash), base64ToBytes(expectedHash));
}

function timingSafeEqualBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  let diff = actual.length ^ expected.length;
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (actual[index] || 0) ^ (expected[index] || 0);
  }
  return diff === 0;
}

function generateSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getCookie(request: Request, name: string): string {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    if (part.slice(0, separatorIndex) === name) return decodeURIComponent(part.slice(separatorIndex + 1));
  }
  return "";
}

function buildSessionCookie(request: Request, token: string, maxAge: number): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function toSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function json(data: unknown, status = 200): Response {
  return jsonWithHeaders(data, status);
}

function jsonWithHeaders(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
