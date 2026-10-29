export const SMTP_PASSWORD_MAX = 1024;
const ports = new Set([465, 587]);
const address = /^[^\s@]+@edel\.kz$/i;

export function smtpMetadata(value) {
  return {
    host: typeof value?.host === "string" ? value.host : "",
    port: ports.has(Number(value?.port)) ? Number(value.port) : 587,
    username: typeof value?.username === "string" ? value.username : "",
    from_address: typeof value?.from_address === "string" ? value.from_address : "",
    password_set: value?.password_set === true,
    auth_verified_at: typeof value?.auth_verified_at === "string" ? value.auth_verified_at : null,
    configured: value?.configured === true,
    allowed_hosts: Array.isArray(value?.allowed_hosts) ? value.allowed_hosts.filter(item => typeof item === "string" && /^[a-z0-9.-]+$/i.test(item)) : [],
  };
}

export function smtpDraft(value) {
  const metadata = smtpMetadata(value);
  return { host: metadata.host, port: metadata.port, username: metadata.username, from_address: metadata.from_address, password: "" };
}

export function smtpPayload(draft) {
  return { host: String(draft.host || "").trim().toLowerCase(), port: Number(draft.port),
    username: String(draft.username || "").trim(), from_address: String(draft.from_address || "").trim().toLowerCase(),
    password: typeof draft.password === "string" ? draft.password : "" };
}

export function smtpConnectionChanged(draft, metadata) {
  const next = smtpPayload(draft), current = smtpPayload(metadata);
  return ["host", "port", "username", "from_address"].some(field => next[field] !== current[field]);
}

export function smtpProbePayload(value) {
  return { host: String(value.host || "").trim().toLowerCase(), port: Number(value.port) };
}

export function validateSmtpProbe(value, metadata) {
  const next = smtpProbePayload(value);
  if (!metadata.allowed_hosts?.includes(next.host)) return "Выберите разрешённый SMTP-сервер компании.";
  if (!ports.has(next.port)) return "Выберите защищённый порт 465 или 587.";
  return "";
}

export function validateSmtpDraft(draft, metadata) {
  const next = smtpPayload(draft);
  const endpointError = validateSmtpProbe(next, metadata);
  if (endpointError) return endpointError;
  if (!next.username || next.username.length > 254 || /[\x00-\x1f\x7f]/.test(next.username)) return "Укажите логин почтового ящика.";
  if (!address.test(next.from_address) || next.from_address.length > 254) return "Укажите адрес отправителя @edel.kz.";
  if (next.password.length > SMTP_PASSWORD_MAX) return "Пароль приложения слишком длинный.";
  if (/[\x00-\x1f\x7f]/.test(next.password)) return "Пароль приложения не должен содержать переносы строк или управляющие символы.";
  if (!next.password && (!metadata.password_set || smtpConnectionChanged(draft, metadata)))
    return "Введите SMTP-пароль приложения. При изменении подключения его нужно указать заново.";
  return "";
}

export function smtpError(error) {
  if (error?.code === "SMTP_AUTH_FAILED") return "Почтовый сервер отклонил вход (535). Проверьте логин и отдельный SMTP-пароль приложения.";
  if (error?.code === "SMTP_CONNECTION_FAILED") return "Не удалось установить защищённое SMTP-подключение. Проверьте сервер и порт или повторите позже.";
  if (error?.code === "SMTP_SETTINGS_UNAVAILABLE") return "Настройки SMTP временно недоступны. Повторите позже или обратитесь к администратору.";
  return error?.safeMessage || (error?.status ? error.message : "Не удалось связаться с сервером. Повторите позже.");
}
