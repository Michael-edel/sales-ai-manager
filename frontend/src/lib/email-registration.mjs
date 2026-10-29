const COMPANY_EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@edel\.kz$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function registrationLinkState(href) {
  const url = new URL(href);
  const tokens = url.searchParams.getAll("registration_token");
  if (!tokens.length) return { hasLink: false, token: "", cleanPath: null };
  url.searchParams.delete("registration_token");
  return { hasLink: true, token: tokens.length === 1 && TOKEN.test(tokens[0]) ? tokens[0] : "",
    cleanPath: url.pathname + url.search + url.hash };
}

export function registrationRequestPayload(draft) {
  return { email: String(draft.email || "").trim().toLowerCase(), display_name: String(draft.display_name || "").trim() };
}

export function validateRegistrationRequest(draft) {
  const value = registrationRequestPayload(draft);
  if (!COMPANY_EMAIL.test(value.email)) return "Укажите корпоративную почту @edel.kz.";
  if (!value.display_name || value.display_name.length > 200 || /[\x00-\x1f\x7f]/.test(value.display_name))
    return "Укажите имя сотрудника, не более 200 символов.";
  return "";
}

export function validRegistrationToken(value) { return typeof value === "string" && TOKEN.test(value); }
