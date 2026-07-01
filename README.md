# Sales AI Manager MVP

Веб-приложение для обработки заявок менеджера по продажам ТОО Michael.

Основной целевой runtime: **Cloudflare Workers + D1 + Wrangler**.

Production URL:

```text
https://ai.michael.kz
```

## Текущая production-версия

Актуальная облачная версия работает на Cloudflare Workers и D1:

- адрес: `https://ai.michael.kz`;
- вход через форму приложения, без браузерного Basic Auth;
- первый пользователь: `manager` с ролью `admin`;
- пароль `manager` сбрасывается через D1/админ-панель и не хранится в Git;
- администратор может создавать пользователей, сбрасывать пароли, отключать доступ и назначать роли `admin`, `manager`, `accountant`, `viewer`;
- API закрыт cookie-сессиями;
- сессии хранятся в D1 `auth_sessions`;
- пользователи хранятся в D1 `app_users`;
- история заявок, CRM, задачи, документы сделки и журнал действий сохраняются в D1;
- правила ИИ и 1С хранятся в D1 `ai_rules`, редактируются администратором и добавляются к системному промпту при каждой новой обработке.
- `.pdf` в Cloudflare-версии может обрабатываться напрямую через Gemini; `.docx` и `.xlsx` требуют отдельный `parser-service`, если задан `PARSER_SERVICE_URL`;
- деплой выполняется через GitHub Actions на Node.js 24 с секретами `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GEMINI_API_KEY`.

## Роли и доступ

В Cloudflare-версии включено разграничение прав на уровне API и интерфейса:

- `admin` — полный доступ: обработка заявок, статусы, документы сделки, задачи, создание пользователей и сброс паролей.
- `manager` — рабочий доступ менеджера: заявки, ответы клиентам, проверка почты, изменение статусов, счета, приложения к договору и задачи. Эта роль включает рабочие права бухгалтерского блока по сделке.
- `accountant` — доступ бухгалтерии: просмотр заявок, счета, приложения к договору и задачи по документам; создание AI-обработок и проверка почты недоступны.
- `viewer` — только просмотр истории, результатов, CRM-сводки и задач без изменения данных.

Если пользователь пытается выполнить действие без прав, backend возвращает `403`, а frontend блокирует соответствующие поля и кнопки.
Если администратор отключает пользователя, его активные сессии удаляются, но история заявок и журнал действий остаются в базе.

Docker/FastAPI версия в проекте оставлена как legacy-прототип, но для дальнейшей работы используйте папку `worker/`.

## Что входит

- React + Vite frontend.
- Python + FastAPI backend.
- PostgreSQL для истории заявок.
- Загрузка `.xlsx`, `.pdf`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`, `.webm`.
- Обработка `.pdf` напрямую через Gemini, если `AI_PROVIDER=gemini` и `PARSER_SERVICE_URL` не задан.
- Извлечение текста из `.docx`, `.xlsx` и расширенный разбор `.pdf`; в Cloudflare-версии это делает отдельный Python `parser-service`.
- Vision-анализ сканированных PDF, если parser-service не нашел текст и вернул изображения страниц.
- Vision-анализ скриншотов WhatsApp/Telegram и фото товара через OpenAI API.
- Транскрибация голосовых сообщений WhatsApp/Telegram через OpenAI API.
- Фиксация компании клиента, менеджера клиента, менеджера Michael и канала связи.
- CRM-ядро: клиенты, контакты, менеджеры Michael, статусы заявок, приоритеты и журнал действий.
- Автоматическое определение `ТОО KBI Energy` как VIP-клиента с требованием приложения к годовому договору.
- Учет документов сделки: номер/дата счета, статус счета, статус приложения к договору, дата отправки клиенту.
- Генерация Word-совместимого `.doc` приложения к годовому договору для KBI Energy из выбранной заявки/счета.
- Чек-лист задач по каждой заявке: цена с НДС, ответ клиенту, счет, приложение к договору.
- Общая панель открытых задач, чтобы видеть незавершенные действия без открытия каждой заявки.
- Встроенная авторизация: вход через форму, cookie-сессии, пользователи и роли.
- Админская страница правил ИИ и 1С: цены всегда с НДС, счет от ТОО Michael, KBI всегда счет + приложение, данные и цены из 1С/документа, запрет придумывать цены.
- Прием входящей почты из `direktor@edel.kz` через отдельный `imap-ingest` с сохранением писем в D1.
- Запасной прием входящей почты через Cloudflare Email Routing `email()` handler.
- Обработка сохраненного письма в заявку через `/api/email/messages/:id/process`.
- SMTP-отправка блока D через отдельный `email-bridge`.
- Отправка утвержденных Meta WhatsApp template messages через Cloud API.
- Отправка заявки в OpenAI API.
- Сохранение исходного текста и ответа ИИ в таблицу `requests`.
- Копирование раздела D «Черновик для клиента».

## Cloudflare запуск без Docker

Подробная инструкция:

```text
GITHUB_DEPLOY.md
```

Кратко:

```powershell
cd worker
npm install
npx wrangler d1 create sales-ai-manager
npx wrangler secret put ACCESS_PASSWORD
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put PARSER_SERVICE_TOKEN
npx wrangler secret put EMAIL_BRIDGE_TOKEN
npx wrangler secret put EMAIL_INGEST_TOKEN
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npm run d1:migrate:local

cd ..\frontend
npm install
npm run build

cd ..\worker
npm run dev
```

Для `.pdf` в Cloudflare-версии достаточно Gemini. Для `.docx`, `.xlsx` и расширенного разбора PDF отдельно запустите `parser-service` и задайте `PARSER_SERVICE_URL`.
Для отправки email через SMTP отдельно запустите `email-bridge` и задайте `EMAIL_BRIDGE_URL`.

## Legacy Docker запуск

```powershell
cd sales-ai-manager
Copy-Item .env.example .env
notepad .env
docker compose up --build
```

В `.env` укажите:

```env
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-5.5
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
```

Если модель недоступна для вашего аккаунта, измените только `OPENAI_MODEL` в `.env`.

Для mailcow заполните IMAP/SMTP:

```env
MAIL_IMAP_HOST=mail.your-domain.kz
MAIL_IMAP_PORT=993
MAIL_IMAP_FOLDER=INBOX
MAIL_ACCOUNTS=Продажи 1|manager1@your-domain.kz|password1|Иван;Yandex закупки|yourbox@yandex.kz|app-password|Ольга|imap.yandex.ru|993|INBOX
MAIL_SMTP_HOST=mail.your-domain.kz
MAIL_SMTP_PORT=587
```

Формат `MAIL_ACCOUNTS`: `название ящика|email|пароль|ответственный менеджер|imap_host|imap_port|folder`, несколько ящиков разделяются `;`.
Поля `imap_host|imap_port|folder` можно не указывать, тогда используются общие `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_IMAP_FOLDER`.

Откройте:

```text
http://localhost:5173
```

Backend API:

```text
http://localhost:8000
```

## Куда вставить системный промпт

Полный корпоративный регламент вставьте в файл:

```text
backend/prompts/sales_manager_system.md
```

После изменения промпта перезапустите backend:

```powershell
docker compose restart backend
```

## Проверка первой заявки

1. Откройте `http://localhost:5173`.
2. Вставьте тест:

```text
Добрый день. Нужен кабель ВВГнг-LS 3х2.5, 200 м. Цена нужна с НДС. Доставка Экибастуз. Также нужен ЭСФ.
```

3. Нажмите «Обработать».
4. Проверьте, что результат содержит разделы A-F.
5. Нажмите «Копировать D», чтобы скопировать клиентский текст.

## Настройки ИИ и 1С

Администратор видит блок `Правила ИИ и 1С` в интерфейсе приложения. Эти правила хранятся в D1-таблице `ai_rules` и автоматически добавляются к системному промпту перед каждой новой обработкой текста, файла, изображения, PDF или письма.

По умолчанию включены обязательные правила:

- все цены, суммы и ответы клиенту готовятся с НДС 16%;
- счет и коммерческий ответ всегда от поставщика `ТОО Michael`;
- для `ТОО KBI Energy` / `KBI Energy Group` всегда требуется связка `счет + приложение к годовому договору`;
- карточки клиентов, договоры, реквизиты, номенклатура, коды товаров, остатки и цены берутся из 1С или из загруженного документа 1С;
- финальный счет не создается ИИ и не создается приложением, счет выставляется только через 1С;
- ИИ запрещено придумывать цену, скидку, наличие, срок поставки или код товара; если данных нет в счете, прайсе или 1С, результат должен говорить `цену нужно проверить в 1С`.

API:

```text
GET /api/ai/rules
PATCH /api/ai/rules
```

`PATCH /api/ai/rules` доступен только роли `admin`. Обязательные правила нельзя отключить через интерфейс или API.

## CRM-ядро

Cloudflare-версия теперь сохраняет не только результат ИИ, но и CRM-данные:

- карточки клиентов в `crm_clients`;
- контакты клиента в `crm_contacts`;
- менеджеров Michael в `michael_managers`;
- статус, приоритет и следующее действие в `requests`;
- журнал действий в `request_events`.
- задачи по заявке в `request_tasks`;
- документы сделки прямо в заявке: `invoice_number`, `invoice_date`, `invoice_status`, `contract_appendix_status`.

В левой панели интерфейса отображаются:

- количество открытых заявок;
- количество VIP-заявок;
- количество клиентов;
- количество открытых задач;
- быстрый список открытых задач с переходом к заявке, закрытием задачи и удалением ошибочной задачи;
- историю заявок с кнопками закрытия заявки и полного удаления ошибочной заявки из истории.

Статусы заявок:

```text
new
in_progress
need_clarification
reply_ready
quote_sent
invoice_required
invoice_sent
done
closed
lost
```

Если компания клиента указана как `ТОО KBI Energy`, `KBI Energy` или `КБИ Энерджи`, заявка автоматически получает:

- `client_type = vip`;
- `requires_contract_appendix = 1`;
- напоминание в интерфейсе: счет отправлять вместе с приложением к годовому договору.
- автоматические задачи: подготовить счет от ТОО Michael и приложение к годовому договору.

### Приложение к договору для KBI Energy

Для KBI Energy каждый счет должен идти вместе с приложением к годовому договору.

Рабочий порядок в интерфейсе:

1. Откройте заявку KBI Energy в истории.
2. В блоке «Документы сделки» заполните номер счета и дату счета.
3. Нажмите «Создать приложение».
4. Программа скачает Word-совместимый файл `.doc` с приложением в форме KBI Energy.
5. Статус приложения в заявке станет `prepared`, а в журнал действий запишется событие `request.contract_appendix_generated`.

Файл формируется без изменения данных 1С: он берет номер/дату счета, извлеченные ИИ данные по товару и делает приложение по шаблону KBI. Если в счете несколько позиций, в приложение попадают все строки счета с кодами товара, наименованиями, единицами измерения, количеством, ценой и суммой с НДС 16%:

- заголовок по центру: `Приложение №____ от ... к Договору поставки № 71-02-26/СН от 17 февраля 2026 года`;
- таблица: `№`, `Код`, `Наименование`, `Ед. изм.`, `Кол-во`, `Цена за ед. изм., с НДС 16%`, `Сумма с НДС 16%`, `Гарантия`;
- строки-заголовки исходного счета, начинающиеся с `№`, не добавляются как товарные позиции;
- ширина таблицы ограничена под лист A4: код и наименование шире, служебные колонки уже, длинные значения переносятся внутри ячеек;
- строка общей стоимости прописью;
- условия: `DDP, г. Экибастуз`;
- срок оплаты: `20 календарных дней с момента получения Товара`;
- гарантия по умолчанию: `14 дней`;
- реквизиты покупателя `ТОО «KBI Energy Group»` и поставщика `ТОО «Michael»` размещены в таблице без границ: одна строка, две колонки;
- подписи сторон расположены отдельно в колонках покупателя и поставщика, без линий и без `М.П.`; строки `Директор` выровнены на одном уровне, поставщик подписывается как `Эйрих М.М.`.

Если товарные строки из счета не распознаны, программа не добавляет пустую техническую позицию в приложение.

Номер приложения, подписи и финальную табличную часть менеджер/бухгалтер проверяет в Word перед отправкой клиенту.

Основные API endpoints:

```text
POST /api/requests/:id/contract-appendix
PATCH /api/requests/:id/status
DELETE /api/requests/:id
DELETE /api/requests/:id/tasks/:taskId
```

Доступ к генерации приложения и управлению задачами есть у ролей `admin`, `manager`, `accountant`. Закрытие и удаление заявок доступно ролям `admin` и `manager`.

Автоматические задачи для каждой новой заявки:

```text
Проверить наличие и цену с НДС
Подготовить ответ клиенту
```

Для голосовой заявки дополнительно:

```text
Проверить транскрибацию голосового сообщения
```

Для KBI Energy дополнительно:

```text
Подготовить счет от ТОО Michael
Подготовить приложение к годовому договору
```

Документные статусы счета:

```text
not_required
required
prepared
sent
paid
cancelled
```

Документные статусы приложения:

```text
not_required
required
prepared
sent
signed
cancelled
```

После деплоя примените D1 migrations:

```powershell
cd worker
npm run d1:migrate:remote
```

## Проверка WhatsApp-скриншота или фото товара

1. Откройте `http://localhost:5173`.
2. Нажмите «Выбрать файл».
3. Выберите скриншот `.png/.jpg/.webp`, например скрин переписки WhatsApp с фото товара и количеством.
4. В поле текста добавьте пояснение к файлу, например:

```text
Клиент просит 50 шт этого товара. Нужно проверить цену с НДС и подготовить ответ для WhatsApp.
```

5. Нажмите «Обработать».
6. Система отправит изображение и пояснение в OpenAI vision-анализ и сохранит результат в историю.

## Проверка PDF/DOCX/XLSX

Cloudflare Worker не может напрямую запускать Python-библиотеки для офисных документов. Поэтому:

- `.pdf` может обрабатываться напрямую через Gemini без `parser-service`;
- `.docx` и `.xlsx` требуют внешний `parser-service`;
- для более точного извлечения текста/сканов PDF тоже можно подключить `parser-service`.

Сервис находится здесь:

```text
parser-service/
```

Локальный запуск:

```powershell
cd parser-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PARSER_SERVICE_TOKEN="change-this-parser-token"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Тест parser-service:

```powershell
cd parser-service
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

В `worker/.dev.vars` для локального запуска укажите:

```env
PARSER_SERVICE_URL=http://127.0.0.1:8080
PARSER_SERVICE_TOKEN=change-this-parser-token
```

Для production `PARSER_SERVICE_URL` должен указывать на доступный HTTPS-адрес parser-service, а `PARSER_SERVICE_TOKEN` задается как secret:

```powershell
cd worker
npx wrangler secret put PARSER_SERVICE_TOKEN
```

Что поддерживается:

- `.pdf`: напрямую через Gemini, если `AI_PROVIDER=gemini` и `PARSER_SERVICE_URL` не задан;
- `.docx`: текст параграфов и таблиц;
- `.xlsx`: строки всех листов;
- `.pdf`: текстовый слой через PyMuPDF при подключенном parser-service;
- сканированный `.pdf`: первые страницы рендерятся в JPEG и отправляются в vision-анализ.

Parser-service также проверяется в GitHub Actions перед деплоем Worker.

В интерфейсе в блоке новой обработки отображается статус `Parser-service`:

- `подключен` — Worker успешно получил ответ от `PARSER_SERVICE_URL`;
- `PDF через Gemini` — `PARSER_SERVICE_URL` не задан, PDF будет обработан напрямую, DOCX/XLSX пока недоступны;
- `ошибка` — URL задан, но сервис не отвечает или вернул ошибку.

Проверить статус через API можно так:

```text
GET /api/parser/health
```

## Проверка голосового WhatsApp

1. В поле «Компания клиента» укажите `ТОО KBI Energy`, если запрос от этого клиента.
2. Укажите менеджера клиента и менеджера Michael.
3. В канале связи выберите `WhatsApp`.
4. Нажмите «Выбрать файл» и загрузите голосовое сообщение `.ogg/.opus/.mp3/.m4a/.wav/.webm`.
5. В пояснении можно написать контекст: `VIP клиент KBI Energy, нужен счет и приложение к договору`.
6. Нажмите «Обработать».

Система сначала сделает транскрибацию аудио, затем сформирует результат A-F.

## Прием входящей почты

Основной рабочий вариант для `direktor@edel.kz` — отдельный IMAP-ingest сервис. Он подключается к mailcow по IMAP, читает только указанный ящик и отправляет письма в Worker через защищенный endpoint:

```text
Клиент -> direktor@edel.kz
mailcow сохраняет письмо в direktor@edel.kz
imap-ingest читает INBOX по IMAP без удаления писем
imap-ingest отправляет письмо -> https://ai.michael.kz/api/email/ingest
Cloudflare Worker сохраняет письмо в D1 email_messages
ИИ-менеджер показывает письмо в блоке «Входящая почта»
```

Worker принимает такие письма через `POST /api/email/ingest`. Endpoint защищен секретом `EMAIL_INGEST_TOKEN`; без него письмо не сохраняется. Повторная доставка того же IMAP UID не создает дубликат.

Локальная настройка IMAP-ingest:

```powershell
cd imap-ingest
Copy-Item .env.example .env
notepad .env
```

В `.env` заполните:

```env
IMAP_HOST=mail-edel.edel.kz
IMAP_PORT=143
IMAP_SSL=false
IMAP_STARTTLS=true
IMAP_USERNAME=direktor@edel.kz
IMAP_PASSWORD=пароль_или_app_password_ящика
WORKER_INGEST_URL=https://ai.michael.kz/api/email/ingest
EMAIL_INGEST_TOKEN=тот_же_секрет_что_в_Worker
```

Secret в Worker:

```powershell
cd worker
npx wrangler secret put EMAIL_INGEST_TOKEN
```

Проверка одной загрузки писем:

```powershell
cd imap-ingest
python app\main.py --once
```

Постоянный запуск:

```powershell
cd imap-ingest
python app\main.py
```

В интерфейсе:

1. Откройте блок «Входящая почта».
2. Нажмите «Обновить письма» — кнопка только перечитывает D1, а не подключается к IMAP сама.
3. Новые письма появятся в списке после работы `imap-ingest`.
4. Выберите папку: `Полученные`, `В работе`, `Поставщики`, `Покупатели`, `Закрытые` или `Удаленные`.
5. Нажмите «Открыть» — письмо раскроется сразу под выбранной строкой и будет помечено как просмотренное. Повторное нажатие «Свернуть» закрывает это письмо, а кнопка «Свернуть письмо» закрывает открытый просмотр.
6. В строке письма доступны быстрые действия: «Удалить» для переноса в `Удаленные` или «Вернуть» для восстановления из `Удаленные`.
7. После просмотра можно:
   - перенести письмо в `В работу`;
   - перенести письмо в `Поставщики`;
   - перенести письмо в `Покупатели`;
   - создать заявку A-F из письма;
   - закрыть письмо;
   - пометить его как не просмотренное;
   - переместить письмо в `Удаленные`;
   - восстановить письмо из `Удаленные` обратно в `Полученные`.
8. При переносе письма в `Поставщики` или `Покупатели` отправитель сохраняется как правило маршрутизации. Новые письма от этого адреса автоматически попадают в ту же папку, а счетчик вкладки показывает общее количество и новые непросмотренные письма.
9. Если отправитель точно не присылает заявки, отметьте галочку «Не показывать письма от этого отправителя». Адрес попадет в список скрытых отправителей, и письма от него больше не будут отображаться в рабочих папках. Карточка «Скрытые» находится в одном ряду с папками и по умолчанию свернута; восстановить адрес можно после раскрытия кнопкой «показывать».
10. Если почтовый список мешает работе с заявкой, нажмите «Свернуть почту» в заголовке блока. Список писем, вкладки и фильтры полностью скроются до нажатия «Показать почту».

Кнопки в списке писем больше не запускают AI-обработку напрямую. Сначала менеджер открывает письмо, проверяет содержимое, и только после этого нажимает «Создать заявку».

Обработка уже сохраненного письма выполняется через:

```text
POST /api/email/messages/:id/process
```

Управление состоянием письма выполняется через:

```text
GET /api/email/messages?folder=inbox|in_work|suppliers|buyers|done|trash
GET /api/email/sender-filters
POST /api/email/sender-filters
DELETE /api/email/sender-filters/:id
PATCH /api/email/messages/:id
DELETE /api/email/messages/:id
```

Удаление письма в приложении мягкое: запись переносится в папку `Удаленные`. Исходное письмо в mailcow через этот endpoint не удаляется.

Cloudflare Email Routing также поддерживается как запасной вариант. В Worker есть `email()` handler, который получает MIME-письмо, извлекает отправителя, получателя, тему, текст и имена вложений, затем сохраняет письмо в `email_messages`. Для этого нужен маршрут Cloudflare Email Routing на Worker `sales-ai-manager`.

Старый вариант через recipient BCC map:

```text
local_dest: direktor@edel.kz
type: rcpt
bcc_dest: ai-inbox@michael.kz
active: 1
```

BCC map оставляет письмо в `direktor@edel.kz` и отправляет копию в Worker через Cloudflare Email Routing. Не меняйте MX записи домена `edel.kz`, если рабочая почта остается на mailcow.

## SMTP-отправка через email-bridge

SMTP-логин и пароль не хранятся в Worker и браузере. Для отправки email добавлен отдельный сервис:

```text
email-bridge/
```

Локальный запуск:

```powershell
cd email-bridge
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

В Worker задайте:

```env
EMAIL_BRIDGE_URL=https://email-bridge.your-domain.kz
EMAIL_BRIDGE_TOKEN=change-this-email-token
```

Secret:

```powershell
cd worker
npx wrangler secret put EMAIL_BRIDGE_TOKEN
```

После настройки в интерфейсе можно отправить блок D «Черновик для клиента» по email, если в контакте заявки указан email-адрес.

## Meta WhatsApp шаблоны

Cloudflare-версия поддерживает ручную отправку только утвержденных Meta WhatsApp template messages. Это не WhatsApp Web и не неофициальная автоматизация.

Что нужно получить в Meta:

- WhatsApp Business Account;
- подключенный номер WhatsApp Business;
- `Phone Number ID`;
- permanent access token с правами `whatsapp_business_messaging` и `whatsapp_business_management`;
- заранее утвержденные templates в WhatsApp Manager.

Secrets Worker:

```powershell
cd worker
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

Версия Graph API задается не секретной переменной в `worker/wrangler.toml`:

```toml
WHATSAPP_API_VERSION = "v24.0"
```

В интерфейсе администратор видит блок `Meta WhatsApp шаблоны`. Там нужно указать точные `template_name` и `language_code`, которые уже утверждены в Meta. Если имя в программе не совпадает с именем утвержденного шаблона Meta, отправка будет отклонена Meta API.

Отправка из заявки:

1. Откройте заявку.
2. В блоке `WhatsApp Meta` укажите номер клиента в международном формате, например `77001234567`.
3. Выберите шаблон.
4. Если в BODY шаблона есть переменные `{{1}}`, `{{2}}`, укажите значения по строкам.
5. Нажмите `Отправить WhatsApp`.

API:

```text
GET /api/whatsapp/health
GET /api/whatsapp/templates
POST /api/whatsapp/templates
PATCH /api/whatsapp/templates
POST /api/whatsapp/send-template
```

Все отправки сохраняются в D1 `whatsapp_template_messages` и в журнале заявки `request_events`.

## Полезные команды PowerShell

```powershell
cd sales-ai-manager
Copy-Item .env.example .env
notepad .env
notepad backend\prompts\sales_manager_system.md
docker compose up --build
```

Остановка:

```powershell
docker compose down
```

Остановка с удалением базы:

```powershell
docker compose down -v
```

## Ограничения MVP

В этой версии нет прямой интеграции с 1С, Telegram, входящими WhatsApp-сообщениями, остатками и ценами. Приложение не проводит документы и не меняет учетные данные. WhatsApp сейчас поддерживается только для ручной отправки утвержденных Meta template messages из заявки.

## Cloudflare Workers + D1

Добавлена отдельная Cloudflare-версия backend в папке:

```text
worker/
```

Она использует:

- Cloudflare Workers;
- Cloudflare D1;
- Wrangler;
- статические assets React из `frontend/dist`.

Документация запуска:

```text
worker/README.md
```

Кратко:

```powershell
cd worker
npm install
npx wrangler d1 create sales-ai-manager
npx wrangler secret put OPENAI_API_KEY
npm run d1:migrate:local
cd ..\frontend
npm install
npm run build
cd ..\worker
npm run dev
```

Важно: Cloudflare-версия переносит заявки, D1, Gemini/OpenAI text/vision/audio и обработку PDF/DOCX/XLSX через внешний parser-service. Входящая почта для `direktor@edel.kz` принимается через внешний `imap-ingest`, потому что сам Worker не подключается к IMAP/POP3.

Cloudflare Worker поддерживает два LLM-провайдера:

```toml
AI_PROVIDER = "openai"
```

или:

```toml
AI_PROVIDER = "gemini"
GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-flash"
GEMINI_RETRY_ATTEMPTS = "3"
GEMINI_RETRY_BASE_DELAY_MS = "800"
```

`OPENAI_API_KEY` и `GEMINI_API_KEY` задаются как Cloudflare secrets через Wrangler.

Если Gemini возвращает временную ошибку перегрузки вроде `high demand` / `try again later`, Worker автоматически повторяет запрос с экспоненциальной паузой. Для резервных моделей можно добавить переменную:

```toml
GEMINI_FALLBACK_MODELS = "model-one,model-two"
```

Значения моделей лучше менять в Cloudflare/GitHub без правки кода, чтобы быстро обходить временную перегрузку конкретной модели.

## Защита доступа

Cloudflare-версия использует встроенную авторизацию приложения.
Интерфейс открывается как обычная страница, но API закрыт cookie-сессиями.

Первый пользователь создается автоматически при первом запросе, если таблица пользователей пустая:

```text
логин: manager
роль: admin
пароль: значение Cloudflare secret ACCESS_PASSWORD
```

Пароль первого пользователя задается как Cloudflare Worker secret:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\worker
npx wrangler secret put ACCESS_PASSWORD
```

Администратор в интерфейсе может создавать пользователей:

```text
admin — полный доступ и управление пользователями
manager — заявки, ответы клиентам, счета и приложения к договору
accountant — счета и приложения к договору
viewer — просмотр
```

Пароли хранятся в D1 как PBKDF2/SHA-256 hash + salt. Сессии хранятся в таблице `auth_sessions`.

Новых пользователей и роли создавайте в интерфейсе под администратором `manager`.

Если пароль администратора потерян, его можно сбросить через D1 или временно пересоздать первого пользователя только после очистки таблицы `app_users`. Не записывайте реальные пароли в Git, README или `.env`.
