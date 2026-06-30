const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...options });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.detail || "Ошибка запроса к серверу");
    error.status = response.status;
    throw error;
  }

  return data;
}

export function getCurrentUser() {
  return request("/auth/me");
}

export function login(username, password) {
  return request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request("/auth/logout", { method: "POST" });
}

export function listUsers() {
  return request("/users");
}

export function createUser(payload) {
  return request("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function resetUserPassword(userId, password) {
  return request(`/users/${userId}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function updateUserActive(userId, isActive) {
  return request(`/users/${userId}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function listRequests() {
  return request("/requests");
}

export function getCrmSummary() {
  return request("/crm/summary");
}

export function getParserHealth() {
  return request("/parser/health");
}

export function listOpenTasks() {
  return request("/tasks/open");
}

export function listRequestEvents(requestId) {
  return request(`/requests/${requestId}/events`);
}

export function listRequestTasks(requestId) {
  return request(`/requests/${requestId}/tasks`);
}

export function createRequestTask(requestId, payload) {
  return request(`/requests/${requestId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateRequestTask(requestId, taskId, payload) {
  return request(`/requests/${requestId}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateRequestStatus(requestId, payload) {
  return request(`/requests/${requestId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateDealDocuments(requestId, payload) {
  return request(`/requests/${requestId}/deal-documents`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function generateContractAppendix(requestId) {
  return request(`/requests/${requestId}/contract-appendix`, { method: "POST" });
}

export function processText(originalText, metadata = {}) {
  return request("/requests/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ original_text: originalText, ...metadata }),
  });
}

export function uploadFile(file, managerNote = "", metadata = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("manager_note", managerNote);
  Object.entries(metadata).forEach(([key, value]) => {
    formData.append(key, value || "");
  });

  return request("/requests/upload", {
    method: "POST",
    body: formData,
  });
}

export function checkEmail() {
  return request("/email/check", { method: "POST" });
}

export function getEmailSmtpHealth() {
  return request("/email/smtp/health");
}

export function sendEmailReply(payload) {
  return request("/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listEmailMessages() {
  return request("/email/messages");
}

export function processEmailMessage(emailId) {
  return request(`/email/messages/${emailId}/process`, { method: "POST" });
}
