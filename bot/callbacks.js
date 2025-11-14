const axios = require("axios");
const bot = require("./telegram");
const { runSearch } = require("./commands");

function setupCallbacks() {
    bot.on("callback_query", async (query) => {
        const chatId = query.message.chat.id;
        const action = query.data;
        console.log(`[CALLBACK] chatId: ${chatId} | action: ${action}`);

        bot.session[chatId] = bot.session[chatId] || {};
        bot.session[chatId].search = bot.session[chatId].search || {
            query: "",
            page: 1,
            filters: {},
        };

        if (action === "creat_lead") {
            console.log(`[CALLBACK] creat_lead to prompt voice`);
            await bot.sendMessage(
                chatId,
                "Send a *voice message* with lead details.\nSet CRM with \/setcrm <URL>* first.",
                { parse_mode: "Markdown" }
            );
        } else if (action === "update_lead") {
            console.log(`[CALLBACK] update_lead to prompt /search`);
            await bot.sendMessage(chatId, "Type: `/search Acme` or `/search John`", {
                parse_mode: "Markdown",
            });
        } else if (action.startsWith("select_lead:")) {
            const leadName = action.split(":")[1];
            console.log(`[CALLBACK] select_lead to selected: ${leadName}`);
            bot.session[chatId].selectedLead = leadName;
            console.log(`[CALLBACK] select_lead to saved: ${leadName}`);
            await bot.sendMessage(
                chatId,
                `Selected: *${leadName}*\n\nSend *voice* to update.`,
                { parse_mode: "Markdown" }
            );
        } else if (action.startsWith("confirm_draft:")) {
            const draftId = action.split(":")[1];
            const crmBaseUrl =
                bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

            const leadData = {};
            const lines = query.message.text.split("\n").filter((l) => l.trim() !== "");
            console.log(
                "[CALLBACK] confirm_draft to parsing lead data from message",
                lines
            );

            for (const line of lines) {
                const clean = line.replace(/\*/g, "").trim();
                const match = clean.match(/• (.+?): (.+)/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/ /g, "_");
                    leadData[key] = match[2].trim();
                }
            }

            try {
                await bot.editMessageText("Creating lead...", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });

                await axios.post(process.env.N8N_CONFIRM_WEBHOOK_URL, {
                    draftId,
                    chatId,
                    crmBaseUrl,
                    leadData: JSON.stringify(leadData),
                });

                await bot.editMessageText("Waiting for CRM...", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch (err) {
                console.error("[ERROR]", err.message);
                await bot.editMessageText("Error.", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            }
        } else if (action === "cancel_draft") {
            console.log("[CALLBACK] cancel_draft to user cancelled");
            await bot.editMessageText("Cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id,
            });

            // === More / Previous / Filter ===
        } else if (action === "more") {
            bot.session[chatId].search.page += 1;
            bot.answerCallbackQuery(query.id);
            await runSearch(chatId, bot.session[chatId].search.query);
        } else if (action === "prev") {
            if (bot.session[chatId].search.page > 1) {
                bot.session[chatId].search.page -= 1;
                bot.answerCallbackQuery(query.id);
                await runSearch(chatId, bot.session[chatId].search.query);
            }
        } else if (action === "filter") {
            bot.answerCallbackQuery(query.id);
            await bot.sendMessage(
                chatId,
                "Filter by:\n`owner:glenn`\n`status:Open`\n\nSend: `/search Test filter:owner:glenn,status:Open`",
                { parse_mode: "Markdown" }
            );
        }

        bot.answerCallbackQuery(query.id);
    });
}

module.exports = setupCallbacks;
