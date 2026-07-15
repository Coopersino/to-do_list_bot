# Telegram Task Bot for Railway

Бот создаёт задачи, хранит их на Railway Volume и отправляет повторяющиеся напоминания, пока задача не завершена или не отменена.

## Команды

- `/newtask` — создать задачу
- `/tasks` — показать задачи
- `/cancel` — прервать создание
- `/help` — помощь
- `/ping` — проверка работы

## Переменные Railway

- `BOT_TOKEN` — токен от BotFather
- `DATA_DIR=/data`
- `UTC_OFFSET_HOURS=3` — часовой пояс для вводимых дат

## Обязательный Railway Volume

Добавьте Volume к сервису и укажите Mount Path `/data`. Без Volume файл задач может быть потерян после нового деплоя или перезапуска контейнера.

## Запуск

```bash
npm ci
npm start
```
