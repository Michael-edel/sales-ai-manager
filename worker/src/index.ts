export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI_PROVIDER: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
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
      if (request.method === "PATCH" && taskMatch) {
        if (!canManageTasks(currentUser)) return json({ detail: "Недостаточно прав." }, 403);
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

async function analyzePdfGemini(env: Env, filePayload: FilePayload, fileName: string, managerNote: string): Promise<string> {
  requireGemini(env);
  if (filePayload.base64.length > 28_000_000) {
    throw new Error("PDF слишком большой для прямой обработки через Gemini. Настройте parser-service или загрузите файл меньше 20 МБ.");
  }

  const response = await fetch(geminiInteractionsUrl(), {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      model: env.GEMINI_MODEL || "gemini-3.5-flash",
      input: [
        {
          type: "text",
          text: `${SYSTEM_PROMPT}\n\nПроанализируй PDF-документ как входящую B2B-заявку или счет. Имя файла: ${fileName}\n\nПояснение менеджера:\n${managerNote || "нет"}`,
        },
        {
          type: "document",
          data: filePayload.base64,
          mime_type: "application/pdf",
        },
      ],
    }),
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

  const response = await fetch(geminiGenerateUrl(env), {
    method: "POST",
    headers: geminiHeaders(env),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts }],
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

async function readGeminiInteractionText(response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(`Ошибка Gemini Interactions API: ${raw}`);
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
  const clientCompany = normalizeOptionalText(item.client_company) || "ТОО KBI Energy";
  const invoiceNumber = normalizeOptionalText(item.invoice_number) || "уточняется";
  const invoiceDate = normalizeOptionalText(item.invoice_date) || "уточняется";
  const documentDate = invoiceDate === "уточняется" ? new Date().toISOString().slice(0, 10) : invoiceDate;
  const sourceSummary = buildAppendixSourceSummary(item);
  const appendixSubject = invoiceNumber === "уточняется"
    ? `заявке № ${requestId}`
    : `счету на оплату № ${invoiceNumber} от ${invoiceDate}`;
  const appendixTitle = `к ${appendixSubject}`;

  const text = [
    "ПРИЛОЖЕНИЕ № ____",
    "к Договору поставки № ____ от __.__.____ г.",
    "",
    appendixTitle,
    "",
    `Дата приложения: ${documentDate}`,
    "",
    "1. Стороны",
    "Поставщик: ТОО Michael.",
    `Покупатель: ${clientCompany}.`,
    "",
    "2. Предмет приложения",
    `Поставщик обязуется поставить, а Покупатель принять и оплатить товар по ${appendixSubject}.`,
    "Приложение оформляется к годовому договору с VIP/оптовым клиентом KBI Energy.",
    "",
    "3. Спецификация и коммерческие условия",
    sourceSummary,
    "",
    "4. Цена, НДС и документы",
    "Все цены для клиента указываются с НДС от ТОО Michael.",
    `Счет на оплату: № ${invoiceNumber} от ${invoiceDate}.`,
    "Счет и настоящее приложение направляются клиенту вместе по рабочему каналу связи.",
    "",
    "5. Прочие условия",
    "Условия оплаты, поставки, приемки товара и документооборота применяются согласно годовому договору поставки между сторонами.",
    "Настоящее приложение является неотъемлемой частью договора и действует до полного исполнения обязательств по соответствующему счету.",
    "",
    "6. Подписи сторон",
    "",
    "Поставщик: ТОО Michael __________________ /____________/",
    "Покупатель: _____________________________ /____________/",
  ].join("\n");

  return {
    appendix_text: text,
    appendix_html: buildAppendixHtml(text, requestId),
    file_name: buildAppendixFileName(requestId, invoiceNumber, clientCompany),
  };
}

function buildAppendixSourceSummary(item: Record<string, any>): string {
  const extractedData = extractAiSection(normalizeOptionalText(item.ai_result), "B");
  const oneCDecision = extractAiSection(normalizeOptionalText(item.ai_result), "C");
  const sourceParts = [
    extractedData ? cleanAiSectionTitle(extractedData) : "",
    oneCDecision ? cleanAiSectionTitle(oneCDecision) : "",
  ].filter(Boolean);

  if (sourceParts.length > 0) return sourceParts.join("\n\n");

  const originalText = normalizeOptionalText(item.original_text);
  if (originalText) return limitText(originalText, 4000);

  return "Спецификация товара, количество, цена с НДС и срок поставки заполняются по счету и подтвержденной заявке клиента.";
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

function buildAppendixHtml(text: string, requestId: number): string {
  const paragraphs = text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "<p>&nbsp;</p>";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Приложение к договору - заявка ${requestId}</title>`,
    "<style>",
    "body { font-family: Arial, sans-serif; color: #111; line-height: 1.35; margin: 40px; }",
    "p { margin: 0 0 8px; }",
    "p:first-child { font-weight: 700; text-align: center; }",
    "</style>",
    "</head>",
    "<body>",
    paragraphs,
    "</body>",
    "</html>",
  ].join("\n");
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
