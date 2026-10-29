import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Mail } from "lucide-react";
import { getEmailRegistrationStatus, requestEmailRegistration, verifyEmailRegistration } from "../../api";
import { registrationRequestPayload, validateRegistrationRequest, validRegistrationToken } from "../../lib/email-registration.mjs";
import { NEW_PASSWORD_MIN, PASSWORD_MAX, validateNewPassword } from "../../lib/user-accounts.mjs";

export default function EmailRegistrationForm({ mode, token, onBack, onRequestLink, onRegistered }) {
  const [draft, setDraft] = useState({ email: "", display_name: "" });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false), mounted = useRef(false);
  const verify = mode === "verify", validLink = validRegistrationToken(token);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setError(""); setNotice(""); setPassword(""); setConfirmation("");
    if (verify) return undefined;
    const controller = new AbortController(); setEnabled(null);
    getEmailRegistrationStatus({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setEnabled(result?.enabled === true);
    }).catch(err => { if (!controller.signal.aborted) { setEnabled(false); setError(err.safeMessage || err.message); } });
    return () => controller.abort();
  }, [mode, token]);

  async function submit(event) {
    event.preventDefault();
    if (pending.current || (!verify && enabled !== true)) return;
    const validation = verify ? (!validLink ? "Ссылка недействительна или устарела. Запросите новое письмо." : validateNewPassword(password, confirmation))
      : validateRegistrationRequest(draft);
    if (validation) { setError(validation); return; }
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (verify) {
        const result = await verifyEmailRegistration(token, password);
        if (!mounted.current) return;
        if (result?.registered !== true || typeof result.email !== "string") throw new Error("Сервер не подтвердил регистрацию. Повторите позже.");
        setPassword(""); setConfirmation(""); onRegistered(result.email, result.detail);
      } else {
        const result = await requestEmailRegistration(registrationRequestPayload(draft));
        if (!mounted.current) return;
        if (result?.accepted !== true) throw new Error("Сервер не подтвердил приём запроса. Повторите позже.");
        setNotice(result.detail || "Запрос принят. Если адрес подходит для регистрации, на него придёт письмо с дальнейшими действиями.");
      }
    } catch (err) {
      if (!mounted.current) return;
      if (err.code === "REGISTRATION_MAIL_UNAVAILABLE") setEnabled(false);
      setError(err.safeMessage || err.message || "Регистрация временно недоступна. Обратитесь к администратору.");
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  function back() {
    if (pending.current) return;
    setPassword(""); setConfirmation(""); setDraft({ email: "", display_name: "" }); onBack();
  }

  return <main className="auth-shell"><form className="login-card registration-card" noValidate onSubmit={event => void submit(event)}>
    <div className="brand"><FileText size={24} /><div><h1>{verify ? "Задайте пароль" : "Регистрация сотрудника"}</h1><p>ТОО Michael · корпоративная почта</p></div></div>
    {verify ? <>
      <p className="muted">Подтвердите регистрацию по ссылке из письма и задайте личный пароль. После сохранения войдите с адресом @edel.kz.</p>
      {!validLink ? <div className="error-box" role="alert">Ссылка недействительна или устарела. Запросите новое письмо.</div> : <>
        <label><span>Новый пароль</span><input type="password" autoComplete="new-password" autoFocus value={password} onChange={event => { setPassword(event.target.value); setError(""); }} minLength={NEW_PASSWORD_MIN} maxLength={PASSWORD_MAX} disabled={busy} /><small>От {NEW_PASSWORD_MIN} до {PASSWORD_MAX} символов. Русские и латинские буквы, цифры и знаки, включая !.</small></label>
        <label><span>Повторите пароль</span><input type="password" autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(""); }} minLength={NEW_PASSWORD_MIN} maxLength={PASSWORD_MAX} disabled={busy} /></label>
      </>}
    </> : <>
      <p className="muted">Введите рабочий адрес @edel.kz. Ссылка из письма подтвердит доступ к почте; пароль вы зададите после перехода.</p>
      <label><span>Имя сотрудника</span><input autoComplete="name" autoFocus value={draft.display_name} onChange={event => { setDraft(current => ({ ...current, display_name: event.target.value })); setError(""); }} maxLength={200} disabled={busy} /></label>
      <label><span>Корпоративный email @edel.kz</span><input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={draft.email} onChange={event => { setDraft(current => ({ ...current, email: event.target.value })); setError(""); }} maxLength={72} placeholder="name@edel.kz" disabled={busy} /></label>
      {enabled === null ? <p className="users-loading" role="status"><Loader2 size={16} className="spin" />Проверяем настройки регистрации…</p> : null}
      {enabled === false ? <p className="registration-unavailable" role="alert">Регистрация по почте сейчас недоступна: исходящая почта не настроена или временно недоступна. Обратитесь к администратору — он может создать личную учётную запись.</p> : null}
    </>}
    {error ? <div className="error-box" role="alert">{error}</div> : null}
    {notice ? <div className="users-notice" role="status">{notice}</div> : null}
    {verify && !validLink ? null : <button className="primary-button" disabled={busy || (verify ? !password || !confirmation : enabled !== true || !draft.email.trim() || !draft.display_name.trim())}>
      {busy ? <Loader2 size={17} className="spin" /> : verify ? null : <Mail size={17} />}{verify ? "Подтвердить почту и сохранить пароль" : "Получить письмо подтверждения"}</button>}
    {verify ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPassword(""); setConfirmation(""); onRequestLink(); }}>Запросить новую ссылку</button> : null}
    <button type="button" className="secondary-button" onClick={back} disabled={busy}>Назад</button>
  </form></main>;
}
