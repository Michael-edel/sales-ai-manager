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
- администратор может создавать пользователей и роли `admin`, `manager`, `accountant`, `viewer`;
- API закрыт cookie-сессиями;
- сессии хранятся в D1 `auth_sessions`;
- пользователи хранятся в D1 `app_users`;
- история заявок, CRM, задачи, документы сделки и журнал действий сохраняются в D1.

Docker/FastAPI версия в проекте оставлена как legacy-прототип, но для дальнейшей работы используйте папку `worker/`.

## Что входит

- React + Vite frontend.
- Python + FastAPI backend.
- PostgreSQL для истории заявок.
- Загрузка `.xlsx`, `.pdf`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`, `.webm`.
- Извлечение текста из документов.
- Vision-анализ скриншотов WhatsApp/Telegram и фото товара через OpenAI API.
- Транскрибация голосовых сообщений WhatsApp/Telegram через OpenAI API.
- Фиксация компании клиента, менеджера клиента, менеджера Michael и канала связи.
- CRM-ядро: клиенты, контакты, менеджеры Michael, статусы заявок, приоритеты и журнал действий.
- Автоматическое определение `ТОО KBI Energy` как VIP-клиента с требованием приложения к годовому договору.
- Учет документов сделки: номер/дата счета, статус счета, статус приложения к договору, дата отправки клиенту.
- Чек-лист задач по каждой заявке: цена с НДС, ответ клиенту, счет, приложение к договору.
- Общая панель открытых задач, чтобы видеть незавершенные действия без открытия каждой заявки.
- Встроенная авторизация: вход через форму, cookie-сессии, пользователи и роли.
- Проверка входящей почты mailcow через IMAP.
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
npm run d1:migrate:local

cd ..\frontend
npm install
npm run build

cd ..\worker
npm run dev
```

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
- быстрый список открытых задач с переходом к заявке.

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

## Проверка голосового WhatsApp

1. В поле «Компания клиента» укажите `ТОО KBI Energy`, если запрос от этого клиента.
2. Укажите менеджера клиента и менеджера Michael.
3. В канале связи выберите `WhatsApp`.
4. Нажмите «Выбрать файл» и загрузите голосовое сообщение `.ogg/.opus/.mp3/.m4a/.wav/.webm`.
5. В пояснении можно написать контекст: `VIP клиент KBI Energy, нужен счет и приложение к договору`.
6. Нажмите «Обработать».

Система сначала сделает транскрибацию аудио, затем сформирует результат A-F.

## Проверка входящей почты mailcow

1. Заполните `MAIL_IMAP_HOST` и `MAIL_ACCOUNTS` в `.env`.
2. Перезапустите backend.
3. В интерфейсе нажмите «Проверить почту».
4. Новые непрочитанные письма появятся в блоке «Почта mailcow».
5. Нажмите «Обработать письмо», чтобы создать заявку A-F.

В MVP письма только читаются через IMAP. Автоматическая отправка через SMTP пока не включена, чтобы менеджер подтверждал ответ вручную.

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

В этой версии нет интеграции с 1С, Telegram, WhatsApp, счетами, остатками и ценами. Приложение не проводит документы и не меняет учетные данные.

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

Важно: Cloudflare-версия пока переносит заявки, D1, OpenAI text/vision/audio. IMAP-проверка mailcow/Yandex остается в Docker/FastAPI-версии и требует отдельного bridge-сервиса для production.

Cloudflare Worker поддерживает два LLM-провайдера:

```toml
AI_PROVIDER = "openai"
```

или:

```toml
AI_PROVIDER = "gemini"
GEMINI_MODEL = "gemini-3.5-flash"
```

`OPENAI_API_KEY` и `GEMINI_API_KEY` задаются как Cloudflare secrets через Wrangler.

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
manager — работа с заявками и ответами клиентам
accountant — счета и приложения к договору
viewer — просмотр
```

Пароли хранятся в D1 как PBKDF2/SHA-256 hash + salt. Сессии хранятся в таблице `auth_sessions`.

Новых пользователей и роли создавайте в интерфейсе под администратором `manager`.

Если пароль администратора потерян, его можно сбросить через D1 или временно пересоздать первого пользователя только после очистки таблицы `app_users`. Не записывайте реальные пароли в Git, README или `.env`.
