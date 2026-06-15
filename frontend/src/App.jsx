import { useEffect, useMemo, useState } from "react";
import { Clipboard, FileText, Loader2, Mail, Upload } from "lucide-react";
import { checkEmail, listEmailMessages, listRequests, processEmailMessage, processText, uploadFile } from "./api";
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

export default function App() {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState([]);
  const [emailStatus, setEmailStatus] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [metadata, setMetadata] = useState({
    client_company: "ТОО KBI Energy",
    client_contact_name: "",
    michael_manager: "",
    communication_channel: "WhatsApp",
  });

  const resultSections = useMemo(() => splitSections(selected?.ai_result), [selected]);
  const clientBlock = useMemo(() => extractClientBlock(selected?.ai_result || ""), [selected]);

  async function refreshHistory(latestItem = null) {
    const items = await listRequests();
    setRequests(items);
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

  useEffect(() => {
    refreshHistory().catch((err) => setError(err.message));
    refreshEmails().catch((err) => setEmailStatus(err.message));
  }, []);

  async function handleProcess() {
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

  const canProcess = Boolean(text.trim() || file) && !loading;
  const inputLabel = file ? "Пояснение к выбранному файлу" : "Текст заявки";

  function updateMetadata(field, value) {
    setMetadata((current) => ({ ...current, [field]: value }));
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
              />
            </label>
            <label>
              <span>Менеджер клиента</span>
              <input
                value={metadata.client_contact_name}
                onChange={(event) => updateMetadata("client_contact_name", event.target.value)}
                placeholder="Имя из WhatsApp/Telegram"
              />
            </label>
            <label>
              <span>Менеджер Michael</span>
              <input
                value={metadata.michael_manager}
                onChange={(event) => updateMetadata("michael_manager", event.target.value)}
                placeholder="Имя ответственного менеджера"
              />
            </label>
            <label>
              <span>Канал связи</span>
              <select
                value={metadata.communication_channel}
                onChange={(event) => updateMetadata("communication_channel", event.target.value)}
              >
                <option value="WhatsApp">WhatsApp</option>
                <option value="Telegram">Telegram</option>
                <option value="Email">Email</option>
                <option value="Телефон">Телефон</option>
                <option value="Другое">Другое</option>
              </select>
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
              />
            </label>

            {file && (
              <button
                className="secondary-button"
                onClick={() => {
                  setFile(null);
                  setFileInputKey((value) => value + 1);
                }}
                disabled={loading}
              >
                Очистить файл
              </button>
            )}

            <button className="primary-button" onClick={handleProcess} disabled={!canProcess}>
              {loading ? <Loader2 className="spin" size={18} /> : null}
              Обработать
            </button>
          </div>

          {file && (
            <div className="selected-file">
              <strong>Выбран файл:</strong>
              <span>{file.name}</span>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}
        </section>

        <section className="input-area email-area">
          <div className="section-title">
            <h2>Почта mailcow</h2>
            <p>Проверка входящих писем через IMAP. Вложения PDF/DOCX/XLSX попадают в анализ.</p>
          </div>

          <div className="email-controls">
            <button className="secondary-button" onClick={handleCheckEmail} disabled={loading}>
              <Mail size={18} />
              Проверить почту
            </button>
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
                  disabled={loading || Boolean(email.processed_request_id)}
                >
                  {email.processed_request_id ? `Заявка #${email.processed_request_id}` : "Обработать письмо"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="result-area">
          <div className="result-header">
            <div>
              <h2>Результат A-F</h2>
              <p>{selected ? `Заявка #${selected.id}` : "Выберите заявку или обработайте новую"}</p>
            </div>
            <button className="secondary-button" onClick={copyClientBlock} disabled={!clientBlock}>
              <Clipboard size={18} />
              {copied ? "Скопировано" : "Копировать D"}
            </button>
          </div>

          {!selected && <div className="empty-state">Результат появится здесь после обработки заявки.</div>}

          {selected && (
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
          )}
        </section>
      </section>
    </main>
  );
}
