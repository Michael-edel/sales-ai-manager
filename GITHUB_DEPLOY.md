# GitHub + Cloudflare Deploy

Этот проект сейчас рассчитан на запуск без Docker через Cloudflare Workers, D1 и Wrangler.

## 1. Что нужно установить локально

- Git
- Node.js 24
- Wrangler

Для управления репозиторием из PowerShell используется GitHub CLI `gh`. Если его нет, установите:

```powershell
winget install --id GitHub.cli
```

После установки:

```powershell
gh auth login
```

## 2. Создать Cloudflare D1

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\worker
npm install
npx wrangler login
npx wrangler d1 create sales-ai-manager
```

Скопируйте `database_id` в:

```text
worker/wrangler.toml
```

вместо:

```text
REPLACE_WITH_D1_DATABASE_ID
```

## 3. Добавить OpenAI secret в Cloudflare Worker

```powershell
npx wrangler secret put OPENAI_API_KEY
```

## 3.0. Закрыть доступ к приложению паролем

Приложение защищено встроенной формой входа и cookie-сессиями. Первый логин по умолчанию:

```text
manager
```

Пароль задайте как Cloudflare Worker secret:

```powershell
npx wrangler secret put ACCESS_PASSWORD
```

Если `ACCESS_PASSWORD` не задан, Worker специально не создаст первого администратора.

## 3.1. Добавить Gemini API key

Gemini API key получите в Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

Добавьте secret:

```powershell
npx wrangler secret put GEMINI_API_KEY
```

Выбор провайдера задается в `worker/wrangler.toml`:

```toml
AI_PROVIDER = "openai"
```

или:

```toml
AI_PROVIDER = "gemini"
GEMINI_MODEL = "gemini-3.5-flash"
```

## 4. Проверить локально через Wrangler

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\frontend
npm install
npm run build

cd ..\worker
npm run d1:migrate:local
npm run dev
```

## 5. Создать GitHub repository

Если установлен `gh`:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager
git init
git branch -M main
git add .
git commit -m "cloudflare workers d1 mvp"
gh repo create sales-ai-manager --private --source=. --remote=origin --push
```

Если репозиторий нужен публичный, замените `--private` на `--public`.

## 6. GitHub Secrets

В GitHub repository откройте:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Добавьте:

```text
CLOUDFLARE_API_TOKEN
```

Добавьте также:

```text
CLOUDFLARE_ACCOUNT_ID
```

Пароль доступа `ACCESS_PASSWORD` задается не в GitHub Secrets, а в Cloudflare Worker secrets через Wrangler:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\worker
npx wrangler secret put ACCESS_PASSWORD
```

API token должен иметь права:

- Account Settings: Read;
- Workers Scripts: Edit;
- D1: Edit;
- Workers R2 Storage: Edit;
- Workers Routes: Edit для зоны `michael.kz`;
- User Details: Read;
- Memberships: Read.

Ограничьте token только аккаунтом приложения и зоной `michael.kz`. Не сохраняйте его значение в Git, README или `.env` репозитория.

## 7. Автоматический запуск

После каждого push в ветку `main` GitHub Actions выполнит:

1. тесты email-bridge, IMAP-ingest, parser-service и Worker;
2. проверку типов, production-аудит зависимостей и сборку React frontend;
3. проверку доступа CI token к R2 bucket;
4. применение D1 migrations;
5. деплой Cloudflare Worker.

Workflow:

```text
.github/workflows/deploy-cloudflare.yml
```

## 8. Ручной deploy

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\frontend
npm run build
cd ..\worker
npm run d1:migrate:remote
npm run deploy
```
