# GitHub + Cloudflare Deploy

Этот проект сейчас рассчитан на запуск без Docker через Cloudflare Workers, D1 и Wrangler.

## 1. Что нужно установить локально

- Git
- Node.js 22+
- Wrangler

GitHub CLI `gh` у вас сейчас не установлен. Для автоматического создания репозитория установите его:

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

Приложение защищено HTTP Basic Auth. Логин по умолчанию:

```text
manager
```

Пароль задайте как Cloudflare Worker secret:

```powershell
npx wrangler secret put ACCESS_PASSWORD
```

После этого при открытии сайта браузер попросит логин и пароль. Если `ACCESS_PASSWORD` не задан, Worker специально не откроет приложение.

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

`CLOUDFLARE_ACCOUNT_ID` больше не обязателен: Account ID указан в `worker/wrangler.toml`.

Пароль доступа `ACCESS_PASSWORD` задается не в GitHub Secrets, а в Cloudflare Worker secrets через Wrangler:

```powershell
cd C:\Users\User\Documents\Codex\2026-06-12\files-mentioned-by-the-user-txt\sales-ai-manager\worker
npx wrangler secret put ACCESS_PASSWORD
```

API token должен иметь права:

- Workers Scripts: Edit
- D1: Edit
- Account Settings: Read

## 7. Автоматический запуск

После каждого push в ветку `main` GitHub Actions выполнит:

1. сборку React frontend;
2. установку Worker dependencies;
3. применение D1 migrations;
4. деплой Cloudflare Worker.

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
