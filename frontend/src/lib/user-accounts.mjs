export const NEW_PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

export const ROLE_DESCRIPTIONS = {
  admin: "Управляет сотрудниками, настройками, заявками и документами.",
  manager: "Работает с заявками, подбором товаров, ценами и документами.",
  accountant: "Работает со счетами и документами.",
  viewer: "Просматривает данные без права изменять их.",
};

export function emptyAccountDraft() {
  return { username: "", display_name: "", email_address: "", role: "manager", password: "", confirmation: "" };
}

export function validateNewPassword(password, confirmation) {
  if (typeof password !== "string" || password.length < NEW_PASSWORD_MIN)
    return `Пароль должен содержать не менее ${NEW_PASSWORD_MIN} символов.`;
  if (password.length > PASSWORD_MAX) return `Пароль должен содержать не более ${PASSWORD_MAX} символов.`;
  if (typeof confirmation !== "string" || !confirmation) return "Повторите новый пароль.";
  if (password !== confirmation) return "Пароли не совпадают. Проверьте повторный ввод.";
  return "";
}

export function validateAccountDraft(draft, mode) {
  if (mode === "create") {
    const username = typeof draft.username === "string" ? draft.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9._-]{1,64}$/.test(username))
      return "Логин: от 1 до 64 символов, латинские буквы, цифры, точка, дефис или подчёркивание.";
    if (typeof draft.display_name !== "string" || draft.display_name.trim().length > 200)
      return "Имя сотрудника должно содержать не более 200 символов.";
    const email = typeof draft.email_address === "string" ? draft.email_address.trim().toLowerCase() : "";
    if (email && (email.length > 254 || !/^[^\s@]+@edel\.kz$/.test(email)))
      return "Укажите адрес сотрудника на edel.kz или оставьте email пустым.";
    if (!Object.hasOwn(ROLE_DESCRIPTIONS, draft.role)) return "Выберите роль сотрудника.";
  }
  return validateNewPassword(draft.password, draft.confirmation);
}

export function accountCreatePayload(draft) {
  // Confirmation is local validation, never a second credential sent to the API.
  return { username: draft.username.trim().toLowerCase(), display_name: draft.display_name.trim(),
    email_address: draft.email_address.trim().toLowerCase(), role: draft.role, password: draft.password };
}

export function accountError(error) {
  if (error?.safeMessage) return error.safeMessage;
  if (error?.status && error?.message) return error.message;
  return "Не удалось связаться с сервером. Повторите действие после восстановления связи.";
}
