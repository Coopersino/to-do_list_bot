import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is not set. Add it in Railway Variables.");
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name || "друг";
  await ctx.reply(
    `Привет, ${name}! Я работаю на Railway.\n\n` +
      "Отправь мне сообщение — я отвечу на него.\n" +
      "Команды: /help, /ping",
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "/start — запустить бота\n" +
      "/ping — проверить работу\n" +
      "/help — показать помощь",
  );
});

bot.command("ping", async (ctx) => {
  await ctx.reply("pong ✅");
});

bot.on("message:text", async (ctx) => {
  await ctx.reply(`Вы написали: ${ctx.message.text}`);
});

bot.catch((error) => {
  console.error("Bot error:", error.error);
});

const shutdown = async (signal) => {
  console.log(`${signal} received, stopping bot...`);
  await bot.stop();
  process.exit(0);
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

console.log("Bot is starting...");
bot.start({
  onStart: ({ username }) => console.log(`@${username} is running`),
});
