import { useEffect, useRef, useState } from "react";
import { Loader2, Shield, UserPlus, X } from "lucide-react";
import { createUser, listUsers, resetUserPassword, updateUserActive, updateUserEmail } from "../../api";
import { accountCreatePayload, accountError, emptyAccountDraft, NEW_PASSWORD_MIN, PASSWORD_MAX,
  ROLE_DESCRIPTIONS, validateAccountDraft } from "../../lib/user-accounts.mjs";

export default function UserManagementPanel({ authUser, roles, onSessionExpired }) {
  const [users, setUsers] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(emptyAccountDraft);
  const [formError, setFormError] = useState("");
  const operation = useRef(false);
  const mounted = useRef(false);
  const nativeDialog = useRef(null);
  const opener = useRef(null);
  const labels = Object.fromEntries(roles);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setInitialLoading(true);
    listUsers({ signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) { setUsers(items); setError(""); }
    }).catch(err => {
      if (!controller.signal.aborted) {
        if (err.status === 401) { void onSessionExpired("Сеанс завершён. Войдите в программу снова."); return; }
        setError(accountError(err));
      }
    }).finally(() => { if (!controller.signal.aborted) setInitialLoading(false); });
    return () => controller.abort();
  }, [authUser.id]);

  useEffect(() => {
    if (!dialog) return undefined;
    const element = nativeDialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [dialog]);

  function openDialog(mode, user = null) {
    if (operation.current) return;
    opener.current = document.activeElement;
    setDraft(emptyAccountDraft()); setFormError(""); setError(""); setNotice(""); setDialog({ mode, user });
  }

  function closeDialog() {
    if (operation.current) return;
    setDialog(null); setDraft(emptyAccountDraft()); setFormError("");
    queueMicrotask(() => opener.current?.focus?.());
  }

  function updateDraft(field, value) {
    setDraft(current => ({ ...current, [field]: value }));
    setFormError("");
  }

  function upsertUser(account) {
    if (!account || !Number.isSafeInteger(account.id) || !account.username)
      throw Object.assign(new Error(), { safeMessage: "Сервер не подтвердил изменение сотрудника. Обновите страницу перед повтором." });
    setUsers(current => current.some(user => user.id === account.id)
      ? current.map(user => user.id === account.id ? account : user) : [...current, account]);
  }

  async function submitCredentials(event) {
    event.preventDefault();
    if (!dialog || operation.current) return;
    const validation = validateAccountDraft(draft, dialog.mode);
    if (validation) { setFormError(validation); return; }
    const target = dialog;
    operation.current = true; setBusy(true); setFormError(""); setError(""); setNotice("");
    try {
      const account = target.mode === "create" ? await createUser(accountCreatePayload(draft))
        : await resetUserPassword(target.user.id, draft.password);
      if (!mounted.current) return;
      upsertUser(account);
      setDialog(null); setDraft(emptyAccountDraft());
      if (target.mode === "reset" && Number(target.user.id) === Number(authUser.id)) {
        await onSessionExpired("Пароль изменён. Все ваши сеансы завершены. Войдите с новым паролем.");
        return;
      }
      setNotice(target.mode === "create" ? `Сотрудник «${account.display_name || account.username}» добавлен. Для входа используйте логин ${account.username}.`
        : `Пароль сотрудника ${account.username} изменён. Его открытые сеансы завершены.`);
      queueMicrotask(() => opener.current?.focus?.());
    } catch (err) {
      if (!mounted.current) return;
      if (err.status === 401) { await onSessionExpired("Сеанс завершён. Войдите в программу снова."); return; }
      setFormError(accountError(err));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function changeUser(action, success) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const account = await action();
      if (!mounted.current) return;
      upsertUser(account); setNotice(success(account));
    } catch (err) {
      if (!mounted.current) return;
      if (err.status === 401) { await onSessionExpired("Сеанс завершён. Войдите в программу снова."); return; }
      setError(accountError(err));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="input-area users-area" aria-labelledby="users-section-title">
    <div className="section-title section-title-with-action"><div><h2 id="users-section-title">Пользователи</h2><p>Личные учётные записи сотрудников Michael</p></div>
      <button className="secondary-button" type="button" onClick={() => openDialog("create")} disabled={busy || initialLoading}><UserPlus size={18} />Добавить сотрудника</button></div>
    <p className="muted users-access-note">Управлять сотрудниками и менять пароли может только администратор. Каждый сотрудник входит под своим логином.</p>
    {error ? <div className="error-box" role="alert">{error}</div> : null}
    {notice ? <div className="users-notice" role="status">{notice}</div> : null}
    {initialLoading ? <p className="users-loading" role="status"><Loader2 className="spin" size={17} />Загружаем сотрудников…</p> : null}
    <div className="users-list">{users.map(user => <article className="user-row" key={user.id}>
      <Shield size={18} /><div><strong>{user.display_name}</strong><span>{user.username} · {labels[user.role] || user.role} · {user.is_active ? "активен" : "отключён"}</span></div>
      <label className="user-email-field"><span>Email edel.kz</span><input value={user.email_address || ""} onChange={event => setUsers(current => current.map(item => item.id === user.id ? { ...item, email_address: event.target.value } : item))} placeholder="user@edel.kz" maxLength={254} disabled={busy} /></label>
      <button className="secondary-button" type="button" onClick={() => void changeUser(() => updateUserEmail(user.id, user.email_address || ""), account => `Email сотрудника ${account.username} сохранён.`)} disabled={busy}>Сохранить email</button>
      <button className="secondary-button" type="button" onClick={() => openDialog("reset", user)} disabled={busy}>Сбросить пароль</button>
      <button className="secondary-button" type="button" disabled={busy || Number(user.id) === Number(authUser.id)} title={Number(user.id) === Number(authUser.id) ? "Нельзя отключить текущий аккаунт" : ""}
        onClick={() => void changeUser(() => updateUserActive(user.id, !Boolean(user.is_active)), account => account.is_active ? `Учётная запись ${account.username} включена.` : `Учётная запись ${account.username} отключена. Открытые сеансы завершены.`)}>{user.is_active ? "Отключить" : "Включить"}</button>
    </article>)}</div>
    {dialog ? <dialog ref={nativeDialog} className="account-dialog" aria-labelledby="account-dialog-title" onCancel={event => { event.preventDefault(); closeDialog(); }}>
      <div className="account-dialog-heading"><div><h3 id="account-dialog-title">{dialog.mode === "create" ? "Добавить сотрудника" : "Сбросить пароль"}</h3>
        <p>{dialog.mode === "create" ? "Создайте личный вход и выберите права сотрудника." : `${dialog.user.display_name} · ${dialog.user.username}`}</p></div>
        <button className="account-dialog-close" type="button" aria-label="Закрыть окно" onClick={closeDialog} disabled={busy}><X size={20} /></button></div>
      <form noValidate onSubmit={event => void submitCredentials(event)}>
        {dialog.mode === "create" ? <div className="account-details-grid">
          <label><span>Логин</span><input value={draft.username} onChange={event => updateDraft("username", event.target.value)} placeholder="manager1" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} autoFocus required disabled={busy} /><small>Латинские буквы, цифры, точка, дефис или подчёркивание.</small></label>
          <label><span>Имя сотрудника</span><input value={draft.display_name} onChange={event => updateDraft("display_name", event.target.value)} placeholder="Имя и фамилия" autoComplete="off" maxLength={200} disabled={busy} /></label>
          <label><span>Email edel.kz — необязательно</span><input type="email" value={draft.email_address} onChange={event => updateDraft("email_address", event.target.value)} placeholder="manager@edel.kz" maxLength={254} autoComplete="off" disabled={busy} /></label>
          <label><span>Роль сотрудника</span><select value={draft.role} onChange={event => updateDraft("role", event.target.value)} disabled={busy}>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="account-role-description">{ROLE_DESCRIPTIONS[draft.role]}</p>
        </div> : <p className="account-reset-warning">После сохранения все открытые сеансы этого сотрудника завершатся. Для следующего входа понадобится новый пароль.</p>}
        <div className="account-password-grid"><label><span>{dialog.mode === "create" ? "Пароль" : "Новый пароль"}</span><input type="password" autoComplete="new-password" value={draft.password} onChange={event => updateDraft("password", event.target.value)} minLength={NEW_PASSWORD_MIN} maxLength={PASSWORD_MAX} autoFocus={dialog.mode === "reset"} required disabled={busy} /><small>От {NEW_PASSWORD_MIN} до {PASSWORD_MAX} символов. Русские и латинские буквы, цифры и знаки, включая !.</small></label>
          <label><span>Повторите пароль</span><input type="password" autoComplete="new-password" value={draft.confirmation} onChange={event => updateDraft("confirmation", event.target.value)} minLength={NEW_PASSWORD_MIN} maxLength={PASSWORD_MAX} required disabled={busy} /></label></div>
        {formError ? <div className="error-box" role="alert">{formError}</div> : null}
        <div className="account-dialog-actions"><button className="secondary-button" type="button" onClick={closeDialog} disabled={busy}>Отмена</button><button className="primary-button" type="submit" disabled={busy || !draft.password || !draft.confirmation || (dialog.mode === "create" && !draft.username.trim())}>{busy ? <Loader2 className="spin" size={17} /> : null}{dialog.mode === "create" ? "Добавить сотрудника" : "Сохранить новый пароль"}</button></div>
      </form>
    </dialog> : null}
  </section>;
}
