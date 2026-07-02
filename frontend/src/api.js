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

export function updateUserEmail(userId, emailAddress) {
  return request(`/users/${userId}/email`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: emailAddress }),
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

export function getOneCMcpHealth() {
  return request("/1c/mcp/health");
}

export function listOneCMcpTools() {
  return request("/1c/mcp/tools");
}

export function callOneCMcpTool(payload) {
  return request("/1c/mcp/tools/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getOneCBusinessStatus() {
  return request("/1c/status");
}

export function searchOneCCounterparties(query) {
  return request("/1c/counterparties/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export function linkCrmClientOneCCounterparty(clientId, payload) {
  return request(`/crm/clients/${clientId}/1c-counterparty`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function searchOneCProducts(query) {
  return request("/1c/products/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export function getOneCStockAndPrices(query) {
  return request("/1c/products/stock-prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export function runOneCCommand(payload) {
  return request("/1c/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listRequestOneCProducts(requestId) {
  return request(`/requests/${requestId}/1c-products`);
}

export function linkRequestOneCProduct(requestId, payload) {
  return request(`/requests/${requestId}/1c-products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteRequestOneCProduct(requestId, productId) {
  return request(`/requests/${requestId}/1c-products/${productId}`, {
    method: "DELETE",
  });
}

export function getRequestOneCProductStockPrices(requestId) {
  return request(`/requests/${requestId}/1c-products/stock-prices`);
}

export function refreshRequestOneCContext(requestId) {
  return request(`/requests/${requestId}/1c-context`, {
    method: "POST",
  });
}

export function reanalyzeRequestWithOneC(requestId) {
  return request(`/requests/${requestId}/reanalyze-1c`, {
    method: "POST",
  });
}

export function getOneCClientContracts(clientId) {
  return request(`/1c/clients/${clientId}/contracts`);
}

export function getOneCClientProfile(clientId) {
  return request(`/1c/clients/${clientId}/profile`);
}

export function getOneCClientOrders(clientId) {
  return request(`/1c/clients/${clientId}/orders`);
}

export function getOneCClientInvoices(clientId) {
  return request(`/1c/clients/${clientId}/invoices`);
}

export function getOneCClientDebt(clientId) {
  return request(`/1c/clients/${clientId}/debt`);
}

export function getOneCClientPaymentTerms(clientId) {
  return request(`/1c/clients/${clientId}/terms`);
}

export function getOneCClientAddresses(clientId) {
  return request(`/1c/clients/${clientId}/addresses`);
}

export function listAiRules() {
  return request("/ai/rules");
}

export function updateAiRules(rules) {
  return request("/ai/rules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules }),
  });
}

export function listWhatsAppTemplates() {
  return request("/whatsapp/templates");
}

export function createWhatsAppTemplate(payload) {
  return request("/whatsapp/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateWhatsAppTemplates(templates) {
  return request("/whatsapp/templates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templates }),
  });
}

export function getWhatsAppHealth() {
  return request("/whatsapp/health");
}

export function sendWhatsAppTemplate(payload) {
  return request("/whatsapp/send-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

export function deleteRequestTask(requestId, taskId) {
  return request(`/requests/${requestId}/tasks/${taskId}`, { method: "DELETE" });
}

export function updateRequestStatus(requestId, payload) {
  return request(`/requests/${requestId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteRequest(requestId) {
  return request(`/requests/${requestId}`, { method: "DELETE" });
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

export function listEmailMessages(folder = "inbox") {
  return request(`/email/messages?folder=${encodeURIComponent(folder)}`);
}

export function createEmailSenderFilter(payload) {
  return request("/email/sender-filters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteEmailSenderFilter(filterId) {
  return request(`/email/sender-filters/${filterId}`, { method: "DELETE" });
}

export function updateEmailMessage(emailId, payload) {
  return request(`/email/messages/${emailId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteEmailMessage(emailId) {
  return request(`/email/messages/${emailId}`, { method: "DELETE" });
}

export function processEmailMessage(emailId) {
  return request(`/email/messages/${emailId}/process`, { method: "POST" });
}
