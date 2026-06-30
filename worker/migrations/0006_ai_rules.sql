CREATE TABLE IF NOT EXISTS ai_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_rules_enabled_order ON ai_rules(is_enabled, sort_order);

INSERT OR IGNORE INTO ai_rules (rule_key, title, rule_text, is_enabled, is_required, sort_order)
VALUES
  (
    'prices_with_vat',
    'Цены всегда с НДС',
    'Все цены, суммы, коммерческие предложения и ответы клиенту готовить в формате с НДС 16%, если документ сделки прямо не говорит иное.',
    1,
    1,
    10
  ),
  (
    'supplier_michael',
    'Поставщик ТОО Michael',
    'Все счета, предложения и клиентские ответы оформляются от поставщика ТОО Michael. Не предлагать выставление счета от другой компании.',
    1,
    1,
    20
  ),
  (
    'kbi_invoice_appendix',
    'KBI: счет + приложение',
    'Для ТОО KBI Energy / KBI Energy Group всегда учитывать работу по годовому договору: счет выставляется в 1С, а к каждому счету нужно подготовить приложение к договору.',
    1,
    1,
    30
  ),
  (
    'one_c_source',
    '1С главный источник данных',
    'Карточки клиентов, договоры, реквизиты, номенклатура, коды товаров, остатки и цены брать из 1С или из загруженного документа 1С. Если данных нет, писать что нужно проверить в 1С.',
    1,
    1,
    40
  ),
  (
    'invoice_only_in_1c',
    'Счет только через 1С',
    'Программа и ИИ не создают финальный счет самостоятельно. Они готовят задачу, черновик ответа и данные для менеджера; счет выставляется только через 1С.',
    1,
    1,
    50
  ),
  (
    'no_price_guessing',
    'Не придумывать цены',
    'Запрещено придумывать цену, скидку, наличие, срок поставки или код товара. Если цена не видна в счете, прайсе или данных 1С, писать "цену нужно проверить в 1С".',
    1,
    1,
    60
  );
