import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Clipboard, FileText, Loader2, LogOut, Mail, Plus, RefreshCw, Server, Shield, Upload, UserPlus } from "lucide-react";
import {
  checkEmail,
  createUser,
  createRequestTask,
  getCrmSummary,
  getCurrentUser,
  getEmailSmtpHealth,
  getParserHealth,
  listEmailMessages,
  listOpenTasks,
  listRequestEvents,
  listRequestTasks,
  listRequests,
  listUsers,
  login,
  logout,
  processEmailMessage,
  processText,
  resetUserPassword,
  sendEmailReply,
  updateDealDocuments,
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

function requestTitle(item) {
  if (item.source_type === "text") return "Текстовая заявка";
  if (item.source_type === "image") return `Изображение: ${item.uploaded_file_name}`;
  if (item.source_type === "audio") return `Голос: ${item.uploaded_file_name}`;
  if (item.source_type === "email") return "Email-заявка";
  return item.uploaded_file_name || "Файл заявки";
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

const ROLE_OPTIONS = [
  ["admin", "Администратор"],
  ["manager", "Менеджер: заявки + счета"],
  ["accountant", "Бухгалтер: счета"],
  ["viewer", "Просмотр"],
];

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS);

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [loginDraft, setLoginDraft] = useState({ username: "manager", password: "" });
  const [loginError, setLoginError] = useState("");
  const [users, setUsers] = useState([]);
  const [userDraft, setUserDraft] = useState({
    username: "",
    display_name: "",
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
  const [emailStatus, setEmailStatus] = useState("");
  const [emailSendStatus, setEmailSendStatus] = useState("");
  const [smtpStatus, setSmtpStatus] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [crmSummary, setCrmSummary] = useState(null);
  const [parserStatus, setParserStatus] = useState(null);
  const [parserLoading, setParserLoading] = useState(false);
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

  async function refreshEmails() {
    const items = await listEmailMessages();
    setEmails(items);
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
    refreshSmtpStatus().catch(() => {});
    refreshUsers().catch(() => {});
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
    setCrmSummary(null);
  }

  async function handleCreateUser() {
    setError("");
    setLoading(true);
    try {
      await createUser(userDraft);
      setUserDraft({ username: "", display_name: "", role: "manager", password: "" });
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
      setEmailStatus(`Новых писем: ${result.imported}, пропущено: ${result.skipped}`);
      await refreshEmails();
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
      await refreshEmails();
    } catch (err) {
      setEmailStatus(err.message);
    } finally {
      setLoading(false);
    }
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
              <button className="open-task-item" key={task.id} onClick={() => selectTaskRequest(task)}>
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
            ))}
          </div>
        </div>

        <h2>История заявок</h2>
        <div className="history-list">
          {requests.length === 0 && <p className="muted">История пока пустая</p>}
          {requests.map((item) => (
            <button
              key={item.id}
              className={selected?.id === item.id ? "history-item active" : "history-item"}
              onClick={() => setSelected(item)}
            >
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

          {file && (
            <div className="selected-file">
              <strong>Выбран файл:</strong>
              <span>{file.name}</span>
            </div>
          )}

          {!canManageRequests && <div className="role-note">Ваша роль не позволяет создавать новые AI-обработки.</div>}
          {error && <div className="error-box">{error}</div>}
        </section>

        <section className="input-area email-area">
          <div className="section-title">
            <h2>Почта mailcow</h2>
            <p>Проверка входящих писем через IMAP. Вложения PDF/DOCX/XLSX попадают в анализ.</p>
          </div>

          <div className="email-controls">
            <button className="secondary-button" onClick={handleCheckEmail} disabled={loading || !canManageRequests}>
              <Mail size={18} />
              Проверить почту
            </button>
            <span className={`email-status email-status-${smtpHealthClass}`}>{smtpHealthText}</span>
            {emailStatus && <span className="email-status">{emailStatus}</span>}
          </div>

          <div className="email-list">
            {emails.length === 0 && <p className="muted">Писем пока нет. Проверьте почту после настройки IMAP.</p>}
            {emails.map((email) => (
              <article className="email-item" key={email.id}>
                <div>
                  <strong>{email.subject || "Без темы"}</strong>
                  <span>{email.from_address || "Отправитель не определен"}</span>
                  <small>Ящик: {email.mailbox_email || "не указан"}</small>
                  {email.michael_manager && <small>Менеджер Michael: {email.michael_manager}</small>}
                  {email.attachment_names && <small>Вложения: {email.attachment_names}</small>}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => handleProcessEmail(email.id)}
                  disabled={loading || !canManageRequests || Boolean(email.processed_request_id)}
                >
                  {email.processed_request_id ? `Заявка #${email.processed_request_id}` : "Обработать письмо"}
                </button>
              </article>
            ))}
          </div>
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

          {!selected && <div className="empty-state">Результат появится здесь после обработки заявки.</div>}

          {selected && (
            <>
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
