CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'ru',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  body_text TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_enabled_order ON whatsapp_templates(is_enabled, sort_order);

CREATE TABLE IF NOT EXISTS whatsapp_template_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER,
  to_phone TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language_code TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '[]',
  meta_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_detail TEXT,
  sent_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_template_messages_request_id ON whatsapp_template_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_messages_created_at ON whatsapp_template_messages(created_at);

INSERT OR IGNORE INTO whatsapp_templates (
  template_key,
  display_name,
  template_name,
  language_code,
  category,
  body_text,
  is_enabled,
  sort_order
)
VALUES
  (
    'order_received',
    'Заявка получена',
    'order_received',
    'ru',
    'UTILITY',
    'Здравствуйте! Получили вашу заявку. Проверим данные и подготовим ответ от ТОО Michael.',
    1,
    10
  ),
  (
    'need_clarification',
    'Нужно уточнение',
    'need_clarification',
    'ru',
    'UTILITY',
    'Здравствуйте! Для подготовки точного предложения нужно уточнить детали по заявке.',
    1,
    20
  ),
  (
    'price_ready',
    'Цена готова',
    'price_ready',
    'ru',
    'UTILITY',
    'Здравствуйте! Подготовили цену с НДС по вашей заявке. Отправляем детали.',
    1,
    30
  ),
  (
    'invoice_appendix_ready',
    'Счет и приложение KBI готовы',
    'invoice_appendix_ready',
    'ru',
    'UTILITY',
    'Здравствуйте! Счет от ТОО Michael и приложение к договору подготовлены.',
    1,
    40
  );
