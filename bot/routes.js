function setupRoutes(app) {
  app.get("/health", (req, res) => {
    const health = {
      status: "OK",
      timestamp: new Date().toISOString(),
      timezone: "EAT (UTC+3)",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: {
        token: !!process.env.TELEGRAM_BOT_TOKEN,
        crm: !!process.env.FRAPPE_CRM_BASE_URL,
        n8n_voice: !!process.env.N8N_VOICE_WEBHOOK_URL,
        n8n_update: !!process.env.N8N_UPDATE_WEBHOOK_URL,
        n8n_confirm: !!process.env.N8N_CONFIRM_WEBHOOK_URL,
      },
    };
    console.log("[HEALTH] GET /health to 200");
    res.json(health);
  });

  app.get("/", (req, res) => {
    console.log("[ROOT] GET / to 200");
    res.send("Frappe Lead Bot is running");
  });
}

module.exports = setupRoutes;
