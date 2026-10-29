import { useEffect, useRef, useState } from "react";
import { Loader2, LockKeyhole, PlugZap, Save } from "lucide-react";
import { getSmtpSettings, isStaleSessionResponse, probeSmtpServer, saveSmtpSettings } from "../../api";
import { SMTP_PASSWORD_MAX, smtpDraft, smtpError, smtpMetadata, smtpPayload, smtpProbePayload, validateSmtpDraft, validateSmtpProbe } from "../../lib/smtp-settings.mjs";

const verificationDate = value => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || "") ? value.replace(" ", "T") + "Z" : value;
  return normalized && Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" }) : "";
};

export default function SmtpSettingsPanel({ onSaved }) {
  const [metadata, setMetadata] = useState(null);
  const [draft, setDraft] = useState(() => smtpDraft(null));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const mounted = useRef(false), operation = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    getSmtpSettings({ signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const settings = smtpMetadata(value); setMetadata(settings); setDraft(smtpDraft(settings));
    }).catch(err => { if (!controller.signal.aborted && !isStaleSessionResponse(err)) setError(smtpError(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadVersion]);

  function update(field, value) { setDraft(current => ({ ...current, [field]: value })); setError(""); setNotice(""); }
  function cancel() { if (!operation.current) { setDraft(smtpDraft(metadata)); setError(""); setNotice(""); } }

  async function submit(event) {
    event.preventDefault();
    if (operation.current || !metadata) return;
    const validation = validateSmtpDraft(draft, metadata);
    if (validation) { setError(validation); return; }
    const payload = smtpPayload(draft);
    operation.current = true; setBusy("save"); setError(""); setNotice("");
    // Clear the masked field immediately; it is never kept in browser storage.
    setDraft(current => ({ ...current, password: "" }));
    try {
      const saved = smtpMetadata(await saveSmtpSettings(payload));
      if (!mounted.current) return;
      if (!saved.password_set || !saved.auth_verified_at) throw Object.assign(new Error(), { status: 502,
        message: "Сервер не подтвердил проверку SMTP-входа. Обновите настройки перед повтором." });
      setMetadata(saved); setDraft(smtpDraft(saved));
      setNotice("SMTP-вход проверен. Письма при проверке не отправлялись.");
      // Metadata confirms the completed save. A health refresh is optional.
      if (onSaved) void Promise.resolve().then(() => onSaved(saved)).catch(() => {});
    } catch (err) {
      if (mounted.current && !isStaleSessionResponse(err)) setError(smtpError(err));
    } finally {
      payload.password = ""; operation.current = false;
      if (mounted.current) setBusy("");
    }
  }

  async function probe() {
    if (operation.current || !metadata) return;
    const endpoint = smtpProbePayload(draft);
    const validation = validateSmtpProbe(endpoint, metadata);
    if (validation) { setError(validation); return; }
    operation.current = true; setBusy("probe"); setError(""); setNotice("");
    try {
      const result = await probeSmtpServer(endpoint);
      if (!mounted.current) return;
      if (result?.tls_verified !== true) throw Object.assign(new Error(), { status: 502, message: "Сервер не подтвердил защищённое SMTP-соединение." });
      setNotice("Защищённое соединение установлено. Пароль не проверялся, письма не отправлялись.");
    } catch (err) { if (mounted.current && !isStaleSessionResponse(err)) setError(smtpError(err)); }
    finally { operation.current = false; if (mounted.current) setBusy(""); }
  }

  return <section className="input-area smtp-settings-panel" aria-labelledby="smtp-settings-title">
    <div className="section-title"><h2 id="smtp-settings-title">Исходящая почта SMTP</h2><p>Защищённое подключение для писем и регистрации сотрудников.</p></div>
    <p className="smtp-settings-note"><LockKeyhole size={16} />Настройки доступны только администратору. Используйте отдельный SMTP-пароль приложения.</p>
    {loading ? <p className="users-loading" role="status"><Loader2 size={17} className="spin" />Загружаем настройки SMTP…</p> : null}
    {!loading && !metadata && error ? <button type="button" className="secondary-button" onClick={() => setLoadVersion(current => current + 1)}>Повторить загрузку</button> : null}
    {metadata ? <form noValidate onSubmit={event => void submit(event)}>
      <div className="smtp-settings-grid">
        <label><span>SMTP-сервер</span><select value={draft.host} onChange={event => update("host", event.target.value)} disabled={loading || Boolean(busy)}>
          {metadata.allowed_hosts.map(host => <option key={host} value={host}>{host}</option>)}</select></label>
        <label><span>Защищённый порт</span><select value={draft.port} onChange={event => update("port", Number(event.target.value))} disabled={loading || Boolean(busy)}><option value={587}>587 — STARTTLS</option><option value={465}>465 — TLS</option></select></label>
        <label><span>Логин почтового ящика</span><input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={draft.username} onChange={event => update("username", event.target.value)} disabled={loading || Boolean(busy)} /></label>
        <label><span>Адрес отправителя @edel.kz</span><input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={draft.from_address} onChange={event => update("from_address", event.target.value)} disabled={loading || Boolean(busy)} /></label>
        <label className="smtp-password-field"><span>SMTP-пароль приложения</span><input type="password" autoComplete="new-password" value={draft.password} onChange={event => update("password", event.target.value)} maxLength={SMTP_PASSWORD_MAX} disabled={loading || Boolean(busy)} />
          <small>{metadata.password_set ? "Пароль сохранён на сервере и не показывается. При прежних настройках поле можно оставить пустым." : "Введите отдельный пароль приложения для SMTP. Пароль не показывается после сохранения."}</small></label>
      </div>
      <p className="smtp-settings-note">«Проверить доступность сервера» проверяет только TLS, без пароля. «Проверить и сохранить SMTP» дополнительно проверяет вход. Обе проверки не отправляют писем.</p>
      {metadata.auth_verified_at ? <p className="smtp-verified">Последняя проверка входа: {verificationDate(metadata.auth_verified_at)} · время Экибастуза.</p> : null}
      <div className="smtp-settings-actions"><button type="button" className="secondary-button" onClick={probe} disabled={Boolean(busy) || loading}>
        {busy === "probe" ? <Loader2 size={17} className="spin" /> : <PlugZap size={17} />}Проверить доступность сервера</button>
        <button type="button" className="secondary-button" onClick={cancel} disabled={Boolean(busy) || loading}>Отмена</button><button className="primary-button" disabled={Boolean(busy) || loading}>
        {busy === "save" ? <Loader2 size={17} className="spin" /> : <Save size={17} />}Проверить и сохранить SMTP</button></div>
    </form> : null}
    {error ? <div className="error-box" role="alert">{error}</div> : null}
    {notice ? <div className="users-notice" role="status">{notice}</div> : null}
  </section>;
}
