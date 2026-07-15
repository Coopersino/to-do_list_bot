import { promises as fs } from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set. Add it in Railway Variables.");

const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "tasks.json");
const UTC_OFFSET_HOURS = Number(process.env.UTC_OFFSET_HOURS || 3);
const CHECK_INTERVAL_MS = 60_000;

const bot = new Bot(token);
const drafts = new Map();
let store = { nextId: 1, tasks: [] };
let saveQueue = Promise.resolve();

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
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
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
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

function stateLabel(state) {
  return {
    in_progress: "🟡 В работе",
    completed: "✅ Завершена",
    canceled: "❌ Отменена",
  }[state] || state;
}

function taskText(task) {
  const overdue = task.state === "in_progress" && Date.now() > new Date(task.deadline).getTime();
  return [
    `#${task.id} — ${task.title}`,
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

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Я помогу вести задачи и напоминать о них.\n\n" +
      "/newtask — добавить задачу\n" +
      "/tasks — показать задачи\n" +
      "/cancel — отменить текущее создание\n" +
      "/help — помощь",
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Создание задачи проходит по шагам. Дата вводится в формате ДД.ММ.ГГГГ ЧЧ:ММ.\n" +
      `Часовой пояс задаётся в Railway переменной UTC_OFFSET_HOURS, сейчас: UTC${UTC_OFFSET_HOURS >= 0 ? "+" : ""}${UTC_OFFSET_HOURS}.\n\n` +
      "/newtask — новая задача\n/tasks — список задач\n/cancel — прервать создание\n/ping — проверка бота",
  );
});

bot.command("ping", (ctx) => ctx.reply("pong ✅"));

bot.command("newtask", async (ctx) => {
  drafts.set(ctx.from.id, { step: "title", data: {} });
  await ctx.reply("Введите название задачи:");
});

bot.command("cancel", async (ctx) => {
  if (drafts.delete(ctx.from.id)) await ctx.reply("Создание задачи отменено.");
  else await ctx.reply("Сейчас нет незавершённого создания задачи.");
});

bot.command("tasks", async (ctx) => {
  const tasks = userTasks(ctx.from.id);
  if (!tasks.length) return ctx.reply("У вас пока нет задач. Добавьте первую командой /newtask.");
  for (const task of tasks) {
    await ctx.reply(taskText(task), { reply_markup: taskKeyboard(task) });
  }
});

bot.callbackQuery(/^task:(completed|canceled):(\d+)$/, async (ctx) => {
  const [, state, idText] = ctx.match;
  const task = store.tasks.find((item) => item.id === Number(idText) && item.userId === ctx.from.id);
  if (!task) {
    await ctx.answerCallbackQuery({ text: "Задача не найдена" });
    return;
  }
  task.state = state;
  task.updatedAt = new Date().toISOString();
  await saveStore();
  await ctx.editMessageText(taskText(task));
  await ctx.answerCallbackQuery({ text: state === "completed" ? "Задача завершена" : "Задача отменена" });
});

bot.on("message:text", async (ctx) => {
  const draft = drafts.get(ctx.from.id);
  if (!draft) return ctx.reply("Используйте /newtask для создания задачи или /tasks для просмотра списка.");
  const text = ctx.message.text.trim();

  if (draft.step === "title") {
    if (!text) return ctx.reply("Название не должно быть пустым.");
    draft.data.title = text;
    draft.step = "status";
    return ctx.reply("Введите статус или краткий комментарий по задаче, например «Новая» или «Жду материалы»: ");
  }

  if (draft.step === "status") {
    draft.data.status = text || "Новая";
    draft.step = "deadline";
    return ctx.reply("Введите дедлайн в формате ДД.ММ.ГГГГ ЧЧ:ММ, например 20.07.2026 18:30:");
  }

  if (draft.step === "deadline") {
    const deadline = parseDateTime(text);
    if (!deadline) return ctx.reply("Не удалось распознать дату. Используйте формат ДД.ММ.ГГГГ ЧЧ:ММ.");
    draft.data.deadline = deadline.toISOString();
    draft.step = "interval";
    return ctx.reply("Через сколько минут повторять напоминание? Введите целое число, например 60:");
  }

  if (draft.step === "interval") {
    const reminderMinutes = Number(text);
    if (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 525600) {
      return ctx.reply("Введите целое число от 1 до 525600 минут.");
    }
    const now = new Date();
    const task = {
      id: store.nextId++,
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      title: draft.data.title,
      status: draft.data.status,
      state: "in_progress",
      deadline: draft.data.deadline,
      reminderMinutes,
      nextReminderAt: new Date(now.getTime() + reminderMinutes * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    store.tasks.push(task);
    drafts.delete(ctx.from.id);
    await saveStore();
    return ctx.reply(`Задача создана.\n\n${taskText(task)}`, { reply_markup: taskKeyboard(task) });
  }
});

async function sendDueReminders() {
  const now = Date.now();
  const due = store.tasks.filter(
    (task) => task.state === "in_progress" && new Date(task.nextReminderAt).getTime() <= now,
  );
  for (const task of due) {
    try {
      const overdue = now > new Date(task.deadline).getTime();
      await bot.api.sendMessage(
        task.chatId,
        `${overdue ? "⚠️ Просроченная задача" : "⏰ Напоминание о задаче"}\n\n${taskText(task)}`,
        { reply_markup: taskKeyboard(task) },
      );
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
