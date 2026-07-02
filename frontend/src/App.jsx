import { useEffect, useMemo, useState } from "react";
import { Archive, Check, CheckSquare, ChevronDown, ChevronUp, Clipboard, Database, Eye, FilePlus2, FileText, FolderOpen, Inbox, Loader2, LogOut, Mail, MessageCircle, Plus, RefreshCw, RotateCcw, Search, Send, Server, Shield, Trash2, Upload, UserPlus } from "lucide-react";
import {
  checkEmail,
  createEmailSenderFilter,
  createWhatsAppTemplate,
  createUser,
  createRequestTask,
  deleteEmailSenderFilter,
  deleteRequest,
  deleteEmailMessage,
  deleteRequestTask,
  generateContractAppendix,
  getCrmSummary,
  getCurrentUser,
  getEmailSmtpHealth,
  getOneCBusinessStatus,
  getOneCMcpHealth,
  getOneCStockAndPrices,
  getParserHealth,
  getWhatsAppHealth,
  listAiRules,
  listEmailMessages,
  listOpenTasks,
  listRequestEvents,
  listRequestTasks,
  listRequests,
  listWhatsAppTemplates,
  listUsers,
  login,
  logout,
  processEmailMessage,
  processText,
  resetUserPassword,
  searchOneCCounterparties,
  searchOneCProducts,
  sendEmailReply,
  sendWhatsAppTemplate,
  updateDealDocuments,
  updateEmailMessage,
  updateAiRules,
  updateUserEmail,
  updateWhatsAppTemplates,
  updateUserActive,
  updateRequestTask,
  updateRequestStatus,
  uploadFile,
} from "./api";
import "./styles.css";

function splitSections(result) {
  if (!result) return [];
  const regex = /(?=^[A-F]\.\s)/gm;
  return result
    .split(regex)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractClientBlock(result) {
  const match = result.match(/^D\.\s[\s\S]*?(?=^E\.\s|$)/m);
  return match ? match[0].trim() : "";
}

function normalizePhoneCandidate(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function requestTitle(item) {
  if (item.source_type === "text") return "Текстовая заявка";
  if (item.source_type === "image") return `Изображение: ${item.uploaded_file_name}`;
  if (item.source_type === "audio") return `Голос: ${item.uploaded_file_name}`;
  if (item.source_type === "email") return "Email-заявка";
  return item.uploaded_file_name || "Файл заявки";
}

function formatDateTime(value) {
  if (!value) return "не указано";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const STATUS_OPTIONS = [
  ["new", "Новая"],
  ["in_progress", "В работе"],
  ["need_clarification", "Нужно уточнение"],
  ["reply_ready", "Ответ готов"],
  ["quote_sent", "КП отправлено"],
  ["invoice_required", "Нужен счет"],
  ["invoice_sent", "Счет отправлен"],
  ["done", "Выполнено"],
  ["closed", "Закрыта"],
  ["lost", "Потеряна"],
];

const PRIORITY_OPTIONS = [
  ["low", "Низкий"],
  ["normal", "Обычный"],
  ["high", "Высокий"],
  ["urgent", "Срочно"],
];

const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS);
const PRIORITY_LABELS = Object.fromEntries(PRIORITY_OPTIONS);

const INVOICE_STATUS_OPTIONS = [
  ["not_required", "Не требуется"],
  ["required", "Нужен счет"],
  ["prepared", "Счет подготовлен"],
  ["sent", "Счет отправлен"],
  ["paid", "Оплачен"],
  ["cancelled", "Отменен"],
];

const APPENDIX_STATUS_OPTIONS = [
  ["not_required", "Не требуется"],
  ["required", "Нужно приложение"],
  ["prepared", "Приложение подготовлено"],
  ["sent", "Приложение отправлено"],
  ["signed", "Подписано"],
  ["cancelled", "Отменено"],
];

const INVOICE_STATUS_LABELS = Object.fromEntries(INVOICE_STATUS_OPTIONS);
const APPENDIX_STATUS_LABELS = Object.fromEntries(APPENDIX_STATUS_OPTIONS);

const TASK_STATUS_LABELS = {
  open: "Открыта",
  done: "Выполнена",
  cancelled: "Отменена",
};

const EMAIL_FOLDERS = [
  ["inbox", "Полученные"],
  ["in_work", "В работе"],
  ["suppliers", "Поставщики"],
  ["buyers", "Покупатели"],
  ["done", "Закрытые"],
  ["trash", "Удаленные"],
];

const EMAIL_FOLDER_LABELS = Object.fromEntries(EMAIL_FOLDERS);

const EMAIL_STATUS_LABELS = {
  received: "Получено",
  in_work: "В работе",
  done: "Закрыто",
  deleted: "Удалено",
};

const ROLE_OPTIONS = [
  ["admin", "Администратор"],
  ["manager", "Менеджер: заявки + счета"],
  ["accountant", "Бухгалтер: счета"],
  ["viewer", "Просмотр"],
];

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS);

const WHATSAPP_TEMPLATE_CATEGORY_OPTIONS = [
  ["UTILITY", "Utility"],
  ["MARKETING", "Marketing"],
  ["AUTHENTICATION", "Authentication"],
];

function oneCResultText(response) {
  if (response?.result_text) return response.result_text;
  if (response?.configuration_text) return response.configuration_text;
  const content = response?.result?.content || response?.content || [];
  if (Array.isArray(content) && content.length > 0) {
    return content
      .map((item) => item?.text || item?.content || "")
      .filter(Boolean)
      .join("\n\n");
  }
  return JSON.stringify(response, null, 2);
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [loginDraft, setLoginDraft] = useState({ username: "manager", password: "" });
  const [loginError, setLoginError] = useState("");
  const [users, setUsers] = useState([]);
  const [aiRules, setAiRules] = useState([]);
  const [aiRulesStatus, setAiRulesStatus] = useState("");
  const [whatsappTemplates, setWhatsAppTemplates] = useState([]);
  const [whatsappTemplatesStatus, setWhatsAppTemplatesStatus] = useState("");
  const [whatsappTemplatesCollapsed, setWhatsappTemplatesCollapsed] = useState(true);
  const [whatsappHealth, setWhatsAppHealth] = useState(null);
  const [whatsappSendStatus, setWhatsAppSendStatus] = useState("");
  const [whatsappDraft, setWhatsAppDraft] = useState({
    to_phone: "",
    template_key: "",
    body_parameters_text: "",
  });
  const [whatsappTemplateDraft, setWhatsAppTemplateDraft] = useState({
    display_name: "",
    template_name: "",
    language_code: "ru",
    category: "UTILITY",
    body_text: "",
  });
  const [userDraft, setUserDraft] = useState({
    username: "",
    display_name: "",
    email_address: "",
    role: "manager",
    password: "",
  });
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState([]);
  const [emailFolder, setEmailFolder] = useState("inbox");
  const [emailStats, setEmailStats] = useState({});
  const [emailSenderFilters, setEmailSenderFilters] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [emailCollapsed, setEmailCollapsed] = useState(false);
  const [emailSenderFiltersCollapsed, setEmailSenderFiltersCollapsed] = useState(true);
  const [emailStatus, setEmailStatus] = useState("");
  const [emailSendStatus, setEmailSendStatus] = useState("");
  const [smtpStatus, setSmtpStatus] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [crmSummary, setCrmSummary] = useState(null);
  const [parserStatus, setParserStatus] = useState(null);
  const [parserLoading, setParserLoading] = useState(false);
  const [onecMcpStatus, setOnecMcpStatus] = useState(null);
  const [onecMcpLoading, setOnecMcpLoading] = useState(false);
  const [onecLookupDraft, setOnecLookupDraft] = useState({
    client: "ТОО KBI Energy",
    item: "",
  });
  const [onecLookupLoading, setOnecLookupLoading] = useState("");
  const [onecLookupResult, setOnecLookupResult] = useState(null);
  const [requestEvents, setRequestEvents] = useState([]);
  const [requestTasks, setRequestTasks] = useState([]);
  const [openTasks, setOpenTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [statusDraft, setStatusDraft] = useState({
    status: "new",
    priority: "normal",
    next_action: "",
  });
  const [dealDraft, setDealDraft] = useState({
    invoice_number: "",
    invoice_date: "",
    invoice_status: "not_required",
    contract_appendix_status: "not_required",
    contract_appendix_note: "",
    customer_sent_at: "",
  });
  const [metadata, setMetadata] = useState({
    client_company: "ТОО KBI Energy",
    client_contact_name: "",
    michael_manager: "",
    communication_channel: "WhatsApp",
    priority: "normal",
    next_action: "Подготовить ответ клиенту",
  });

  const resultSections = useMemo(() => splitSections(selected?.ai_result), [selected]);
  const clientBlock = useMemo(() => extractClientBlock(selected?.ai_result || ""), [selected]);
  const canManageRequests = ["admin", "manager"].includes(authUser?.role);
  const canManageDocuments = ["admin", "manager", "accountant"].includes(authUser?.role);
  const canManageTasks = ["admin", "manager", "accountant"].includes(authUser?.role);

  async function refreshUsers() {
    if (authUser?.role !== "admin") return;
    const items = await listUsers();
    setUsers(items);
  }

  async function refreshAiRules() {
    const items = await listAiRules();
    setAiRules(items);
  }

  async function refreshWhatsAppTemplates() {
    const items = await listWhatsAppTemplates();
    setWhatsAppTemplates(items);
    setWhatsAppDraft((current) => ({
      ...current,
      template_key: current.template_key || items.find((item) => item.is_enabled)?.template_key || "",
    }));
  }

  async function refreshWhatsAppHealth() {
    const status = await getWhatsAppHealth();
    setWhatsAppHealth(status);
  }

  async function refreshHistory(latestItem = null) {
    const items = await listRequests();
    setRequests(items);
    getCrmSummary().then(setCrmSummary).catch(() => {});
    listOpenTasks().then(setOpenTasks).catch(() => {});
    if (latestItem) {
      setSelected(latestItem);
    } else if (!selected && items.length > 0) {
      setSelected(items[0]);
    }
  }

  async function refreshEmails(folder = emailFolder) {
    const result = await listEmailMessages(folder);
    const items = Array.isArray(result) ? result : result.items || [];
    setEmails(items);
    setEmailStats(Array.isArray(result) ? {} : result.stats || {});
    setEmailSenderFilters(Array.isArray(result) ? [] : result.hidden_senders || []);
    setSelectedEmail((current) => {
      if (!current) return null;
      return items.find((item) => item.id === current.id) || null;
    });
  }

  async function refreshParserStatus() {
    setParserLoading(true);
    try {
      const status = await getParserHealth();
      setParserStatus(status);
    } catch (err) {
      setParserStatus({
        configured: false,
        reachable: false,
        status: "error",
        detail: err.message,
      });
    } finally {
      setParserLoading(false);
    }
  }

  async function refreshOneCMcpStatus() {
    if (authUser?.role !== "admin") return;
    setOnecMcpLoading(true);
    try {
      const status = await getOneCMcpHealth();
      setOnecMcpStatus(status);
    } catch (err) {
      setOnecMcpStatus({
        configured: false,
        reachable: false,
        status: "error",
        detail: err.message,
      });
    } finally {
      setOnecMcpLoading(false);
    }
  }

  function updateOnecLookupDraft(field, value) {
    setOnecLookupDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleOneCCheck() {
    if (authUser?.role !== "admin") return;
    setError("");
    setOnecLookupResult(null);
    setOnecLookupLoading("health");
    try {
      const response = await getOneCBusinessStatus();
      const status = response.health || {};
      setOnecMcpStatus(status);
      const body = status.reachable
        ? `1C MCP подключен. Доступных инструментов: ${status.tools_count || 0}.\n\n${response.configuration_text || ""}`.trim()
        : `1C MCP не подключен: ${status.detail || status.status || "статус неизвестен"}.`;
      setOnecLookupResult({ title: "Статус 1C", body });
    } catch (err) {
      setOnecLookupResult({ title: "Статус 1C", error: err.message });
    } finally {
      setOnecLookupLoading("");
    }
  }

  async function handleOneCClientSearch() {
    if (authUser?.role !== "admin") return;
    const search = String(onecLookupDraft.client || metadata.client_company || "").trim();
    if (!search) {
      setOnecLookupResult({ title: "Поиск клиента", error: "Введите название клиента или БИН." });
      return;
    }
    setError("");
    setOnecLookupResult(null);
    setOnecLookupLoading("client");
    try {
      const response = await searchOneCCounterparties(search);
      setOnecLookupResult({ title: "Клиенты в 1C", body: oneCResultText(response) });
    } catch (err) {
      setOnecLookupResult({ title: "Клиенты в 1C", error: err.message });
    } finally {
      setOnecLookupLoading("");
    }
  }

  async function handleOneCItemSearch() {
    if (authUser?.role !== "admin") return;
    const search = String(onecLookupDraft.item || "").trim();
    if (!search) {
      setOnecLookupResult({ title: "Поиск товара", error: "Введите артикул, код или часть наименования товара." });
      return;
    }
    setError("");
    setOnecLookupResult(null);
    setOnecLookupLoading("item");
    try {
      const response = await searchOneCProducts(search);
      setOnecLookupResult({ title: "Товары в 1C", body: oneCResultText(response) });
    } catch (err) {
      setOnecLookupResult({ title: "Товары в 1C", error: err.message });
    } finally {
      setOnecLookupLoading("");
    }
  }

  async function handleOneCStockAndPrices() {
    if (authUser?.role !== "admin") return;
    const search = String(onecLookupDraft.item || "").trim();
    if (!search) {
      setOnecLookupResult({
        title: "Остатки и цены",
        error: "Введите артикул, код или часть наименования товара.",
      });
      return;
    }
    setError("");
    setOnecLookupResult(null);
    setOnecLookupLoading("stock");
    try {
      const response = await getOneCStockAndPrices(search);
      setOnecLookupResult({
        title: "Остатки и цены в 1C",
        body: `### Остатки\n\n${response.stock_result_text || "нет данных"}\n\n### Цены\n\n${response.price_result_text || "нет данных"}`,
      });
    } catch (err) {
      setOnecLookupResult({ title: "Остатки и цены в 1C", error: err.message });
    } finally {
      setOnecLookupLoading("");
    }
  }

  async function refreshSmtpStatus() {
    try {
      const status = await getEmailSmtpHealth();
      setSmtpStatus(status);
    } catch (err) {
      setSmtpStatus({
        configured: false,
        reachable: false,
        status: "error",
        detail: err.message,
      });
    }
  }

  useEffect(() => {
    getCurrentUser()
      .then(({ user }) => {
        setAuthUser(user);
        setAuthLoading(false);
      })
      .catch(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    refreshHistory().catch((err) => setError(err.message));
    refreshEmails().catch((err) => setEmailStatus(err.message));
    refreshParserStatus().catch(() => {});
    refreshOneCMcpStatus().catch(() => {});
    refreshSmtpStatus().catch(() => {});
    refreshUsers().catch(() => {});
    refreshAiRules().catch((err) => setAiRulesStatus(err.message));
    refreshWhatsAppTemplates().catch((err) => setWhatsAppTemplatesStatus(err.message));
    refreshWhatsAppHealth().catch(() => setWhatsAppHealth({ configured: false, status: "error" }));
  }, [authUser]);

  useEffect(() => {
    refreshUsers().catch(() => {});
  }, [authUser?.role]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setAuthLoading(true);
    try {
      const { user } = await login(loginDraft.username, loginDraft.password);
      setAuthUser(user);
      setLoginDraft((current) => ({ ...current, password: "" }));
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => {});
    setAuthUser(null);
    setRequests([]);
    setSelected(null);
    setOpenTasks([]);
    setEmails([]);
    setEmailStats({});
    setSelectedEmail(null);
    setCrmSummary(null);
  }

  async function handleCreateUser() {
    setError("");
    setLoading(true);
    try {
      await createUser(userDraft);
      setUserDraft({ username: "", display_name: "", email_address: "", role: "manager", password: "" });
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetUserPassword(user) {
    const password = window.prompt(`Новый пароль для ${user.username}`);
    if (!password) return;
    setError("");
    setLoading(true);
    try {
      await resetUserPassword(user.id, password);
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateUserEmail(user) {
    setError("");
    setLoading(true);
    try {
      await updateUserEmail(user.id, user.email_address || "");
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleUserActive(user) {
    const nextActive = !Boolean(user.is_active);
    setError("");
    setLoading(true);
    try {
      await updateUserActive(user.id, nextActive);
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateAiRuleDraft(ruleKey, field, value) {
    setAiRules((current) => current.map((rule) => {
      if (rule.rule_key !== ruleKey) return rule;
      if (field === "is_enabled" && Number(rule.is_required) === 1) {
        return { ...rule, is_enabled: 1 };
      }
      return { ...rule, [field]: value };
    }));
  }

  async function handleAiRulesSave() {
    if (authUser?.role !== "admin") return;
    setError("");
    setAiRulesStatus("");
    setLoading(true);
    try {
      const saved = await updateAiRules(aiRules.map((rule) => ({
        rule_key: rule.rule_key,
        rule_text: rule.rule_text,
        is_enabled: Boolean(rule.is_enabled),
      })));
      setAiRules(saved);
      setAiRulesStatus("Правила сохранены и будут применяться к новым обработкам.");
    } catch (err) {
      setAiRulesStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateWhatsAppTemplateDraft(templateKey, field, value) {
    setWhatsAppTemplates((current) => current.map((template) => (
      template.template_key === templateKey ? { ...template, [field]: value } : template
    )));
  }

  async function handleWhatsAppTemplatesSave() {
    if (authUser?.role !== "admin") return;
    setError("");
    setWhatsAppTemplatesStatus("");
    setLoading(true);
    try {
      const saved = await updateWhatsAppTemplates(whatsappTemplates.map((template) => ({
        template_key: template.template_key,
        display_name: template.display_name,
        template_name: template.template_name,
        language_code: template.language_code,
        category: template.category,
        body_text: template.body_text,
        is_enabled: Boolean(template.is_enabled),
      })));
      setWhatsAppTemplates(saved);
      setWhatsAppTemplatesStatus("Шаблоны сохранены. Используйте только имена, уже утвержденные в Meta.");
    } catch (err) {
      setWhatsAppTemplatesStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateWhatsAppTemplate() {
    if (authUser?.role !== "admin") return;
    setError("");
    setWhatsAppTemplatesStatus("");
    setLoading(true);
    try {
      const saved = await createWhatsAppTemplate(whatsappTemplateDraft);
      setWhatsAppTemplates(saved);
      setWhatsAppTemplateDraft({
        display_name: "",
        template_name: "",
        language_code: "ru",
        category: "UTILITY",
        body_text: "",
      });
      setWhatsAppTemplatesStatus("Новый локальный шаблон добавлен. Проверьте, что template_name уже утвержден в Meta.");
    } catch (err) {
      setWhatsAppTemplatesStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) {
      setRequestEvents([]);
      setRequestTasks([]);
      return;
    }
    setStatusDraft({
      status: selected.status || "new",
      priority: selected.priority || "normal",
      next_action: selected.next_action || "",
    });
    setDealDraft({
      invoice_number: selected.invoice_number || "",
      invoice_date: selected.invoice_date || "",
      invoice_status: selected.invoice_status || "not_required",
      contract_appendix_status:
        selected.contract_appendix_status ||
        (selected.requires_contract_appendix ? "required" : "not_required"),
      contract_appendix_note: selected.contract_appendix_note || "",
      customer_sent_at: selected.customer_sent_at || "",
    });
    const phone = normalizePhoneCandidate(selected.client_contact_name);
    setWhatsAppDraft((current) => ({ ...current, to_phone: phone || current.to_phone }));
    listRequestEvents(selected.id).then(setRequestEvents).catch(() => setRequestEvents([]));
    listRequestTasks(selected.id).then(setRequestTasks).catch(() => setRequestTasks([]));
  }, [selected]);

  async function handleProcess() {
    if (!canManageRequests) return;
    setError("");
    setCopied(false);
    setLoading(true);

    try {
      const item = file ? await uploadFile(file, text, metadata) : await processText(text, metadata);
      setText("");
      setFile(null);
      setFileInputKey((value) => value + 1);
      await refreshHistory(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copyClientBlock() {
    if (!clientBlock) return;
    await navigator.clipboard.writeText(clientBlock);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleCheckEmail() {
    if (!canManageRequests) return;
    setEmailStatus("");
    setLoading(true);
    try {
      const result = await checkEmail();
      setEmailStatus(result.detail || `Писем в базе: ${result.total_seen || 0}`);
      await refreshEmails(emailFolder);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectEmailFolder(folder) {
    setEmailFolder(folder);
    setSelectedEmail(null);
    setEmailStatus("");
    try {
      await refreshEmails(folder);
    } catch (err) {
      setEmailStatus(err.message);
    }
  }

  function handleToggleEmailCollapsed() {
    const nextCollapsed = !emailCollapsed;
    setEmailCollapsed(nextCollapsed);
    if (nextCollapsed) setSelectedEmail(null);
  }

  async function handleOpenEmail(email) {
    if (selectedEmail?.id === email.id) {
      setSelectedEmail(null);
      setEmailStatus("");
      return;
    }

    setSelectedEmail(email);
    setEmailStatus("");
    if (email.is_read) return;

    try {
      const updated = await updateEmailMessage(email.id, { is_read: true });
      setSelectedEmail(updated);
      await refreshEmails(emailFolder);
    } catch (err) {
      setEmailStatus(err.message);
    }
  }

  async function handleUpdateEmail(email, payload) {
    if (!canManageRequests) return;
    setEmailStatus("");
    setLoading(true);
    try {
      const updated = await updateEmailMessage(email.id, payload);
      if (payload.folder && payload.folder !== emailFolder) {
        setSelectedEmail(null);
      } else {
        setSelectedEmail(updated);
      }
      await refreshEmails(emailFolder);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEmail(email) {
    if (!canManageRequests) return;
    if (!window.confirm("Переместить письмо в удаленные?")) return;
    setEmailStatus("");
    setLoading(true);
    try {
      await deleteEmailMessage(email.id);
      setSelectedEmail(null);
      await refreshEmails(emailFolder);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleHideEmailSender(email) {
    if (!canManageRequests || !email.from_address) return;
    setEmailStatus("");
    setLoading(true);
    try {
      const filter = await createEmailSenderFilter({
        sender_email: email.from_address,
        sender_label: email.from_address,
      });
      setSelectedEmail(null);
      await refreshEmails(emailFolder);
      setEmailStatus(`Письма от ${filter.sender_email || email.from_address} скрыты.`);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreEmailSender(filter) {
    if (!canManageRequests) return;
    setEmailStatus("");
    setLoading(true);
    try {
      await deleteEmailSenderFilter(filter.id);
      await refreshEmails(emailFolder);
      setEmailStatus(`Письма от ${filter.sender_email} снова показываются.`);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleProcessEmail(emailId) {
    if (!canManageRequests) return;
    setEmailStatus("");
    setLoading(true);
    try {
      const item = await processEmailMessage(emailId);
      await refreshHistory(item);
      setEmailFolder("in_work");
      await refreshEmails("in_work");
      setEmailStatus(`Создана заявка #${item.id} из письма.`);
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
  }

  function renderSenderFilterCheckbox(email) {
    if (!email.from_address || email.folder === "trash") return null;
    return (
      <label className="email-filter-checkbox">
        <input
          type="checkbox"
          checked={Boolean(email.is_sender_hidden)}
          onChange={(event) => {
            if (event.target.checked) handleHideEmailSender(email);
          }}
          disabled={loading || !canManageRequests || Boolean(email.is_sender_hidden)}
        />
        <span>Не показывать письма от этого отправителя</span>
      </label>
    );
  }

  function renderEmailDetail(email) {
    return (
      <div className="email-detail">
        <div className="email-detail-header">
          <div>
            <h3>{email.subject || "Без темы"}</h3>
            <p>{email.from_address || "Отправитель не определен"} → {email.to_address || email.mailbox_email || "ящик edel.kz"}</p>
            <small>Получено: {formatDateTime(email.received_at || email.created_at)}</small>
          </div>
          <div className="email-tags">
            <span className={`email-chip ${email.is_read ? "email-chip-read" : "email-chip-new"}`}>
              {email.is_read ? "Просмотрено" : "Новое"}
            </span>
            <span className="email-chip">{EMAIL_STATUS_LABELS[email.status] || "Получено"}</span>
            <span className="email-chip">{EMAIL_FOLDER_LABELS[email.folder] || "Полученные"}</span>
          </div>
        </div>

        {renderSenderFilterCheckbox(email)}

        {email.attachment_names && (
          <div className="email-attachments">
            <strong>Вложения:</strong> {email.attachment_names}
          </div>
        )}

        <pre className="email-body">{email.body_text || email.body_preview || "Текст письма пустой."}</pre>

        <div className="email-detail-actions">
          {email.folder !== "in_work" && email.folder !== "trash" && (
            <button
              className="secondary-button"
              onClick={() => handleUpdateEmail(email, { folder: "in_work", is_read: true })}
              disabled={loading || !canManageRequests}
            >
              <FolderOpen size={16} />
              В работу
            </button>
          )}
          {email.folder !== "suppliers" && email.folder !== "trash" && (
            <button
              className="secondary-button"
              onClick={() => handleUpdateEmail(email, { folder: "suppliers", is_read: true })}
              disabled={loading || !canManageRequests}
            >
              <FolderOpen size={16} />
              В поставщики
            </button>
          )}
          {email.folder !== "buyers" && email.folder !== "trash" && (
            <button
              className="secondary-button"
              onClick={() => handleUpdateEmail(email, { folder: "buyers", is_read: true })}
              disabled={loading || !canManageRequests}
            >
              <FolderOpen size={16} />
              В покупатели
            </button>
          )}
          {email.folder !== "done" && email.folder !== "trash" && (
            <button
              className="secondary-button"
              onClick={() => handleUpdateEmail(email, { folder: "done", is_read: true })}
              disabled={loading || !canManageRequests}
            >
              <Archive size={16} />
              Закрыть
            </button>
          )}
          {email.folder === "trash" && (
            <button
              className="secondary-button"
              onClick={() => handleUpdateEmail(email, { folder: "inbox", is_read: true })}
              disabled={loading || !canManageRequests}
            >
              <RotateCcw size={16} />
              Вернуть
            </button>
          )}
          <button
            className="secondary-button"
            onClick={() => handleUpdateEmail(email, { is_read: false })}
            disabled={loading || !canManageRequests || !email.is_read}
          >
            <Inbox size={16} />
            Не просмотрено
          </button>
          <button
            className="secondary-button"
            onClick={() => handleProcessEmail(email.id)}
            disabled={loading || !canManageRequests || Boolean(email.processed_request_id) || email.folder === "trash"}
          >
            <FilePlus2 size={16} />
            {email.processed_request_id ? `Заявка #${email.processed_request_id}` : "Создать заявку"}
          </button>
          {email.folder !== "trash" && (
            <button
              className="secondary-button danger-button"
              onClick={() => handleDeleteEmail(email)}
              disabled={loading || !canManageRequests}
            >
              <Trash2 size={16} />
              Удалить
            </button>
          )}
        </div>
      </div>
    );
  }

  async function handleSendClientEmail() {
    if (!selected || !clientBlock || !canManageRequests) return;
    setError("");
    const to = selected.client_contact_name || "";
    if (!to.includes("@")) {
      setError("У заявки нет email получателя.");
      return;
    }
    const subject = `Ответ ТОО Michael по заявке #${selected.id}`;
    if (!window.confirm(`Отправить черновик D на ${to}?`)) return;

    setEmailSendStatus("");
    setLoading(true);
    try {
      await sendEmailReply({
        request_id: selected.id,
        to,
        subject,
        body: clientBlock,
      });
      setEmailSendStatus(`Письмо отправлено: ${to}`);
      const events = await listRequestEvents(selected.id);
      setRequestEvents(events);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendWhatsAppTemplate() {
    if (!selected || !canManageRequests) return;
    setError("");
    setWhatsAppSendStatus("");
    if (!whatsappHealth?.configured) {
      setError("WhatsApp Cloud API не настроен: нужны WHATSAPP_ACCESS_TOKEN и WHATSAPP_PHONE_NUMBER_ID.");
      return;
    }
    const bodyParameters = whatsappDraft.body_parameters_text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const selectedTemplate = whatsappTemplates.find((template) => template.template_key === whatsappDraft.template_key);
    if (!selectedTemplate) {
      setError("Выберите утвержденный Meta шаблон.");
      return;
    }
    if (!window.confirm(`Отправить WhatsApp шаблон "${selectedTemplate.display_name}" на ${whatsappDraft.to_phone}?`)) return;

    setLoading(true);
    try {
      const result = await sendWhatsAppTemplate({
        request_id: selected.id,
        to: whatsappDraft.to_phone,
        template_key: whatsappDraft.template_key,
        body_parameters: bodyParameters,
      });
      setWhatsAppSendStatus(`WhatsApp шаблон отправлен: ${result.template_name}`);
      const events = await listRequestEvents(selected.id);
      setRequestEvents(events);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusSave() {
    if (!selected || !canManageRequests) return;
    setError("");
    setLoading(true);
    try {
      const item = await updateRequestStatus(selected.id, {
        ...statusDraft,
        actor: metadata.michael_manager || selected.michael_manager || "manager",
      });
      await refreshHistory(item);
      const events = await listRequestEvents(item.id);
      setRequestEvents(events);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDealDocumentsSave() {
    if (!selected || !canManageDocuments) return;
    setError("");
    setLoading(true);
    try {
      const item = await updateDealDocuments(selected.id, {
        ...dealDraft,
        actor: metadata.michael_manager || selected.michael_manager || "manager",
      });
      await refreshHistory(item);
      const events = await listRequestEvents(item.id);
      setRequestEvents(events);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadAppendix(fileName, html) {
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName || `appendix-request-${selected?.id || "draft"}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleGenerateAppendix() {
    if (!selected || !canManageDocuments) return;
    setError("");
    setLoading(true);
    try {
      const savedItem = await updateDealDocuments(selected.id, {
        ...dealDraft,
        actor: metadata.michael_manager || selected.michael_manager || "manager",
      });
      const result = await generateContractAppendix(savedItem.id);
      downloadAppendix(result.file_name, result.appendix_html);
      if (result.request) {
        await refreshHistory(result.request);
        const events = await listRequestEvents(result.request.id);
        setRequestEvents(events);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSelectedTasksAndEvents(requestId) {
    const [tasks, events] = await Promise.all([
      listRequestTasks(requestId),
      listRequestEvents(requestId),
    ]);
    setRequestTasks(tasks);
    setRequestEvents(events);
    listOpenTasks().then(setOpenTasks).catch(() => {});
    getCrmSummary().then(setCrmSummary).catch(() => {});
    listRequests().then(setRequests).catch(() => {});
  }

  async function refreshOpenTaskState(requestId) {
    const updates = [
      listOpenTasks().then(setOpenTasks).catch(() => {}),
      getCrmSummary().then(setCrmSummary).catch(() => {}),
      listRequests().then(setRequests).catch(() => {}),
    ];
    if (selected?.id === requestId) {
      updates.push(listRequestTasks(requestId).then(setRequestTasks).catch(() => {}));
      updates.push(listRequestEvents(requestId).then(setRequestEvents).catch(() => {}));
    }
    await Promise.all(updates);
  }

  async function handleTaskToggle(task) {
    if (!selected || !canManageTasks) return;
    setError("");
    setLoading(true);
    try {
      const nextStatus = task.status === "done" ? "open" : "done";
      await updateRequestTask(selected.id, task.id, {
        title: task.title,
        status: nextStatus,
        owner_name: task.owner_name || selected.michael_manager || "",
        due_date: task.due_date || "",
        actor: metadata.michael_manager || selected.michael_manager || "manager",
      });
      await refreshSelectedTasksAndEvents(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTaskCreate() {
    if (!selected || !canManageTasks || !newTaskTitle.trim()) return;
    setError("");
    setLoading(true);
    try {
      await createRequestTask(selected.id, {
        title: newTaskTitle,
        status: "open",
        owner_name: selected.michael_manager || metadata.michael_manager || "",
        actor: metadata.michael_manager || selected.michael_manager || "manager",
      });
      setNewTaskTitle("");
      await refreshSelectedTasksAndEvents(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenTaskClose(event, task) {
    event.stopPropagation();
    if (!canManageTasks) return;
    setError("");
    setLoading(true);
    try {
      await updateRequestTask(task.request_id, task.id, {
        title: task.title,
        status: "done",
        owner_name: task.owner_name || task.michael_manager || "",
        due_date: task.due_date || "",
        actor: metadata.michael_manager || task.michael_manager || "manager",
      });
      await refreshOpenTaskState(task.request_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenTaskDelete(event, task) {
    event.stopPropagation();
    if (!canManageTasks) return;
    if (!window.confirm(`Удалить задачу "${task.title}"?`)) return;
    setError("");
    setLoading(true);
    setOpenTasks((current) => current.filter((item) => item.id !== task.id));
    if (selected?.id === task.request_id) {
      setRequestTasks((current) => current.filter((item) => item.id !== task.id));
    }
    try {
      await deleteRequestTask(task.request_id, task.id);
      await refreshOpenTaskState(task.request_id);
    } catch (err) {
      setError(err.message);
      await refreshOpenTaskState(task.request_id);
    } finally {
      setLoading(false);
    }
  }

  async function handleHistoryRequestClose(event, item) {
    event.stopPropagation();
    if (!canManageRequests) return;
    setError("");
    setLoading(true);
    try {
      const updated = await updateRequestStatus(item.id, {
        status: "closed",
        priority: item.priority || "normal",
        next_action: item.next_action || "",
        actor: metadata.michael_manager || item.michael_manager || "manager",
      });
      await refreshHistory(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleHistoryRequestDelete(event, item) {
    event.stopPropagation();
    if (!canManageRequests) return;
    if (!window.confirm(`Удалить заявку #${item.id} из истории? Это действие нельзя отменить.`)) return;
    setError("");
    setLoading(true);
    try {
      await deleteRequest(item.id);
      const items = await listRequests();
      setRequests(items);
      setSelected((current) => current?.id === item.id ? (items[0] || null) : current);
      await Promise.all([
        listOpenTasks().then(setOpenTasks).catch(() => {}),
        getCrmSummary().then(setCrmSummary).catch(() => {}),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const canProcess = canManageRequests && Boolean(text.trim() || file) && !loading;
  const inputLabel = file ? "Пояснение к выбранному файлу" : "Текст заявки";
  const parserHealthClass = parserStatus?.reachable
    ? "ok"
    : parserStatus?.configured
      ? "error"
      : "warn";
  const parserHealthText = parserStatus?.reachable
    ? "подключен"
    : parserStatus?.configured
      ? "ошибка"
      : "PDF через Gemini";
  const onecMcpHealthClass = onecMcpStatus?.reachable
    ? "ok"
    : onecMcpStatus?.configured
      ? "error"
      : "warn";
  const onecMcpHealthText = onecMcpStatus?.reachable
    ? `подключен, инструментов ${onecMcpStatus.tools_count || 0}`
    : onecMcpStatus?.configured
      ? "ошибка"
      : "не настроен";
  const smtpHealthClass = smtpStatus?.reachable
    ? "ok"
    : smtpStatus?.configured
      ? "error"
      : "warn";
  const smtpHealthText = smtpStatus?.reachable
    ? "SMTP подключен"
    : smtpStatus?.configured
      ? "SMTP ошибка"
      : "SMTP не настроен";

  function updateMetadata(field, value) {
    setMetadata((current) => ({ ...current, [field]: value }));
  }

  function updateDealDraft(field, value) {
    setDealDraft((current) => ({ ...current, [field]: value }));
  }

  function selectTaskRequest(task) {
    const requestItem = requests.find((item) => Number(item.id) === Number(task.request_id));
    if (requestItem) setSelected(requestItem);
  }

  if (authLoading && !authUser) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={28} />
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="auth-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand">
            <FileText size={24} />
            <div>
              <h1>ИИ-менеджер</h1>
              <p>ТОО Michael</p>
            </div>
          </div>
          <label>
            <span>Имя пользователя</span>
            <input
              value={loginDraft.username}
              onChange={(event) => setLoginDraft((current) => ({ ...current, username: event.target.value }))}
              autoComplete="username"
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={loginDraft.password}
              onChange={(event) => setLoginDraft((current) => ({ ...current, password: event.target.value }))}
              autoComplete="current-password"
            />
          </label>
          {loginError && <div className="error-box">{loginError}</div>}
          <button className="primary-button" disabled={authLoading || !loginDraft.username || !loginDraft.password}>
            {authLoading ? <Loader2 className="spin" size={18} /> : null}
            Войти
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="history-panel">
        <div className="brand">
          <FileText size={24} />
          <div>
            <h1>ИИ-менеджер</h1>
            <p>ТОО Michael</p>
          </div>
        </div>

        <div className="user-card">
          <div>
            <strong>{authUser.display_name || authUser.username}</strong>
            <span>{ROLE_LABELS[authUser.role] || authUser.role}</span>
            <span>{authUser.email_address || "email не привязан"}</span>
          </div>
          <button className="icon-button" onClick={handleLogout} title="Выйти">
            <LogOut size={18} />
          </button>
        </div>

        {!canManageRequests && !canManageDocuments ? (
          <div className="role-note">Режим просмотра: изменение заявок недоступно.</div>
        ) : null}

        <div className="crm-summary">
          <div>
            <strong>{crmSummary?.open_requests ?? requests.length}</strong>
            <span>открыто</span>
          </div>
          <div>
            <strong>{crmSummary?.vip_requests ?? 0}</strong>
            <span>VIP</span>
          </div>
          <div>
            <strong>{crmSummary?.clients?.length ?? 0}</strong>
            <span>клиентов</span>
          </div>
          <div>
            <strong>{crmSummary?.open_tasks ?? openTasks.length}</strong>
            <span>задач</span>
          </div>
        </div>

        <div className="open-tasks-panel">
          <h2>Открытые задачи</h2>
          <div className="open-task-list">
            {openTasks.length === 0 && <p className="muted">Открытых задач нет</p>}
            {openTasks.slice(0, 8).map((task) => (
              <div className="open-task-item" key={task.id}>
                <button className="open-task-main" onClick={() => selectTaskRequest(task)}>
                  <strong>{task.title}</strong>
                  <span>
                    #{task.request_id}
                    {task.client_company ? ` · ${task.client_company}` : ""}
                  </span>
                  <small>
                    {PRIORITY_LABELS[task.priority || "normal"] || "Обычный"}
                    {task.requires_contract_appendix ? " · KBI договор" : ""}
                  </small>
                </button>
                {canManageTasks ? (
                  <div className="open-task-actions">
                    <button
                      className="task-action task-action-done"
                      disabled={loading}
                      onClick={(event) => handleOpenTaskClose(event, task)}
                      title="Закрыть задачу"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      className="task-action task-action-danger"
                      disabled={loading}
                      onClick={(event) => handleOpenTaskDelete(event, task)}
                      title="Удалить задачу"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <h2>История заявок</h2>
        <div className="history-list">
          {requests.length === 0 && <p className="muted">История пока пустая</p>}
            {requests.map((item) => (
              <div
                key={item.id}
                className={selected?.id === item.id ? "history-item active" : "history-item"}
              >
                <button className="history-main" onClick={() => setSelected(item)}>
                  <span>#{item.id} {requestTitle(item)}</span>
                  <div className="history-tags">
                    <small className={`status-pill status-${item.status || "new"}`}>
                      {STATUS_LABELS[item.status || "new"] || "Новая"}
                    </small>
                    <small className={`priority-pill priority-${item.priority || "normal"}`}>
                      {PRIORITY_LABELS[item.priority || "normal"] || "Обычный"}
                    </small>
                    {item.requires_contract_appendix ? <small className="vip-pill">KBI договор</small> : null}
                    {item.invoice_status && item.invoice_status !== "not_required" ? (
                      <small className="doc-pill">{INVOICE_STATUS_LABELS[item.invoice_status] || "Счет"}</small>
                    ) : null}
                    {item.contract_appendix_status && item.contract_appendix_status !== "not_required" ? (
                      <small className="doc-pill">
                        {APPENDIX_STATUS_LABELS[item.contract_appendix_status] || "Приложение"}
                      </small>
                    ) : null}
                    {Number(item.open_task_count || 0) > 0 ? (
                      <small className="task-pill">{item.open_task_count} задач</small>
                    ) : null}
                  </div>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </button>
                {canManageRequests ? (
                  <div className="history-actions">
                    <button
                      className="task-action task-action-done"
                      disabled={loading || ["closed", "done", "lost"].includes(item.status)}
                      onClick={(event) => handleHistoryRequestClose(event, item)}
                      title="Закрыть заявку"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      className="task-action task-action-danger"
                      disabled={loading}
                      onClick={(event) => handleHistoryRequestDelete(event, item)}
                      title="Удалить заявку"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
      </aside>

      <section className="workspace">
        <section className="input-area">
          <div className="section-title">
            <h2>Новая обработка</h2>
            <p>Зафиксируйте клиента, менеджеров, канал связи и вставьте текст или загрузите файл/голосовое.</p>
          </div>

          <div className="metadata-grid">
            <label>
              <span>Компания клиента</span>
              <input
                value={metadata.client_company}
                onChange={(event) => updateMetadata("client_company", event.target.value)}
                placeholder="Например: ТОО KBI Energy"
                disabled={!canManageRequests}
              />
            </label>
            <label>
              <span>Менеджер клиента</span>
              <input
                value={metadata.client_contact_name}
                onChange={(event) => updateMetadata("client_contact_name", event.target.value)}
                placeholder="Имя из WhatsApp/Telegram"
                disabled={!canManageRequests}
              />
            </label>
            <label>
              <span>Менеджер Michael</span>
              <input
                value={metadata.michael_manager}
                onChange={(event) => updateMetadata("michael_manager", event.target.value)}
                placeholder="Имя ответственного менеджера"
                disabled={!canManageRequests}
              />
            </label>
            <label>
              <span>Канал связи</span>
              <select
                value={metadata.communication_channel}
                onChange={(event) => updateMetadata("communication_channel", event.target.value)}
                disabled={!canManageRequests}
              >
                <option value="WhatsApp">WhatsApp</option>
                <option value="Telegram">Telegram</option>
                <option value="Email">Email</option>
                <option value="Телефон">Телефон</option>
                <option value="Другое">Другое</option>
              </select>
            </label>
            <label>
              <span>Приоритет</span>
              <select
                value={metadata.priority}
                onChange={(event) => updateMetadata("priority", event.target.value)}
                disabled={!canManageRequests}
              >
                {PRIORITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="metadata-wide">
              <span>Следующее действие</span>
              <input
                value={metadata.next_action}
                onChange={(event) => updateMetadata("next_action", event.target.value)}
                placeholder="Например: уточнить цену, выставить счет, отправить приложение"
                disabled={!canManageRequests}
              />
            </label>
          </div>

          <label className="field-label" htmlFor="request-text">
            {inputLabel}
          </label>
          <textarea
            id="request-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              file
                ? "Пояснение к файлу: клиент просит 50 шт этого товара, нужна цена с НДС и счет на ТОО..."
                : "Текст или расшифровка заявки: Добрый день, нужен кабель ВВГнг-LS 3х2.5, 200 м..."
            }
            disabled={loading}
            readOnly={!canManageRequests}
          />

          <div className="input-controls">
            <label className="file-picker">
              <Upload size={18} />
              <span>{file ? "Заменить файл" : "Выбрать файл"}</span>
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.pdf,.docx,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.ogg,.opus,.webm"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                }}
                disabled={!canManageRequests}
              />
            </label>

            {file && (
              <button
                className="secondary-button"
                onClick={() => {
                  setFile(null);
                  setFileInputKey((value) => value + 1);
                }}
                disabled={loading || !canManageRequests}
              >
                Очистить файл
              </button>
            )}

            <button className="primary-button" onClick={handleProcess} disabled={!canProcess}>
              {loading ? <Loader2 className="spin" size={18} /> : null}
              Обработать
            </button>
          </div>

          <div className={`service-status service-status-${parserHealthClass}`}>
            <Server size={18} />
            <div>
              <strong>Parser-service</strong>
              <span>{parserLoading ? "проверяется" : parserHealthText}</span>
              {!parserStatus?.configured && !parserLoading ? (
                <small>DOCX/XLSX требуют внешний сервис</small>
              ) : null}
            </div>
            <button
              className="icon-button"
              onClick={refreshParserStatus}
              disabled={parserLoading}
              title="Проверить parser-service"
            >
              <RefreshCw className={parserLoading ? "spin" : ""} size={16} />
            </button>
          </div>

          {authUser?.role === "admin" ? (
            <div className={`service-status service-status-${onecMcpHealthClass}`}>
              <Database size={18} />
              <div>
                <strong>1C MCP</strong>
                <span>{onecMcpLoading ? "проверяется" : onecMcpHealthText}</span>
                {!onecMcpStatus?.configured && !onecMcpLoading ? (
                  <small>нужен onec-mcp-bridge рядом с 1С</small>
                ) : null}
              </div>
              <button
                className="icon-button"
                onClick={refreshOneCMcpStatus}
                disabled={onecMcpLoading}
                title="Проверить 1C MCP bridge"
              >
                <RefreshCw className={onecMcpLoading ? "spin" : ""} size={16} />
              </button>
            </div>
          ) : null}

          {file && (
            <div className="selected-file">
              <strong>Выбран файл:</strong>
              <span>{file.name}</span>
            </div>
          )}

          {!canManageRequests && <div className="role-note">Ваша роль не позволяет создавать новые AI-обработки.</div>}
          {error && <div className="error-box">{error}</div>}
        </section>

        {authUser?.role === "admin" ? (
          <section className="input-area onec-tools-area">
            <div className="section-title section-title-with-action">
              <div>
                <h2>1C</h2>
                <p>Безопасные проверки через MCP: только чтение из 1С, без создания и проведения документов.</p>
              </div>
              <div className={`service-status service-status-${onecMcpHealthClass}`}>
                <Database size={18} />
                <div>
                  <strong>Статус</strong>
                  <span>{onecMcpLoading ? "проверяется" : onecMcpHealthText}</span>
                </div>
              </div>
            </div>

            <div className="onec-tools-grid">
              <label>
                <span>Клиент / БИН</span>
                <input
                  value={onecLookupDraft.client}
                  onChange={(event) => updateOnecLookupDraft("client", event.target.value)}
                  placeholder="ТОО KBI Energy или БИН"
                />
              </label>
              <label>
                <span>Товар / артикул / код</span>
                <input
                  value={onecLookupDraft.item}
                  onChange={(event) => updateOnecLookupDraft("item", event.target.value)}
                  placeholder="Например: 03-0101, кабель, ЦБ-00009583"
                />
              </label>
            </div>

            <div className="onec-button-row">
              <button className="secondary-button" onClick={handleOneCCheck} disabled={Boolean(onecLookupLoading)}>
                {onecLookupLoading === "health" ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
                Проверить 1C
              </button>
              <button className="secondary-button" onClick={handleOneCClientSearch} disabled={Boolean(onecLookupLoading)}>
                {onecLookupLoading === "client" ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
                Найти клиента в 1С
              </button>
              <button className="secondary-button" onClick={handleOneCItemSearch} disabled={Boolean(onecLookupLoading)}>
                {onecLookupLoading === "item" ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
                Найти товар в 1С
              </button>
              <button className="secondary-button" onClick={handleOneCStockAndPrices} disabled={Boolean(onecLookupLoading)}>
                {onecLookupLoading === "stock" ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
                Проверить остатки и цены
              </button>
            </div>

            {onecLookupResult ? (
              <div className={onecLookupResult.error ? "onec-result onec-result-error" : "onec-result"}>
                <div className="onec-result-header">
                  <strong>{onecLookupResult.title}</strong>
                  <button className="icon-button" onClick={() => setOnecLookupResult(null)} title="Свернуть результат 1C">
                    <ChevronUp size={16} />
                  </button>
                </div>
                {onecLookupResult.error ? (
                  <div className="error-box">{onecLookupResult.error}</div>
                ) : (
                  <pre>{onecLookupResult.body}</pre>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="input-area email-area">
          <div className="section-title section-title-with-action">
            <div>
              <h2>Входящая почта</h2>
              <p>
                {authUser.role === "admin"
                  ? "Письма из привязанных ящиков edel.kz поступают через IMAP-ingest и сохраняются в программе."
                  : authUser.email_address
                    ? `Письма из ${authUser.email_address} поступают через IMAP-ingest и сохраняются в программе.`
                    : "Email edel.kz не привязан к вашему пользователю. Обратитесь к администратору."}
              </p>
            </div>
            <button className="secondary-button compact-button" onClick={handleToggleEmailCollapsed}>
              {emailCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              {emailCollapsed ? "Показать почту" : "Свернуть почту"}
            </button>
          </div>

          {emailCollapsed ? (
            <div className="email-collapsed-note">
              Почта свернута. Нажмите «Показать почту», чтобы открыть список писем.
            </div>
          ) : (
            <>
              <div className="email-controls">
                <button className="secondary-button" onClick={handleCheckEmail} disabled={loading || !canManageRequests}>
                  <Mail size={18} />
                  Обновить письма
                </button>
                <button className="secondary-button" onClick={() => setSelectedEmail(null)} disabled={!selectedEmail}>
                  <ChevronUp size={18} />
                  Свернуть письмо
                </button>
                <span className={`email-status email-status-${smtpHealthClass}`}>{smtpHealthText}</span>
                {emailStatus && <span className="email-status">{emailStatus}</span>}
              </div>

              <div className="email-folder-tabs">
                {EMAIL_FOLDERS.map(([folder, label]) => {
                  const stats = emailStats[folder] || { total: 0, unread: 0 };
                  return (
                    <button
                      key={folder}
                      className={`email-folder-tab ${emailFolder === folder ? "email-folder-tab-active" : ""}`}
                      onClick={() => handleSelectEmailFolder(folder)}
                      disabled={loading}
                    >
                      <span>{label}</span>
                      <small>{stats.total || 0}{stats.unread ? ` / новых ${stats.unread}` : ""}</small>
                    </button>
                  );
                })}
                {emailSenderFilters.length > 0 && (
                  <button
                    className={`email-folder-tab email-folder-tab-secondary ${!emailSenderFiltersCollapsed ? "email-folder-tab-active" : ""}`}
                    onClick={() => setEmailSenderFiltersCollapsed((current) => !current)}
                    disabled={loading}
                  >
                    <span>Скрытые</span>
                    <small>{emailSenderFilters.length} адресов</small>
                  </button>
                )}
              </div>

              {emailSenderFilters.length > 0 && !emailSenderFiltersCollapsed && (
                <div className="email-sender-filters">
                  <div className="email-sender-filter-list">
                    {emailSenderFilters.map((filter) => (
                      <span className="email-sender-filter" key={filter.id}>
                        {filter.sender_label || filter.sender_email}
                        <button
                          type="button"
                          onClick={() => handleRestoreEmailSender(filter)}
                          disabled={loading || !canManageRequests}
                        >
                          показывать
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="email-list">
                {emails.length === 0 && (
                  <p className="muted">
                    Писем пока нет. Запустите IMAP-ingest для нужного ящика edel.kz и нажмите «Обновить письма».
                  </p>
                )}
                {emails.map((email) => (
                  <div className="email-list-entry" key={email.id}>
                    <article className={`email-item ${selectedEmail?.id === email.id ? "email-item-selected" : ""} ${email.is_read ? "" : "email-item-unread"}`}>
                      <div className="email-main">
                        <strong>{email.subject || "Без темы"}</strong>
                        <span>{email.from_address || "Отправитель не определен"}</span>
                        <small>Ящик: {email.mailbox_email || "не указан"}</small>
                        <small>Получено: {formatDateTime(email.received_at || email.created_at)}</small>
                        <div className="email-tags">
                          <span className={`email-chip ${email.is_read ? "email-chip-read" : "email-chip-new"}`}>
                            {email.is_read ? "Просмотрено" : "Новое"}
                          </span>
                          <span className="email-chip">{EMAIL_STATUS_LABELS[email.status] || "Получено"}</span>
                          <span className="email-chip">{EMAIL_FOLDER_LABELS[email.folder] || "Полученные"}</span>
                          {email.processed_request_id && <span className="email-chip email-chip-linked">Заявка #{email.processed_request_id}</span>}
                        </div>
                        {email.body_preview && <small className="email-preview">{email.body_preview}</small>}
                        {email.michael_manager && <small>Менеджер Michael: {email.michael_manager}</small>}
                        {email.attachment_names && <small>Вложения: {email.attachment_names}</small>}
                        {selectedEmail?.id !== email.id && renderSenderFilterCheckbox(email)}
                      </div>
                      <div className="email-item-actions">
                        {email.folder === "trash" ? (
                          <button
                            className="secondary-button"
                            onClick={() => handleUpdateEmail(email, { folder: "inbox", is_read: true })}
                            disabled={loading || !canManageRequests}
                          >
                            <RotateCcw size={16} />
                            Вернуть
                          </button>
                        ) : (
                          <button
                            className="secondary-button danger-button"
                            onClick={() => handleDeleteEmail(email)}
                            disabled={loading || !canManageRequests}
                          >
                            <Trash2 size={16} />
                            Удалить
                          </button>
                        )}
                        <button className="secondary-button" onClick={() => handleOpenEmail(email)} disabled={loading}>
                          {selectedEmail?.id === email.id ? <ChevronUp size={16} /> : <Eye size={16} />}
                          {selectedEmail?.id === email.id ? "Свернуть" : "Открыть"}
                        </button>
                      </div>
                    </article>
                    {selectedEmail?.id === email.id && renderEmailDetail(selectedEmail)}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {authUser.role === "admin" && (
          <section className="input-area users-area">
            <div className="section-title">
              <h2>Пользователи</h2>
              <p>Аккаунты менеджеров Michael и бухгалтерии</p>
            </div>

            <div className="user-create-grid">
              <label>
                <span>Логин</span>
                <input
                  value={userDraft.username}
                  onChange={(event) => setUserDraft((current) => ({ ...current, username: event.target.value }))}
                  placeholder="manager1"
                />
              </label>
              <label>
                <span>Имя</span>
                <input
                  value={userDraft.display_name}
                  onChange={(event) => setUserDraft((current) => ({ ...current, display_name: event.target.value }))}
                  placeholder="Менеджер Michael"
                />
              </label>
              <label>
                <span>Email edel.kz</span>
                <input
                  value={userDraft.email_address}
                  onChange={(event) => setUserDraft((current) => ({ ...current, email_address: event.target.value }))}
                  placeholder="manager@edel.kz"
                />
              </label>
              <label>
                <span>Роль</span>
                <select
                  value={userDraft.role}
                  onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value }))}
                >
                  {ROLE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Пароль</span>
                <input
                  type="password"
                  value={userDraft.password}
                  onChange={(event) => setUserDraft((current) => ({ ...current, password: event.target.value }))}
                  placeholder="минимум 8 символов"
                />
              </label>
              <button
                className="secondary-button"
                onClick={handleCreateUser}
                disabled={loading || !userDraft.username || !userDraft.password}
              >
                <UserPlus size={18} />
                Добавить
              </button>
            </div>

            <div className="users-list">
              {users.map((user) => (
                <article className="user-row" key={user.id}>
                  <Shield size={18} />
                  <div>
                    <strong>{user.display_name}</strong>
                    <span>
                      {user.username} · {ROLE_LABELS[user.role] || user.role} ·{" "}
                      {user.is_active ? "активен" : "отключен"}
                    </span>
                  </div>
                  <label className="user-email-field">
                    <span>Email edel.kz</span>
                    <input
                      value={user.email_address || ""}
                      onChange={(event) => setUsers((current) => current.map((item) => (
                        item.id === user.id ? { ...item, email_address: event.target.value } : item
                      )))}
                      placeholder="user@edel.kz"
                      disabled={loading}
                    />
                  </label>
                  <button className="secondary-button" onClick={() => handleUpdateUserEmail(user)} disabled={loading}>
                    Сохранить email
                  </button>
                  <button className="secondary-button" onClick={() => handleResetUserPassword(user)} disabled={loading}>
                    Сбросить пароль
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => handleToggleUserActive(user)}
                    disabled={loading || Number(user.id) === Number(authUser.id)}
                    title={Number(user.id) === Number(authUser.id) ? "Нельзя отключить текущий аккаунт" : ""}
                  >
                    {user.is_active ? "Отключить" : "Включить"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {authUser.role === "admin" && (
          <section className="input-area ai-rules-area">
            <div className="section-title">
              <h2>Правила ИИ и 1С</h2>
              <p>Эти правила добавляются к системному промпту при каждой новой обработке.</p>
            </div>

            <div className="rules-list">
              {aiRules.map((rule) => (
                <article className="rule-card" key={rule.rule_key}>
                  <div className="rule-card-header">
                    <label className="rule-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.is_enabled)}
                        disabled={loading || Number(rule.is_required) === 1}
                        onChange={(event) => updateAiRuleDraft(rule.rule_key, "is_enabled", event.target.checked ? 1 : 0)}
                      />
                      <span>{rule.title}</span>
                    </label>
                    {Number(rule.is_required) === 1 ? <small>обязательное</small> : null}
                  </div>
                  <textarea
                    value={rule.rule_text || ""}
                    onChange={(event) => updateAiRuleDraft(rule.rule_key, "rule_text", event.target.value)}
                    disabled={loading}
                    rows={3}
                  />
                </article>
              ))}
              {aiRules.length === 0 && <p className="muted">Правила еще не загружены.</p>}
            </div>

            <div className="rules-actions">
              <button className="secondary-button" onClick={refreshAiRules} disabled={loading}>
                <RefreshCw size={18} />
                Обновить
              </button>
              <button className="primary-button" onClick={handleAiRulesSave} disabled={loading || aiRules.length === 0}>
                {loading ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                Сохранить правила
              </button>
              {aiRulesStatus && <span className="email-status">{aiRulesStatus}</span>}
            </div>
          </section>
        )}

        {authUser.role === "admin" && (
          <section className="input-area whatsapp-templates-area">
            <div className="section-title section-title-with-action">
              <div>
                <h2>Meta WhatsApp шаблоны</h2>
                <p>Укажите точные имена шаблонов, которые уже утверждены в Meta Business Manager.</p>
              </div>
              <button
                className="secondary-button compact-button"
                onClick={() => setWhatsappTemplatesCollapsed((current) => !current)}
              >
                {whatsappTemplatesCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                {whatsappTemplatesCollapsed ? "Показать шаблоны" : "Свернуть шаблоны"}
              </button>
            </div>

            {whatsappTemplatesCollapsed ? (
              <div className="email-collapsed-note">
                Шаблоны свернуты. Нажмите «Показать шаблоны», чтобы открыть настройки Meta WhatsApp.
              </div>
            ) : (
              <>
                <div className="integration-status">
                  <MessageCircle size={18} />
                  <span>
                    {whatsappHealth?.configured
                      ? `Cloud API настроен, Phone Number ID ${whatsappHealth.phone_number_id}`
                      : "Cloud API не настроен: добавьте secrets WHATSAPP_ACCESS_TOKEN и WHATSAPP_PHONE_NUMBER_ID"}
                  </span>
                  <button className="icon-button" onClick={refreshWhatsAppHealth} disabled={loading} title="Проверить WhatsApp Cloud API">
                    <RefreshCw size={16} />
                  </button>
                </div>

                <div className="whatsapp-template-create">
                  <label>
                    <span>Название</span>
                    <input
                      value={whatsappTemplateDraft.display_name}
                      onChange={(event) => setWhatsAppTemplateDraft((current) => ({ ...current, display_name: event.target.value }))}
                      disabled={loading}
                      placeholder="Например: Счет KBI отправлен"
                    />
                  </label>
                  <label>
                    <span>Meta template name</span>
                    <input
                      value={whatsappTemplateDraft.template_name}
                      onChange={(event) => setWhatsAppTemplateDraft((current) => ({ ...current, template_name: event.target.value }))}
                      disabled={loading}
                      placeholder="kbi_invoice_sent"
                    />
                  </label>
                  <label>
                    <span>Язык</span>
                    <input
                      value={whatsappTemplateDraft.language_code}
                      onChange={(event) => setWhatsAppTemplateDraft((current) => ({ ...current, language_code: event.target.value }))}
                      disabled={loading}
                      placeholder="ru"
                    />
                  </label>
                  <label>
                    <span>Категория</span>
                    <select
                      value={whatsappTemplateDraft.category}
                      onChange={(event) => setWhatsAppTemplateDraft((current) => ({ ...current, category: event.target.value }))}
                      disabled={loading}
                    >
                      {WHATSAPP_TEMPLATE_CATEGORY_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="whatsapp-template-create-body">
                    <span>Текст-подсказка</span>
                    <input
                      value={whatsappTemplateDraft.body_text}
                      onChange={(event) => setWhatsAppTemplateDraft((current) => ({ ...current, body_text: event.target.value }))}
                      disabled={loading}
                      placeholder="Кратко, что отправляет этот шаблон"
                    />
                  </label>
                  <button
                    className="secondary-button"
                    onClick={handleCreateWhatsAppTemplate}
                    disabled={loading || !whatsappTemplateDraft.display_name || !whatsappTemplateDraft.template_name || !whatsappTemplateDraft.body_text}
                  >
                    <Plus size={18} />
                    Добавить шаблон
                  </button>
                </div>

                <div className="whatsapp-template-list">
                  {whatsappTemplates.map((template) => (
                    <article className="whatsapp-template-card" key={template.template_key}>
                      <div className="rule-card-header">
                        <label className="rule-toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(template.is_enabled)}
                            disabled={loading}
                            onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "is_enabled", event.target.checked ? 1 : 0)}
                          />
                          <span>{template.display_name}</span>
                        </label>
                        <small>{template.category || "UTILITY"}</small>
                      </div>
                      <div className="whatsapp-template-grid">
                        <label>
                          <span>Название в программе</span>
                          <input
                            value={template.display_name || ""}
                            onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "display_name", event.target.value)}
                            disabled={loading}
                          />
                        </label>
                        <label>
                          <span>Meta template name</span>
                          <input
                            value={template.template_name || ""}
                            onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "template_name", event.target.value)}
                            disabled={loading}
                            placeholder="invoice_appendix_ready"
                          />
                        </label>
                        <label>
                          <span>Язык</span>
                          <input
                            value={template.language_code || "ru"}
                            onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "language_code", event.target.value)}
                            disabled={loading}
                            placeholder="ru"
                          />
                        </label>
                        <label>
                          <span>Категория</span>
                          <select
                            value={template.category || "UTILITY"}
                            onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "category", event.target.value)}
                            disabled={loading}
                          >
                            {WHATSAPP_TEMPLATE_CATEGORY_OPTIONS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={template.body_text || ""}
                        onChange={(event) => updateWhatsAppTemplateDraft(template.template_key, "body_text", event.target.value)}
                        disabled={loading}
                        rows={2}
                        placeholder="Текст для понимания менеджером. Реальный текст должен совпадать с утвержденным шаблоном Meta."
                      />
                    </article>
                  ))}
                  {whatsappTemplates.length === 0 && <p className="muted">Шаблоны еще не загружены.</p>}
                </div>

                <div className="rules-actions">
                  <button className="secondary-button" onClick={refreshWhatsAppTemplates} disabled={loading}>
                    <RefreshCw size={18} />
                    Обновить
                  </button>
                  <button className="primary-button" onClick={handleWhatsAppTemplatesSave} disabled={loading || whatsappTemplates.length === 0}>
                    {loading ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
                    Сохранить шаблоны
                  </button>
                  {whatsappTemplatesStatus && <span className="email-status">{whatsappTemplatesStatus}</span>}
                </div>
              </>
            )}
          </section>
        )}

        <section className="result-area">
          <div className="result-header">
            <div>
              <h2>Результат A-F</h2>
              <p>{selected ? `Заявка #${selected.id}` : "Выберите заявку или обработайте новую"}</p>
            </div>
            <div className="result-actions">
              <button className="secondary-button" onClick={copyClientBlock} disabled={!clientBlock}>
                <Clipboard size={18} />
                {copied ? "Скопировано" : "Копировать D"}
              </button>
              <button
                className="secondary-button"
                onClick={handleSendClientEmail}
                disabled={
                  loading ||
                  !canManageRequests ||
                  !clientBlock ||
                  !selected?.client_contact_name?.includes("@")
                }
                title={!selected?.client_contact_name?.includes("@") ? "У заявки нет email получателя" : "Отправить D по Email"}
              >
                <Mail size={18} />
                Отправить Email
              </button>
            </div>
          </div>

          {emailSendStatus && <div className="email-send-status">{emailSendStatus}</div>}
          {whatsappSendStatus && <div className="email-send-status">{whatsappSendStatus}</div>}

          {!selected && <div className="empty-state">Результат появится здесь после обработки заявки.</div>}

          {selected && (
            <>
            <div className="whatsapp-send-panel">
              <div className="section-title">
                <h3>WhatsApp Meta</h3>
                <p>Отправка только утвержденного template message через Cloud API.</p>
              </div>
              <div className="whatsapp-send-grid">
                <label>
                  <span>Номер WhatsApp</span>
                  <input
                    value={whatsappDraft.to_phone}
                    onChange={(event) => setWhatsAppDraft((current) => ({ ...current, to_phone: event.target.value }))}
                    placeholder="77001234567"
                    disabled={loading || !canManageRequests}
                  />
                </label>
                <label>
                  <span>Шаблон Meta</span>
                  <select
                    value={whatsappDraft.template_key}
                    onChange={(event) => setWhatsAppDraft((current) => ({ ...current, template_key: event.target.value }))}
                    disabled={loading || !canManageRequests}
                  >
                    <option value="">Выберите шаблон</option>
                    {whatsappTemplates.filter((template) => template.is_enabled).map((template) => (
                      <option key={template.template_key} value={template.template_key}>
                        {template.display_name} · {template.template_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="whatsapp-params-field">
                  <span>Переменные BODY по строкам</span>
                  <textarea
                    value={whatsappDraft.body_parameters_text}
                    onChange={(event) => setWhatsAppDraft((current) => ({ ...current, body_parameters_text: event.target.value }))}
                    placeholder={"Если в шаблоне есть {{1}}, {{2}}, укажите значения по строкам.\nНапример:\n5940\n392 400,00 KZT"}
                    rows={3}
                    disabled={loading || !canManageRequests}
                  />
                </label>
                <button
                  className="primary-button"
                  onClick={handleSendWhatsAppTemplate}
                  disabled={
                    loading ||
                    !canManageRequests ||
                    !whatsappHealth?.configured ||
                    !whatsappDraft.to_phone ||
                    !whatsappDraft.template_key
                  }
                  title={!whatsappHealth?.configured ? "WhatsApp Cloud API не настроен" : "Отправить утвержденный шаблон"}
                >
                  <Send size={18} />
                  Отправить WhatsApp
                </button>
              </div>
            </div>

            <div className="request-card">
              <div className="request-card-main">
                <div>
                  <span>Клиент</span>
                  <strong>{selected.client_company || "не указан"}</strong>
                </div>
                <div>
                  <span>Контакт</span>
                  <strong>{selected.client_contact_name || "не указан"}</strong>
                </div>
                <div>
                  <span>Менеджер Michael</span>
                  <strong>{selected.michael_manager || "не указан"}</strong>
                </div>
                <div>
                  <span>Канал</span>
                  <strong>{selected.communication_channel || "не указан"}</strong>
                </div>
              </div>

              {selected.requires_contract_appendix ? (
                <div className="contract-note">
                  KBI Energy: счет оформлять от ТОО Michael и отправлять вместе с приложением к годовому договору.
                </div>
              ) : null}

              <div className="status-editor">
                <label>
                  <span>Статус</span>
                  <select
                    value={statusDraft.status}
                    onChange={(event) => setStatusDraft((current) => ({ ...current, status: event.target.value }))}
                    disabled={loading || !canManageRequests}
                  >
                    {STATUS_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Приоритет</span>
                  <select
                    value={statusDraft.priority}
                    onChange={(event) => setStatusDraft((current) => ({ ...current, priority: event.target.value }))}
                    disabled={loading || !canManageRequests}
                  >
                    {PRIORITY_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="status-next-action">
                  <span>Следующее действие</span>
                  <input
                    value={statusDraft.next_action}
                    onChange={(event) => setStatusDraft((current) => ({ ...current, next_action: event.target.value }))}
                    placeholder="Что сделать дальше"
                    disabled={loading || !canManageRequests}
                  />
                </label>
                <button className="secondary-button" onClick={handleStatusSave} disabled={loading || !canManageRequests}>
                  Сохранить статус
                </button>
              </div>
              {!canManageRequests ? (
                <div className="role-note">Ваша роль не позволяет менять статус и приоритет заявки.</div>
              ) : null}

              <div className="deal-documents">
                <div className="deal-documents-title">
                  <h3>Документы сделки</h3>
                  <p>Счет, приложение к договору и факт отправки клиенту</p>
                </div>
                <div className="deal-documents-grid">
                  <label>
                    <span>Номер счета</span>
                    <input
                      value={dealDraft.invoice_number}
                      onChange={(event) => updateDealDraft("invoice_number", event.target.value)}
                      placeholder="Например: 5262"
                      disabled={loading || !canManageDocuments}
                    />
                  </label>
                  <label>
                    <span>Дата счета</span>
                    <input
                      type="date"
                      value={dealDraft.invoice_date}
                      onChange={(event) => updateDealDraft("invoice_date", event.target.value)}
                      disabled={loading || !canManageDocuments}
                    />
                  </label>
                  <label>
                    <span>Статус счета</span>
                    <select
                      value={dealDraft.invoice_status}
                      onChange={(event) => updateDealDraft("invoice_status", event.target.value)}
                      disabled={loading || !canManageDocuments}
                    >
                      {INVOICE_STATUS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Приложение</span>
                    <select
                      value={dealDraft.contract_appendix_status}
                      onChange={(event) => updateDealDraft("contract_appendix_status", event.target.value)}
                      disabled={loading || !canManageDocuments}
                    >
                      {APPENDIX_STATUS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Дата отправки</span>
                    <input
                      type="date"
                      value={dealDraft.customer_sent_at}
                      onChange={(event) => updateDealDraft("customer_sent_at", event.target.value)}
                      disabled={loading || !canManageDocuments}
                    />
                  </label>
                  <label className="deal-note">
                    <span>Примечание</span>
                    <input
                      value={dealDraft.contract_appendix_note}
                      onChange={(event) => updateDealDraft("contract_appendix_note", event.target.value)}
                      placeholder="Например: счет и приложение отправлены в WhatsApp"
                      disabled={loading || !canManageDocuments}
                    />
                  </label>
                </div>
                {!canManageDocuments ? (
                  <div className="role-note">Ваша роль не позволяет сохранять документы сделки.</div>
                ) : null}
                <div className="deal-documents-actions">
                  <button className="secondary-button" onClick={handleGenerateAppendix} disabled={loading || !canManageDocuments || !selected}>
                    <FilePlus2 size={18} /> Создать приложение
                  </button>
                  <button className="secondary-button" onClick={handleDealDocumentsSave} disabled={loading || !canManageDocuments}>
                    Сохранить документы
                  </button>
                </div>
              </div>

              <div className="task-checklist">
                <div className="task-checklist-title">
                  <div>
                    <h3>Задачи по заявке</h3>
                    <p>Контроль действий менеджера до закрытия заявки</p>
                  </div>
                  <span>
                    {requestTasks.filter((task) => task.status === "done").length}/{requestTasks.length}
                  </span>
                </div>

                <div className="task-list">
                  {requestTasks.length === 0 && <p className="muted">Задач пока нет.</p>}
                  {requestTasks.map((task) => (
                    <label className={task.status === "done" ? "task-item task-done" : "task-item"} key={task.id}>
                      <input
                        type="checkbox"
                        checked={task.status === "done"}
                        onChange={() => handleTaskToggle(task)}
                        disabled={loading || !canManageTasks}
                      />
                      <CheckSquare size={18} />
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {TASK_STATUS_LABELS[task.status] || task.status}
                          {task.owner_name ? ` · ${task.owner_name}` : ""}
                          {task.due_date ? ` · до ${task.due_date}` : ""}
                        </small>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="task-create">
                  <input
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                    placeholder="Добавить задачу: отправить счет и приложение в WhatsApp"
                    disabled={loading || !canManageTasks}
                  />
                  <button
                    className="secondary-button"
                    onClick={handleTaskCreate}
                    disabled={loading || !canManageTasks || !newTaskTitle.trim()}
                  >
                    <Plus size={18} />
                    Добавить
                  </button>
                </div>
                {!canManageTasks ? (
                  <div className="role-note">Ваша роль не позволяет менять задачи по заявке.</div>
                ) : null}
              </div>
            </div>

            <div className="result-grid">
              {resultSections.length > 0 ? (
                resultSections.map((section) => (
                  <article key={section.slice(0, 40)} className="result-section">
                    <pre>{section}</pre>
                  </article>
                ))
              ) : (
                <article className="result-section">
                  <pre>{selected.ai_result}</pre>
                </article>
              )}
            </div>

            <div className="events-area">
              <h3>Журнал действий</h3>
              {requestEvents.length === 0 && <p className="muted">Событий пока нет.</p>}
              {requestEvents.map((event) => (
                <article className="event-item" key={event.id}>
                  <strong>{event.event_type}</strong>
                  <span>{event.actor || "system"}</span>
                  <small>{new Date(event.created_at).toLocaleString()}</small>
                </article>
              ))}
            </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
