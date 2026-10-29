import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Loader2, X } from "lucide-react";
import { assignRequest, listRequestAssignees } from "../../api";
import { activeManagers, assigneeCaption, validateAssignment } from "../../lib/request-access.mjs";

export default function RequestAssigneePanel({ request, user, onAssigned }) {
  const [open, setOpen] = useState(false);
  const [managers, setManagers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef(null), mounted = useRef(false), submitting = useRef(false), opener = useRef(null);
  const target = managers.find(manager => Number(manager.id) === Number(targetId));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController(), element = dialog.current;
    element.showModal(); setLoading(true); setError("");
    listRequestAssignees({ signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setManagers(activeManagers(items));
    }).catch(err => { if (!controller.signal.aborted) setError(err.safeMessage || err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (element.open) element.close(); };
  }, [open]);

  function close() {
    if (submitting.current) return;
    setOpen(false); setTargetId(""); setError("");
    queueMicrotask(() => opener.current?.focus?.());
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const validation = validateAssignment(request, targetId, managers);
    if (validation) { setError(validation); return; }
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = await assignRequest(request.id, Number(targetId));
      if (!mounted.current) return;
      if (Number(updated?.id) !== Number(request.id) || Number(updated?.assigned_user_id) !== Number(targetId))
        throw new Error("Сервер не подтвердил передачу. Обновите заявку перед повтором.");
      // The mutation response confirms success; a second request must not turn
      // a completed transfer into an apparent failure.
      onAssigned(updated); setOpen(false); setTargetId("");
      setNotice(`Заявка #${updated.id} передана: ${assigneeCaption(updated)}.`);
      queueMicrotask(() => opener.current?.focus?.());
    } catch (err) {
      if (mounted.current) setError(err.safeMessage || err.message || "Не удалось передать заявку. Повторите позже.");
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="request-assignee" aria-label="Ответственный за заявку">
    <div><span>Ответственный за заявку</span><strong>{assigneeCaption(request)}</strong>
      {!request.assigned_user_id && user.role === "admin" ? <small>Заявка в очереди администратора. Назначьте действующего менеджера.</small> : null}</div>
    {user.role === "admin" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => {
      opener.current = document.activeElement; setNotice(""); setError(""); setManagers([]); setTargetId(""); setOpen(true);
    }}><ArrowRightLeft size={16} />{request.assigned_user_id ? "Передать заявку" : "Назначить менеджера"}</button> : null}
    {notice ? <p className="users-notice" role="status">{notice}</p> : null}
    {open ? <dialog ref={dialog} className="account-dialog" aria-labelledby="assignment-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="account-dialog-heading"><div><h3 id="assignment-title">Передача заявки</h3><p>Заявка #{request.id} · {request.client_company || "Клиент не указан"}</p></div>
        <button type="button" className="account-dialog-close" aria-label="Закрыть передачу" disabled={busy} onClick={close}><X size={20} /></button></div>
      <form onSubmit={event => void submit(event)}>
        <p className="assignment-warning">Текущий ответственный: {assigneeCaption(request)}. После передачи заявку будет видеть новый менеджер; предыдущий менеджер потеряет доступ.</p>
        {loading ? <p className="users-loading" role="status"><Loader2 size={17} className="spin" />Загружаем действующих менеджеров…</p> : null}
        <label><span>Новый ответственный</span><select autoFocus value={targetId} onChange={event => { setTargetId(event.target.value); setError(""); }} disabled={loading || busy}>
          <option value="">Выберите менеджера</option>{managers.map(manager => <option key={manager.id} value={manager.id} disabled={Number(manager.id) === Number(request.assigned_user_id)}>{manager.display_name || manager.username} ({manager.username})</option>)}</select></label>
        {!loading && managers.length === 0 && !error ? <p className="muted">Действующих менеджеров нет. Сначала добавьте или включите сотрудника с ролью «Менеджер».</p> : null}
        {target ? <p className="assignment-confirmation">Подтвердите передачу заявки #{request.id} сотруднику {target.display_name || target.username} ({target.username}).</p> : null}
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="account-dialog-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>Отмена</button><button className="primary-button" disabled={loading || busy || !targetId}>
          {busy ? <Loader2 size={17} className="spin" /> : null}Передать заявку #{request.id}</button></div>
      </form>
    </dialog> : null}
  </section>;
}
