# Telegram Task & Fitness Bot for Railway

Бот хранит задачи, напоминает о них, импортирует расписание из JSON и ведёт дневник тренировок, питания и веса.

## Команды

- `/newtask` — создать задачу вручную
- `/import` — получить формат массовой загрузки; затем отправить `.json`
- `/tasks` — все задачи
- `/week` — задачи текущей календарной недели
- `/month` — задачи текущего месяца
- `/quarter` — задачи текущего квартала
- `/progress` — добавить запись дневника
- `/diary` — последние 14 записей
- `/cancel` — отменить текущий ввод

## Railway Variables

```text
BOT_TOKEN=...
DATA_DIR=/data
UTC_OFFSET_HOURS=3
```

Подключите Railway Volume к `/data`, иначе данные могут исчезнуть при новом деплое.

## Формат JSON

См. `tasks-example.json`. Дата строго: `ДД.ММ.ГГГГ ЧЧ:ММ`.
Допустимые состояния: `in_progress`, `completed`, `canceled`.
Рекомендуемые категории: `workout`, `nutrition`, `measurement`, `recovery`, `general`.
