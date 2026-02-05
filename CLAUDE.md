# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обязательные требования

1. **Язык общения**: Всегда общаться с пользователем на русском языке.
2. **Запрет запуска**: Не запускать самостоятельно для теста сервер, приложение, страницу и т.д. Можно запускать только линтер. Тесты осуществляет сам пользователь.
3. **Формат ответа**: В ответе не писать код — только архитектуру (текстовые описания шагов, названия таблиц/файлов, логические схемы).

## Команды разработки

### Фронтенд (корень проекта)
```bash
npm install          # установка зависимостей
npm run dev          # Vite dev-сервер (localhost:5173)
npm run build        # production-сборка
npm run lint         # ESLint (ts, tsx)
npm run preview      # предпросмотр production-сборки
```

### Прокси-сервер (директория proxy/)
```bash
cd proxy
npm install          # установка зависимостей
npm run dev          # ts-node-dev с hot reload (порт 3001)
npm run build        # компиляция TypeScript → dist/
```

### Supabase типы
```bash
npm run gen:types    # генерация TypeScript типов из Supabase схемы
```

## Архитектура системы

Трёхуровневая система: React SPA → Express прокси-сервер (VPS) → Supabase + AI провайдеры.

- **Фронтенд** — React 18 + TypeScript + Vite 7, Ant Design 5 (UI), Recharts (графики)
- **Прокси** — Node.js + Express 5, TypeScript, Zod (валидация), axios
- **БД** — Supabase (PostgreSQL) с доступом через service_role ключ на сервере
- **AI провайдеры** — OpenAI, Gemini, DeepSeek, Grok напрямую + 400+ моделей через OpenRouter
- **RAG** — Cloud.ru Managed RAG (retrieve + reranking)

Безопасность реализована через прокси-сервер (JWT + middleware), **НЕ** через Row Level Security (RLS).

## Фронтенд — Feature-Sliced Design (FSD)

```
src/
├── app/          # провайдеры (auth, theme, router, React Query)
├── pages/        # страницы: login, signup, chat, admin
├── widgets/      # сложные UI блоки: header, sidebar, chat-window
├── features/     # бизнес-фичи: auth, chat-input, model-selector, prompt-selector
├── entities/     # бизнес-сущности: chat, models, prompts, rag, statistics, users
│   └── */api/    # API-файлы сущностей (entity-name-api.ts)
│   └── */model/  # Zustand-сторы сущностей
│   └── */ui/     # UI-компоненты сущностей
├── shared/       # api/, lib/, config/, hooks/, types/, utils/
└── layout/       # layout-обёртки
```

**Алиас путей**: `@/` → `./src` (настроен в tsconfig.json и vite.config.ts)

**State Management**:
- **Zustand** — auth-store (сессия, профиль), chat-store (чаты, сообщения, модель), prompts-store, rag-store
- **TanStack Query** — серверные данные (статистика, модели, пользователи)

**Маршрутизация** (React Router 7): `/login`, `/signup`, `/chat/:conversationId`, `/admin` (только для роли admin)

**Vite proxy**: в dev-режиме `/api/*` проксируется на удалённый прокси-сервер

## Прокси-сервер

```
proxy/src/
├── index.ts              # точка входа, регистрация маршрутов
├── config/               # cors, limits, aiProviders
├── middleware/            # auth (JWT + requireAdmin), rateLimiter, validation (Zod)
├── services/             # chatService, costLimiterService, CloudRuTokenService
├── routes/v1/            # chat, models, admin, settings, public-settings, rag
└── types/                # расширения типов Express
```

**Порядок middleware**: CORS → JSON parser (10MB) → публичные маршруты → auth middleware → защищённые маршруты → requireAdmin → rate limiter

**Rate limiting**: 100 req/15min (общий), 20 req/min (chat/rag). Cost-based лимит: $50/час.

**Маршрутизация моделей**: таблица `model_routing_config` определяет — использовать прямой API провайдера или OpenRouter.

## Ключевые конвенции

- **Строгий TypeScript** везде (strict mode)
- **Максимальный размер файла: 600 строк** — разбивать на компоненты по функциональным блокам
- **SUPABASE_SERVICE_ROLE_KEY** — ТОЛЬКО на сервере (proxy/.env), никогда в клиенте
- **SUPABASE_ANON_KEY** — для клиентских операций
- **Environment variables** — только в `.env.local` (фронтенд) и `proxy/.env` (прокси)
- **Каждый slice** экспортирует через `index.ts`
- **Все Supabase-запросы** должны включать обработку ошибок
- **Все chat-сообщения** (вопросы и ответы) на русском языке

## Миграции БД

- Всегда создавать **НОВЫЕ** миграционные файлы, никогда не дополнять существующие
- Паттерн: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
- При создании таблиц обязательно добавлять `GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_name TO service_role`

## Ключевые таблицы Supabase

- `user_profiles` — профили с ролями (user/admin) и лимитами
- `models` + `model_routing_config` — модели и маршрутизация (direct/OpenRouter)
- `user_model_access` — контроль доступа пользователей к моделям
- `conversations` + `messages` — история чатов
- `usage_logs` — логи использования (токены, стоимость)
- `prompts` — системные промпты по ролям
- `settings` — глобальные настройки портала
- `knowledge_bases`, `rag_logical_sections`, `rag_objects`, `rag_queries`, `s3_buckets` — RAG-система

## RAG (Cloud.ru)

Интеграция с Cloud.ru Managed RAG: авторизация через временные токены (`CLOUD_RU_KEY_ID` + `CLOUD_RU_KEY_SECRET`), кэширование токенов в `CloudRuTokenService` (singleton). Поддержка простого retrieve и retrieve с reranking (модели BAAI/bge-reranker). Настройки reranking хранятся в таблице `settings`.

## Деплой

- **Production**: VPS (185.200.179.0), Nginx → pm2 (Node.js proxy на :3001), статика фронтенда
- **Docker Compose**: `docker-compose.yml` — сервисы frontend (:8080) и proxy (:3001)
- **Домен**: https://aihub.fvds.ru (SSL через Let's Encrypt)
