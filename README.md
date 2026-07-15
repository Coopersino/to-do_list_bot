# Telegram bot for Railway

Минимальный Telegram-бот на Node.js и grammY.

## Возможности

- `/start`
- `/help`
- `/ping`
- ответ на любое текстовое сообщение
- корректная остановка при перезапуске Railway

## Локальный запуск

```bash
npm install
cp .env.example .env
export BOT_TOKEN="токен_из_BotFather"
npm start
```

## Развёртывание на Railway

1. Загрузите проект в GitHub.
2. В Railway создайте `New Project` → `Deploy from GitHub repo`.
3. Выберите репозиторий.
4. Откройте сервис → `Variables` и добавьте `BOT_TOKEN`.
5. Railway автоматически выполнит `npm install` и `npm start`.
6. В логах должна появиться строка `@имя_бота is running`.

Публичный домен не нужен: бот использует Telegram long polling.
