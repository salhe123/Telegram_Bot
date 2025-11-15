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
        n8n_voice_lead: !!process.env.N8N_VOICE_LEAD_WEBHOOK_URL, 
        n8n_confirm_lead: !!process.env.N8N_CONFIRM_WEBHOOK_URL, 
        n8n_create_task: !!process.env.N8N_CREATE_TASK_WEBHOOK_URL,
        n8n_convert_lead: !!process.env.N8N_CONVERT_LEAD_WEBHOOK_URL,
        n8n_voice_deal: !!process.env.N8N_VOICE_DEAL_WEBHOOK_URL,
        n8n_confirm_deal: !!process.env.N8N_CONFIRM_DEAL_WEBHOOK_URL,
      },
    };
    console.log("[HEALTH] GET /health to 200");
    res.json(health);
  });

  app.get("/", (req, res) => {
    console.log("[ROOT] GET / to 200");
    res.send("Frappe CRM Bot is running");
  });
}



module.exports = setupRoutes;