import { promises as fs } from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set. Add it in Railway Variables.");

const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "tasks.json");
const UTC_OFFSET_HOURS = Number(process.env.UTC_OFFSET_HOURS || 3);
const CHECK_INTERVAL_MS = 60_000;
const MAX_IMPORT_BYTES = 2_000_000;

const bot = new Bot(token);
const drafts = new Map();
let store = { nextId: 1, tasks: [], diary: [] };
let saveQueue = Promise.resolve();

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const loaded = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    store = {
      nextId: Number.isInteger(loaded.nextId) ? loaded.nextId : 1,
      tasks: Array.isArray(loaded.tasks) ? loaded.tasks : [],
      diary: Array.isArray(loaded.diary) ? loaded.diary : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveStore();
  }
}

function saveStore() {
  saveQueue = saveQueue.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(temporary, DATA_FILE);
  });
  return saveQueue;
}

function parseDateTime(value) {
  const match = String(value).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  const utc = Date.UTC(year, month - 1, day, hour - UTC_OFFSET_HOURS, minute);
  const date = new Date(utc);
  const localCheck = new Date(utc + UTC_OFFSET_HOURS * 3_600_000);
  if (
    localCheck.getUTCFullYear() !== year ||
    localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day ||
    localCheck.getUTCHours() !== hour ||
    localCheck.getUTCMinutes() !== minute
  ) return null;
  return date;
}

function formatDateTime(iso) {
  const date = new Date(new Date(iso).getTime() + UTC_OFFSET_HOURS * 3_600_000);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(iso) {
  const date = new Date(new Date(iso).getTime() + UTC_OFFSET_HOURS * 3_600_000);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function stateLabel(state) {
  return {
    in_progress: "🟡 В работе",
    completed: "✅ Завершена",
    canceled: "❌ Отменена",
  }[state] || state;
}

function categoryLabel(category) {
  return {
    workout: "🏃 Тренировка",
    nutrition: "🥗 Питание",
    measurement: "⚖️ Замер",
    recovery: "😴 Восстановление",
    general: "📌 Общее",
  }[category] || `📌 ${category || "Общее"}`;
}

function taskText(task) {
  const overdue = task.state === "in_progress" && Date.now() > new Date(task.deadline).getTime();
  return [
    `#${task.id} — ${task.title}`,
    `Категория: ${categoryLabel(task.category)}`,
    `Статус: ${task.status}`,
    `Состояние: ${stateLabel(task.state)}`,
    `Дедлайн: ${formatDateTime(task.deadline)}${overdue ? " ⚠️ просрочена" : ""}`,
    `Напоминание: каждые ${task.reminderMinutes} мин.`,
  ].join("\n");
}

function taskKeyboard(task) {
  if (task.state !== "in_progress") return undefined;
  return new InlineKeyboard()
    .text("✅ Завершить", `task:completed:${task.id}`)
    .text("❌ Отменить", `task:canceled:${task.id}`);
}

function userTasks(userId) {
  return store.tasks
    .filter((task) => task.userId === userId)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
}

function localNow() {
  return new Date(Date.now() + UTC_OFFSET_HOURS * 3_600_000);
}

function localBoundaryToUtc(localDate) {
  return new Date(localDate.getTime() - UTC_OFFSET_HOURS * 3_600_000);
}

function periodRange(type) {
  const now = localNow();
  let start;
  let end;
  if (type === "week") {
    const mondayOffset = (now.getUTCDay() + 6) % 7;
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (type === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  } else {
    const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), quarterMonth + 3, 1));
  }
  return { start: localBoundaryToUtc(start), end: localBoundaryToUtc(end) };
}

function splitMessage(text, maxLength = 3900) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + line + "\n").length > maxLength && current) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += `${line}\n`;
  }
  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

async function showPeriod(ctx, type) {
  const { start, end } = periodRange(type);
  const labels = { week: "Неделя", month: "Месяц", quarter: "Квартал" };
  const tasks = userTasks(ctx.from.id).filter((task) => {
    const deadline = new Date(task.deadline);
    return deadline >= start && deadline < end;
  });
  if (!tasks.length) return ctx.reply(`${labels[type]}: задач нет.`);

  const grouped = new Map();
  for (const task of tasks) {
    const key = formatDate(task.deadline);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  const lines = [`📅 ${labels[type]} — ${formatDateTime(start.toISOString())} → ${formatDateTime(new Date(end - 1).toISOString())}`, ""];
  for (const [date, dayTasks] of grouped) {
    lines.push(`— ${date} —`);
    for (const task of dayTasks) {
      lines.push(`${task.state === "completed" ? "✅" : task.state === "canceled" ? "❌" : "•"} ${formatDateTime(task.deadline).slice(12)} · ${categoryLabel(task.category)} · #${task.id} ${task.title}`);
    }
    lines.push("");
  }
  for (const chunk of splitMessage(lines.join("\n"))) await ctx.reply(chunk);
}

function normalizeImportedTask(raw, index, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Задача ${index + 1}: ожидается объект.`);
  const title = String(raw.title || "").trim();
  if (!title) throw new Error(`Задача ${index + 1}: отсутствует title.`);
  const deadline = parseDateTime(raw.deadline);
  if (!deadline) throw new Error(`Задача ${index + 1}: deadline должен быть ДД.ММ.ГГГГ ЧЧ:ММ.`);
  const reminderMinutes = Number(raw.reminderMinutes ?? 60);
  if (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 525600) {
    throw new Error(`Задача ${index + 1}: reminderMinutes должен быть целым числом от 1 до 525600.`);
  }
  const state = raw.state || "in_progress";
  if (!["in_progress", "completed", "canceled"].includes(state)) {
    throw new Error(`Задача ${index + 1}: неизвестное state.`);
  }
  const category = raw.category || "general";
  const now = new Date();
  return {
    id: store.nextId++,
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    title,
    status: String(raw.status || "Запланирована").trim(),
    state,
    category: String(category).trim(),
    deadline: deadline.toISOString(),
    reminderMinutes,
    nextReminderAt: new Date(now.getTime() + reminderMinutes * 60_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function downloadTelegramFile(fileId) {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram не вернул путь к файлу.");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Не удалось скачать файл: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("JSON-файл слишком большой. Максимум 2 МБ.");
  return new TextDecoder("utf-8").decode(bytes);
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Я помогу вести задачи, тренировочный план и дневник.\n\n" +
      "/newtask — добавить задачу\n/import — инструкция по массовой загрузке\n" +
      "/tasks — все задачи\n/week — расписание недели\n/month — расписание месяца\n/quarter — расписание квартала\n" +
      "/progress — новая запись дневника\n/diary — последние записи\n/help — помощь",
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Дата: ДД.ММ.ГГГГ ЧЧ:ММ, например 16.07.2026 00:35.\n" +
      `Часовой пояс: UTC${UTC_OFFSET_HOURS >= 0 ? "+" : ""}${UTC_OFFSET_HOURS}.\n\n` +
      "/newtask — новая задача\n/import — JSON-шаблон\n/tasks — все задачи\n" +
      "/week, /month, /quarter — календарные представления\n" +
      "/progress — записать вес, питание, тренировку и заметку\n/diary — последние 14 записей\n/cancel — прервать ввод",
  );
});

bot.command("ping", (ctx) => ctx.reply("pong ✅"));

bot.command("newtask", async (ctx) => {
  drafts.set(ctx.from.id, { step: "title", data: {}, mode: "task" });
  await ctx.reply("Введите название задачи:");
});

bot.command("progress", async (ctx) => {
  drafts.set(ctx.from.id, { step: "weight", data: {}, mode: "progress" });
  await ctx.reply("Введите текущий вес в кг, например 96.4. Если не измеряли — отправьте дефис: -");
});

bot.command("cancel", async (ctx) => {
  if (drafts.delete(ctx.from.id)) await ctx.reply("Текущий ввод отменён.");
  else await ctx.reply("Сейчас нет незавершённого ввода.");
});

bot.command("tasks", async (ctx) => {
  const tasks = userTasks(ctx.from.id);
  if (!tasks.length) return ctx.reply("У вас пока нет задач. Добавьте первую командой /newtask или загрузите JSON через /import.");
  for (const task of tasks) await ctx.reply(taskText(task), { reply_markup: taskKeyboard(task) });
});

bot.command("week", (ctx) => showPeriod(ctx, "week"));
bot.command("month", (ctx) => showPeriod(ctx, "month"));
bot.command("quarter", (ctx) => showPeriod(ctx, "quarter"));

bot.command("diary", async (ctx) => {
  const entries = store.diary
    .filter((entry) => entry.userId === ctx.from.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 14);
  if (!entries.length) return ctx.reply("Дневник пока пуст. Добавьте запись командой /progress.");
  const text = entries.map((entry) => [
    `📓 ${formatDateTime(entry.createdAt)}`,
    `Вес: ${entry.weight == null ? "не указан" : `${entry.weight} кг`}`,
    `Тренировка: ${entry.workout}`,
    `Питание: ${entry.nutrition}`,
    `Заметка: ${entry.note}`,
  ].join("\n")).join("\n\n");
  for (const chunk of splitMessage(text)) await ctx.reply(chunk);
});

bot.command("import", async (ctx) => {
  await ctx.reply(
    "Отправьте JSON-файл следующим сообщением. Формат:\n\n" +
      '[\n  {\n    "title": "Кардио 40 минут",\n    "status": "Неделя 1",\n    "category": "workout",\n    "state": "in_progress",\n    "deadline": "20.07.2026 19:00",\n    "reminderMinutes": 60\n  }\n]\n\n' +
      "Категории: workout, nutrition, measurement, recovery, general. Максимум 2 МБ.",
  );
});

bot.callbackQuery(/^task:(completed|canceled):(\d+)$/, async (ctx) => {
  const [, state, idText] = ctx.match;
  const task = store.tasks.find((item) => item.id === Number(idText) && item.userId === ctx.from.id);
  if (!task) return ctx.answerCallbackQuery({ text: "Задача не найдена" });
  task.state = state;
  task.updatedAt = new Date().toISOString();
  await saveStore();
  await ctx.editMessageText(taskText(task));
  await ctx.answerCallbackQuery({ text: state === "completed" ? "Задача завершена" : "Задача отменена" });
});

bot.on("message:document", async (ctx) => {
  const document = ctx.message.document;
  const fileName = document.file_name || "";
  if (!fileName.toLowerCase().endsWith(".json") && document.mime_type !== "application/json") {
    return ctx.reply("Нужен файл с расширением .json.");
  }
  try {
    const content = await downloadTelegramFile(document.file_id);
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    const items = Array.isArray(parsed) ? parsed : parsed.tasks;
    if (!Array.isArray(items)) throw new Error("Корневой элемент должен быть массивом или объектом с массивом tasks.");
    if (!items.length) throw new Error("В файле нет задач.");
    if (items.length > 1000) throw new Error("За один раз можно загрузить не более 1000 задач.");

    const imported = [];
    const errors = [];
    for (let index = 0; index < items.length; index += 1) {
      try {
        imported.push(normalizeImportedTask(items[index], index, ctx));
      } catch (error) {
        errors.push(error.message);
      }
    }
    store.tasks.push(...imported);
    await saveStore();
    const result = [`Импорт завершён.`, `Добавлено: ${imported.length}`, `Ошибок: ${errors.length}`];
    if (errors.length) result.push("", ...errors.slice(0, 20), errors.length > 20 ? `…ещё ${errors.length - 20}` : "");
    await ctx.reply(result.filter(Boolean).join("\n"));
  } catch (error) {
    console.error("Import failed:", error);
    await ctx.reply(`Не удалось импортировать файл: ${error.message}`);
  }
});

bot.on("message:text", async (ctx) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return ctx.reply("Используйте /newtask, /import, /week или /progress.");
  const text = ctx.message.text.trim();

  if (draft.mode === "progress") {
    if (draft.step === "weight") {
      if (text === "-") draft.data.weight = null;
      else {
        const weight = Number(text.replace(",", "."));
        if (!Number.isFinite(weight) || weight < 20 || weight > 500) return ctx.reply("Введите вес числом, например 96.4, или дефис.");
        draft.data.weight = weight;
      }
      draft.step = "workout";
      return ctx.reply("Что было по тренировке? Например: «Ходьба 45 минут» или «Отдых». ");
    }
    if (draft.step === "workout") {
      draft.data.workout = text || "Не указано";
      draft.step = "nutrition";
      return ctx.reply("Как прошло питание? Например: «2300 ккал, план соблюдён». ");
    }
    if (draft.step === "nutrition") {
      draft.data.nutrition = text || "Не указано";
      draft.step = "note";
      return ctx.reply("Добавьте короткую заметку о самочувствии или отправьте дефис:");
    }
    if (draft.step === "note") {
      const entry = {
        id: `${ctx.from.id}-${Date.now()}`,
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        weight: draft.data.weight,
        workout: draft.data.workout,
        nutrition: draft.data.nutrition,
        note: text === "-" ? "Без заметки" : text,
        createdAt: new Date().toISOString(),
      };
      store.diary.push(entry);
      drafts.delete(ctx.from.id);
      await saveStore();
      return ctx.reply("Запись добавлена в дневник ✅");
    }
  }

  if (draft.step === "title") {
    if (!text) return ctx.reply("Название не должно быть пустым.");
    draft.data.title = text;
    draft.step = "category";
    return ctx.reply("Введите категорию: workout, nutrition, measurement, recovery или general:");
  }
  if (draft.step === "category") {
    const category = text.toLowerCase();
    if (!["workout", "nutrition", "measurement", "recovery", "general"].includes(category)) {
      return ctx.reply("Выберите: workout, nutrition, measurement, recovery или general.");
    }
    draft.data.category = category;
    draft.step = "status";
    return ctx.reply("Введите статус или краткий комментарий, например «Неделя 1»:");
  }
  if (draft.step === "status") {
    draft.data.status = text || "Новая";
    draft.step = "deadline";
    return ctx.reply("Введите дедлайн ДД.ММ.ГГГГ ЧЧ:ММ, например 20.07.2026 18:30:");
  }
  if (draft.step === "deadline") {
    const deadline = parseDateTime(text);
    if (!deadline) return ctx.reply("Не удалось распознать дату. Пример: 16.07.2026 00:35");
    draft.data.deadline = deadline.toISOString();
    draft.step = "interval";
    return ctx.reply("Через сколько минут повторять напоминание? Например 60:");
  }
  if (draft.step === "interval") {
    const reminderMinutes = Number(text);
    if (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 525600) return ctx.reply("Введите целое число от 1 до 525600.");
    const now = new Date();
    const task = {
      id: store.nextId++, userId: ctx.from.id, chatId: ctx.chat.id,
      title: draft.data.title, category: draft.data.category, status: draft.data.status,
      state: "in_progress", deadline: draft.data.deadline, reminderMinutes,
      nextReminderAt: new Date(now.getTime() + reminderMinutes * 60_000).toISOString(),
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    store.tasks.push(task);
    drafts.delete(ctx.from.id);
    await saveStore();
    return ctx.reply(`Задача создана.\n\n${taskText(task)}`, { reply_markup: taskKeyboard(task) });
  }
});

async function sendDueReminders() {
  const now = Date.now();
  const due = store.tasks.filter((task) => task.state === "in_progress" && new Date(task.nextReminderAt).getTime() <= now);
  for (const task of due) {
    try {
      const overdue = now > new Date(task.deadline).getTime();
      await bot.api.sendMessage(task.chatId, `${overdue ? "⚠️ Просроченная задача" : "⏰ Напоминание о задаче"}\n\n${taskText(task)}`, {
        reply_markup: taskKeyboard(task),
        disable_notification: false,
      });
      task.nextReminderAt = new Date(now + task.reminderMinutes * 60_000).toISOString();
      task.updatedAt = new Date().toISOString();
    } catch (error) {
      console.error(`Failed to remind task #${task.id}:`, error);
      task.nextReminderAt = new Date(now + task.reminderMinutes * 60_000).toISOString();
    }
  }
  if (due.length) await saveStore();
}

bot.catch((error) => console.error("Bot error:", error.error));
const shutdown = async (signal) => {
  console.log(`${signal} received, stopping bot...`);
  await saveQueue;
  await bot.stop();
  process.exit(0);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

await loadStore();
setInterval(() => sendDueReminders().catch(console.error), CHECK_INTERVAL_MS).unref();
await sendDueReminders();
console.log(`Bot is starting. Data file: ${DATA_FILE}`);
bot.start({ onStart: ({ username }) => console.log(`@${username} is running`) });
