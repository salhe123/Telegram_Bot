const axios = require("axios");
const bot = require("./telegram");
const crmManager = require("./crm_manager");

function setupVoiceHandler() {
    bot.on("voice", async (msg) => {
        const chatId = msg.chat.id;
        const fileId = msg.voice.file_id;

        console.log(`[VOICE] Received | chatId: ${chatId} | fileId: ${fileId}`);

        bot.session[chatId] = bot.session[chatId] || {};

        const activeCrmAlias = crmManager.getActiveCrmAlias(chatId);
        if (!activeCrmAlias) {
            console.log("[VOICE] No active CRM selected");
            return bot.sendMessage(chatId, "No active CRM selected. Use `/usecrm <alias>` to select one.", {
                parse_mode: "Markdown",
            });
        }

        const activeCrm = await crmManager.getCrm(chatId, activeCrmAlias);
        if (!activeCrm) {
            console.log(`[VOICE] Active CRM '${activeCrmAlias}' not found`);
            return bot.sendMessage(chatId, `Active CRM '${activeCrmAlias}' not found. Please use \\\`/usecrm <alias>\\\ to select a valid CRM.`, {
                parse_mode: "Markdown",
            });
        }
        const crmBaseUrl = activeCrm.url;
        const frappeApiKey = activeCrm.apiKey;
        const frappeApiSecret = activeCrm.apiSecret;


        try {
            await bot.sendMessage(chatId, "Processing voice...");
            console.log("[VOICE] Getting file link...");
            const file = await bot.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            console.log("[VOICE] File URL:", fileUrl);

            const payload = { fileUrl, chatId, crmBaseUrl, frappeApiKey, frappeApiSecret };
            const isUpdate = !!bot.session[chatId].selectedLead;

            if (isUpdate) {
                payload.leadName = bot.session[chatId].selectedLead;
                payload.isUpdate = true;
                delete bot.session[chatId].selectedLead;
                console.log(`[VOICE] UPDATE MODE to leadName: ${payload.leadName}`);
            } else {
                console.log("[VOICE] CREATE MODE to no selected lead");
            }

            const webhookUrl = isUpdate
                ? process.env.N8N_VOICE_WEBHOOK_URL
                : process.env.N8N_VOICE_WEBHOOK_URL;
            console.log(`[VOICE] POST to n8n to ${webhookUrl}`);
            console.log("[VOICE] Payload:", JSON.stringify(payload, null, 2));

            await axios.post(webhookUrl, payload);
            console.log("[VOICE] SUCCESS: sent to n8n");

            await bot.sendMessage(
                chatId,
                isUpdate ? "Updating lead..." : "Analyzing..."
            );
        } catch (err) {
            console.error("[VOICE] ERROR:", err.response?.data || err.message);
            bot.sendMessage(chatId, "Error. Try again.");
        }
    });
}

module.exports = setupVoiceHandler;