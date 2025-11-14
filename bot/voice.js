const axios = require("axios");
const bot = require("./telegram");

function setupVoiceHandler() {
    bot.on("voice", async (msg) => {
        const chatId = msg.chat.id;
        const fileId = msg.voice.file_id;

        console.log(`[VOICE] Received | chatId: ${chatId} | fileId: ${fileId}`);

        bot.session[chatId] = bot.session[chatId] || {};

        try {
            await bot.sendMessage(chatId, "Processing voice...");
            console.log("[VOICE] Getting file link...");
            const file = await bot.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            console.log("[VOICE] File URL:", fileUrl);

            const crmBaseUrl =
                bot.session[chatId].crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;
            if (!crmBaseUrl) {
                console.log("[VOICE] CRM not set");
                return bot.sendMessage(chatId, "Set CRM: */setcrm <URL>*", {
                    parse_mode: "Markdown",
                });
            }

            const payload = { fileUrl, chatId, crmBaseUrl };
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
            console.error("[VOICE] ERROR:", err.message);
            bot.sendMessage(chatId, "Error. Try again.");
        }
    });
}

module.exports = setupVoiceHandler;
