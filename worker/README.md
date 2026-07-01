# Cloudflare Workers + D1 версия

Это Cloudflare-вариант API для `sales-ai-manager`.

Он заменяет Python/FastAPI + PostgreSQL на:

- Cloudflare Workers;
- Cloudflare D1;
- Wrangler;
- React static assets из `frontend/dist`.

## Что перенесено

- `GET /api/health`
- `GET /api/requests`
- `GET /api/requests/:id`
- `GET /api/ai/rules`
- `PATCH /api/ai/rules` для администратора
- `GET /api/whatsapp/health`
- `GET /api/whatsapp/templates`
- `POST /api/whatsapp/templates` для администратора
- `PATCH /api/whatsapp/templates` для администратора
- `POST /api/whatsapp/send-template`
- `POST /api/requests/text`
- `POST /api/requests/upload`
- `POST /api/email/messages/:id/process`
- `POST /api/email/ingest` для внешнего `imap-ingest`
- `POST /api/email/send` через внешний `email-bridge`
- входящие письма через `imap-ingest` или Cloudflare Email Routing `email()` handler с сохранением в D1
- `POST /api/requests/:id/contract-appendix` для генерации Word-совместимого приложения к договору
- D1 таблицы `requests`, `email_messages`, `email_sender_filters`, `ai_rules`, `whatsapp_templates`, `whatsapp_template_messages`
- пользователи, роли и cookie-сессии в D1
- Gemini/OpenAI для текста и изображений
- Gemini/OpenAI audio transcription для голосовых
- PDF напрямую через Gemini, если `AI_PROVIDER=gemini` и `PARSER_SERVICE_URL` не задан
- DOCX/XLSX и расширенный PDF-разбор через внешний `parser-service`
- KBI Energy как VIP-клиент: счет от ТОО Michael + приложение к годовому договору
- настройки ИИ и 1С в D1: цены с НДС, счет от ТОО Michael, данные из 1С/документа, запрет придумывать цены
- утвержденные Meta WhatsApp template messages через Cloud API

## Что пока не перенесено

- Встроенная SMTP-отправка из самого Worker.
- Парсинг DOCX/XLSX внутри самого Worker.
- Прием входящих WhatsApp-сообщений через Meta webhook.

Для входящей почты основной вариант — Python-сервис `../imap-ingest`, который читает `direktor@edel.kz` из mailcow по IMAP и отправляет письма в Worker через `POST /api/email/ingest`. Cloudflare Email Routing оставлен как запасной вариант. Для SMTP-отправки добавлен Python-сервис `../email-bridge`. Для DOCX/XLSX и расширенного PDF-разбора добавлен Python-сервис `../parser-service`.

## Настройки ИИ и 1С

Правила хранятся в D1-таблице `ai_rules`. При старте списка или новой обработке Worker добавляет обязательные правила по умолчанию, если их еще нет в базе.

Endpoint:

```text
GET /api/ai/rules
PATCH /api/ai/rules
```

Доступ:

- `GET` — любой авторизованный пользователь;
- `PATCH` — только `admin`.

Обязательные правила нельзя выключить. Их текст можно уточнять через интерфейс администратора, после сохранения они применяются ко всем новым обработкам:

- цены и суммы всегда с НДС 16%;
- поставщик и счет всегда от `ТОО Michael`;
- для KBI Energy всегда готовится счет в 1С и приложение к годовому договору;
- карточки клиентов, договоры, реквизиты, номенклатура, коды товаров, остатки и цены берутся из 1С или загруженного документа 1С;
- финальный счет выставляется только через 1С;
- ИИ не имеет права придумывать цену, скидку, наличие, срок поставки или код товара.

## Приложение к договору KBI Energy

Endpoint:

```text
POST /api/requests/:id/contract-appendix
```

Доступ: `admin`, `manager`, `accountant`.

Worker берет выбранную заявку, номер/дату счета из `requests`, данные товара из ответа ИИ и формирует приложение в форме KBI Energy. Для счета на оплату в приложение попадают все найденные товарные строки, а не только первая позиция:

- договор поставки № `71-02-26/СН` от `17 февраля 2026 года`;
- таблица `№ / Код / Наименование / Ед. изм. / Кол-во / Цена с НДС 16% / Сумма с НДС 16% / Гарантия`;
- строки-заголовки исходного счета, начинающиеся с `№`, пропускаются;
- таблица подгоняется под ширину листа A4, длинные значения переносятся внутри ячеек;
- общая стоимость цифрами и прописью;
- условия поставки `DDP, г. Экибастуз`;
- срок оплаты `20 календарных дней с момента получения Товара`;
- гарантия по умолчанию `14 дней`;
- реквизиты покупателя `ТОО «KBI Energy Group»` и поставщика `ТОО «Michael»` в таблице без границ: одна строка, две колонки;
- отдельные блоки подписи для покупателя и поставщика в своих колонках; строки `Директор` выровнены на одном уровне; подписант поставщика: `Эйрих М.М.`.

Если товарные строки не распознаны, Worker не добавляет пустую техническую строку в приложение.

Ответ API:

- `appendix_text` — текст черновика;
- `appendix_html` — HTML, который frontend скачивает как Word-совместимый `.doc`;
- `file_name` — имя файла;
- `request` — обновленную заявку.

После генерации:

- `contract_appendix_status` становится `prepared`;
- в `contract_appendix_note` добавляется отметка о формировании;
- в `request_events` пишется `request.contract_appendix_generated`.

## Подготовка

Установите зависимости:

```powershell
cd worker
npm install
```

Создайте D1:

```powershell
npx wrangler d1 create sales-ai-manager
```

Скопируйте `database_id` в `worker/wrangler.toml` вместо:

```text
REPLACE_WITH_D1_DATABASE_ID
```

Примените миграции локально:

```powershell
npm run d1:migrate:local
```

Для production:

```powershell
npm run d1:migrate:remote
```

Добавьте OpenAI secret:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

## Защита доступа

Интерфейс открывается как SPA, но все API закрыты встроенной авторизацией приложения через cookie-сессии.

Логин задается в `wrangler.toml`:

```toml
ACCESS_USERNAME = "manager"
```

Пароль задается только как secret:

```powershell
npx wrangler secret put ACCESS_PASSWORD
```

Для локального запуска создайте `worker\.dev.vars` из примера:

```powershell
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
```

В `.dev.vars` укажите свой `ACCESS_PASSWORD`. Этот файл добавлен в `.gitignore` и не должен попадать в GitHub.

Первый пользователь создается автоматически, если таблица `app_users` пустая:

```text
логин: manager
роль: admin
пароль: ACCESS_PASSWORD
```

## Parser-service для DOCX/XLSX и расширенного PDF-разбора

PDF-счета могут обрабатываться напрямую через Gemini без parser-service. Worker вызывает внешний FastAPI-сервис для DOCX/XLSX и для случаев, где нужен Python-разбор PDF, потому что Cloudflare Worker не запускает библиотеки `PyMuPDF`, `python-docx` и `openpyxl`.

Локально:

```powershell
cd ..\parser-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PARSER_SERVICE_TOKEN="change-this-parser-token"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

В `worker/.dev.vars`:

```env
PARSER_SERVICE_URL=http://127.0.0.1:8080
PARSER_SERVICE_TOKEN=change-this-parser-token
```

Для production:

```powershell
npx wrangler secret put PARSER_SERVICE_TOKEN
```

`PARSER_SERVICE_URL` добавьте как Worker variable в Cloudflare Dashboard или в `wrangler.toml`, если URL не секретный.

Проверка из Worker:

```text
GET /api/parser/health
```

Ответ не раскрывает token. В интерфейсе статус отображается в блоке новой обработки рядом с загрузкой файла.

## Email bridge для SMTP

Worker не отправляет SMTP напрямую. Для mailcow/Yandex добавлен отдельный FastAPI-сервис:

```text
../email-bridge
```

Локально:

```powershell
cd ..\email-bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:EMAIL_BRIDGE_TOKEN="change-this-email-token"
$env:SMTP_HOST="mail.your-domain.kz"
$env:SMTP_PORT="587"
$env:SMTP_USER="manager@your-domain.kz"
$env:SMTP_PASSWORD="smtp-password"
$env:SMTP_FROM="manager@your-domain.kz"
$env:SMTP_FROM_NAME="ТОО Michael"
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

В `worker/.dev.vars`:

```env
EMAIL_BRIDGE_URL=http://127.0.0.1:8090
EMAIL_BRIDGE_TOKEN=change-this-email-token
```

Для production:

```powershell
npx wrangler secret put EMAIL_BRIDGE_TOKEN
```

`EMAIL_BRIDGE_URL` добавьте как Worker variable. Проверка:

```text
GET /api/email/smtp/health
```

Отправка D-блока клиенту:

```text
POST /api/email/send
```

## Meta WhatsApp Cloud API templates

Worker отправляет только уже утвержденные Meta WhatsApp template messages.

Secrets:

```powershell
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

Не секретная переменная в `wrangler.toml`:

```toml
WHATSAPP_API_VERSION = "v24.0"
```

Endpoints:

```text
GET /api/whatsapp/health
GET /api/whatsapp/templates
POST /api/whatsapp/templates
PATCH /api/whatsapp/templates
POST /api/whatsapp/send-template
```

`GET /api/whatsapp/templates` возвращает локальный справочник шаблонов из D1. `POST` и `PATCH /api/whatsapp/templates` доступны только администратору и используются для добавления или сохранения точных `template_name`, `language_code`, категории и текста-подсказки. Реальное утверждение шаблона выполняется в Meta Business Manager, не в этом приложении.

Отправка:

```json
{
  "request_id": 9,
  "to": "77001234567",
  "template_key": "invoice_appendix_ready",
  "body_parameters": ["5940", "392 400,00 KZT"]
}
```

Worker вызывает:

```text
POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

Все попытки отправки записываются в `whatsapp_template_messages`; успешные и неуспешные отправки по заявке дополнительно попадают в `request_events`.

## Входящая почта через IMAP-ingest

Основной вариант для `direktor@edel.kz` — сервис `../imap-ingest`. Он читает mailcow по IMAP и отправляет письма в Worker:

```text
POST /api/email/ingest
Authorization: Bearer EMAIL_INGEST_TOKEN
```

Payload сохраняется в таблицу `email_messages`. Обязательные поля: `mailbox_email` и `message_uid`. Остальные поля используются для отображения и дальнейшей обработки письма в заявку.

Secret:

```powershell
npx wrangler secret put EMAIL_INGEST_TOKEN
```

Локальная проверка:

```powershell
cd ..\imap-ingest
Copy-Item .env.example .env
notepad .env
python app\main.py --once
```

## Входящая почта через Cloudflare Email Routing

Worker содержит `email()` handler. Он получает письмо из Cloudflare Email Routing, парсит raw MIME через `postal-mime`, сохраняет отправителя, получателя, тему, текст и имена вложений в таблицу `email_messages`.

Маршрут доставки настраивается в Cloudflare Email Routing: технический адрес, например `ai-inbox@michael.kz`, должен быть связан с Worker `sales-ai-manager`.

Для ящика mailcow `direktor@edel.kz` используется recipient BCC map:

```text
local_dest: direktor@edel.kz
type: rcpt
bcc_dest: ai-inbox@michael.kz
active: 1
```

После доставки письма появятся в интерфейсе в блоке «Входящая почта». Кнопка «Обновить письма» только перечитывает список из D1, она не подключается к IMAP.

Письма группируются по папкам:

- `inbox` — полученные;
- `in_work` — в работе;
- `done` — закрытые;
- `trash` — удаленные.

Менеджер сначала нажимает «Открыть», письмо помечается как просмотренное, затем доступны действия: «В работу», «Создать заявку», «Закрыть», «Не просмотрено», «Удалить» и восстановление из удаленных. `DELETE /api/email/messages/:id` выполняет мягкое удаление в `trash` и не удаляет исходное письмо на mailcow-сервере.

Если отправитель не относится к заявкам, менеджер может включить галочку «Не показывать письма от этого отправителя». Worker сохраняет адрес в `email_sender_filters`, а `GET /api/email/messages` исключает письма активных скрытых отправителей из рабочих папок. Список скрытых отправителей возвращается через `GET /api/email/sender-filters`; восстановление выполняется через `DELETE /api/email/sender-filters/:id`.

## Gemini API

Gemini поддерживается как альтернативный провайдер.

Получите ключ в Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

Добавьте secret:

```powershell
npx wrangler secret put GEMINI_API_KEY
```

Чтобы использовать Gemini вместо OpenAI, измените в `wrangler.toml`:

```toml
AI_PROVIDER = "gemini"
GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-flash"
GEMINI_RETRY_ATTEMPTS = "3"
GEMINI_RETRY_BASE_DELAY_MS = "800"
```

Если Gemini временно перегружен и отвечает `high demand` / `try again later`, Worker делает автоматические повторы. Для обхода перегрузки конкретной модели можно добавить переменную со списком резервных моделей:

```toml
GEMINI_FALLBACK_MODELS = "model-one,model-two"
```

Чтобы вернуться на OpenAI:

```toml
AI_PROVIDER = "openai"
```

## Локальный запуск

Соберите frontend:

```powershell
cd ..\frontend
npm install
npm run build
```

Запустите Worker:

```powershell
cd ..\worker
npm run dev
```

## Deploy

```powershell
cd frontend
npm run build
cd ..\worker
npm run deploy
```
