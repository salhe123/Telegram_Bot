const bot = require("./telegram");

function setupWebhooks(app) {
  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || "https://telegram-bot-8qcb.onrender.com"}/webhook`;
  console.log("[WEBHOOK] Setting to:", webhookUrl);
  bot
    .setWebHook(webhookUrl)
    .then(() => console.log("[WEBHOOK] SUCCESS: Webhook set"))
    .catch((err) => console.error("[WEBHOOK] FAILED:", err.message));

  app.post("/webhook", (req, res) => {
    if (!req.body || !req.body.update_id) {
      console.log("[WEBHOOK] IGNORED: No update_id");
      return res.sendStatus(200);
    }
    console.log("[WEBHOOK] RECEIVED update_id:", req.body.update_id);
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

module.exports = setupWebhooks;
