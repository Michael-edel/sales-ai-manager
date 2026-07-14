import { ChevronUp, Eye, RotateCcw, Trash2 } from "lucide-react";

import { EMAIL_FOLDER_LABELS, EMAIL_STATUS_LABELS, emailEmptyMessage } from "./email-utils";

export default function EmailMessageList({
  emails,
  selectedEmail,
  folder,
  stats,
  loading,
  canManageRequests,
  formatDateTime,
  renderSenderFilterCheckbox,
  renderEmailDetail,
  onUpdate,
  onDelete,
  onOpen,
}) {
  return (
    <div className="email-list">
      {emails.length === 0 && <p className="muted">{emailEmptyMessage(folder, stats)}</p>}
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
                  onClick={() => onUpdate(email, { folder: "inbox", is_read: true })}
                  disabled={loading || !canManageRequests}
                >
                  <RotateCcw size={16} />
                  Вернуть
                </button>
              ) : (
                <button
                  className="secondary-button danger-button"
                  onClick={() => onDelete(email)}
                  disabled={loading || !canManageRequests}
                >
                  <Trash2 size={16} />
                  Удалить
                </button>
              )}
              <button className="secondary-button" onClick={() => onOpen(email)} disabled={loading}>
                {selectedEmail?.id === email.id ? <ChevronUp size={16} /> : <Eye size={16} />}
                {selectedEmail?.id === email.id ? "Свернуть" : "Открыть"}
              </button>
            </div>
          </article>
          {selectedEmail?.id === email.id && renderEmailDetail(selectedEmail)}
        </div>
      ))}
    </div>
  );
}
