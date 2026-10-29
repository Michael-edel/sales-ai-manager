import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { getCatalogStatus, searchSharedCatalog, registerCatalogSyncDevice } from "../../api";
import { CandidateCard } from "./CatalogSelectionPanel";
import { pairCatalogDevice } from "../../lib/catalog-pairing.mjs";

export default function SharedCatalogPanel({ user }) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMessage, setPairMessage] = useState("");
  const pending = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    getCatalogStatus({ signal: controller.signal }).then(status => {
      if (!controller.signal.aborted) setCatalog(status.activeSnapshot);
    }).catch(err => { if (!controller.signal.aborted) setError(err.safeMessage || err.message); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [user.id]);

  async function search(event) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setResults(null);
    try {
      const [result, status] = await Promise.all([
        searchSharedCatalog(query.trim(), { signal: controller.signal }),
        getCatalogStatus({ signal: controller.signal }),
      ]);
      if (!controller.signal.aborted) { setResults(result); setCatalog(status.activeSnapshot); }
    } catch (err) { if (!controller.signal.aborted) setError(err.safeMessage || err.message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function pair() {
    if (pairBusy) return; setPairBusy(true); setPairMessage("");
    try { await pairCatalogDevice({register:registerCatalogSyncDevice}); setPairMessage("Локальный кабинет подключён. Оставьте его открытым для передачи обновлений."); }
    catch (error) { setPairMessage(error.message || "Не удалось подключить локальный кабинет."); }
    finally { setPairBusy(false); }
  }

  return <section className="input-area shared-catalog" aria-labelledby="shared-catalog-title">
    <div className="section-title"><h2 id="shared-catalog-title">Общий каталог склада и поставщиков</h2><p>Один каталог для сотрудников. Поиск по наименованию, модели, артикулу или коду 1С.</p></div>
    <p className="catalog-subtle">{catalog ? `${new Intl.NumberFormat("ru-RU").format(catalog.offerCount)} предложений · снимок ${new Date(catalog.exportedAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}` : "Каталог ещё не загружен администратором."}</p>
    {catalog?.environment === "test" ? <p className="catalog-alert">Тестовый каталог: остатки и цены учебной 1С нужно подтвердить по рабочему складу.</p> : null}
    {catalog?.environment === "unknown" ? <p className="catalog-alert">Рабочая среда источника не подтверждена. Проверьте данные перед предложением клиенту.</p> : null}
    {user.role === "admin" ? <div><button type="button" className="secondary-button" disabled={pairBusy} onClick={() => void pair()}>Подключить локальный кабинет</button><p className="catalog-subtle">Сначала нажмите «Подключить сайт» в локальном кабинете на этом компьютере.</p>{pairMessage ? <p role="status">{pairMessage}</p> : null}</div> : null}
    <form className="shared-catalog-search" onSubmit={event => void search(event)}><label><span>Поиск в общем каталоге</span><input value={query} onChange={event => setQuery(event.target.value)} maxLength={300} placeholder="Например: DK-01S или автомат Sirius" /></label>
      <button className="secondary-button" disabled={busy || !query.trim()}>{busy ? <Loader2 size={17} className="spin" /> : <Search size={17} />}Найти товары</button></form>
    {error ? <div className="error-box" role="alert">{error}</div> : null}
    {results ? <div><p className="catalog-subtle" role="status">{results.candidates?.length ? `Найдено предложений: ${results.candidates.length}.` : "Совпадений не найдено. Уточните модель или артикул."}{results.searchTruncated ? " Показана часть совпадений — уточните запрос." : ""}</p>
      <div className="catalog-candidates">{(results.candidates || []).map(candidate => <CandidateCard key={candidate.offer.id} candidate={candidate} />)}</div></div> : null}
    <p className="catalog-subtle">Подбор по заявке выполняет менеджер или администратор в карточке своей доступной заявки.</p>
  </section>;
}
