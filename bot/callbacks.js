const axios = require("axios");
const bot = require("./telegram");
const { runSearch } = require("./commands");
const crmManager = require("./crm_manager");

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
            doctype: "CRM Lead" // Default doctype for search
        };

        if (action === "creat_lead") {
            console.log(`[CALLBACK] creat_lead to prompt voice`);
            bot.session[chatId].currentDoctype = "CRM Lead"; // Set current doctype for voice input
            await bot.sendMessage(
                chatId,
                "Send a *voice message* with lead details.\nUse `/usecrm <alias>` to select a CRM first.",
                { parse_mode: "Markdown" }
            );
        } else if (action === "update_lead") {
            console.log(`[CALLBACK] update_lead to prompt /searchleads`);
            bot.session[chatId].currentDoctype = "CRM Lead"; // Set current doctype for search
            await bot.sendMessage(chatId, "Type: `/searchleads Acme` or `/searchleads John`", {
                parse_mode: "Markdown",
            });
        } else if (action === "creat_deal") {
            console.log(`[CALLBACK] creat_deal to prompt voice`);
            bot.session[chatId].currentDoctype = "CRM Deal"; // Set current doctype for voice input
            await bot.sendMessage(
                chatId,
                "Send a *voice message* with deal details.\nUse `/usecrm <alias>` to select a CRM first.",
                { parse_mode: "Markdown" }
            );
        } else if (action === "update_deal") {
            console.log(`[CALLBACK] update_deal to prompt /searchdeals`);
            bot.session[chatId].currentDoctype = "CRM Deal"; // Set current doctype for search
            await bot.sendMessage(chatId, "Type: `/searchdeals ProjectX` or `/searchdeals ClientY`", {
                parse_mode: "Markdown",
            });
        } else if (action.startsWith("select_lead:")) {
            const leadName = action.split(":")[1];
            console.log(`[CALLBACK] select_lead to selected: ${leadName}`);
            bot.session[chatId].selectedDocName = leadName; // Use generic selectedDocName
            bot.session[chatId].currentDoctype = "CRM Lead";
            console.log(`[CALLBACK] select_lead to saved: ${leadName}`);
            await bot.sendMessage(
                chatId,
                `Selected: *${leadName}*\n\nSend *voice* to update.`,
                { parse_mode: "Markdown" }
            );
        } else if (action.startsWith("select_deal:")) {
            const dealName = action.split(":")[1];
            console.log(`[CALLBACK] select_deal to selected: ${dealName}`);
            bot.session[chatId].selectedDocName = dealName; // Use generic selectedDocName
            bot.session[chatId].currentDoctype = "CRM Deal";
            console.log(`[CALLBACK] select_deal to saved: ${dealName}`);
            await bot.sendMessage(
                chatId,
                `Selected: *${dealName}*\n\nSend *voice* to update.`,
                { parse_mode: "Markdown" }
            );
        } else if (action.startsWith("confirm_draft:")) {
            const draftId = action.split(":")[1];
            
            const activeCrmAlias = crmManager.getActiveCrmAlias(chatId);
            if (!activeCrmAlias) {
                await bot.editMessageText("No active CRM selected. Use `/usecrm <alias>` to select one.", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
                return;
            }

            const activeCrm = await crmManager.getCrm(chatId, activeCrmAlias);
            if (!activeCrm) {
                await bot.editMessageText(`Active CRM '${activeCrmAlias}' not found. Please use 
/usecrm <alias>
 to select a valid CRM.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
                return;
            }
            const crmBaseUrl = activeCrm.url;
            const frappeApiKey = activeCrm.apiKey;
            const frappeApiSecret = activeCrm.apiSecret;

            const leadData = {}; // This is still leadData, as this callback is for leads
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
                    frappeApiKey,
                    frappeApiSecret,
                    leadData: JSON.stringify(leadData),
                });

                await bot.editMessageText("Waiting for CRM...", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch (err) {
                console.error("[ERROR]", err.response?.data || err.message);
                await bot.editMessageText("Error creating lead.", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            }
        } else if (action.startsWith("confirm_deal_draft:")) { // New callback for deals
            const draftId = action.split(":")[1];
            
            const activeCrmAlias = crmManager.getActiveCrmAlias(chatId);
            if (!activeCrmAlias) {
                await bot.editMessageText("No active CRM selected. Use `/usecrm <alias>` to select one.", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
                return;
            }

            const activeCrm = await crmManager.getCrm(chatId, activeCrmAlias);
            if (!activeCrm) {
                await bot.editMessageText(`Active CRM '${activeCrmAlias}' not found. Please use 
/usecrm <alias>
 to select a valid CRM.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
                return;
            }
            const crmBaseUrl = activeCrm.url;
            const frappeApiKey = activeCrm.apiKey;
            const frappeApiSecret = activeCrm.apiSecret;

            const dealData = {}; // This is dealData
            const lines = query.message.text.split("\n").filter((l) => l.trim() !== "");
            console.log(
                "[CALLBACK] confirm_deal_draft to parsing deal data from message",
                lines
            );

            for (const line of lines) {
                const clean = line.replace(/\*/g, "").trim();
                const match = clean.match(/• (.+?): (.+)/);
                if (match) {
                    const key = match[1].trim().toLowerCase().replace(/ /g, "_");
                    dealData[key] = match[2].trim();
                }
            }

            try {
                await bot.editMessageText("Creating deal...", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });

                await axios.post(process.env.N8N_CONFIRM_DEAL_WEBHOOK_URL, { // New webhook for deals
                    draftId,
                    chatId,
                    crmBaseUrl,
                    frappeApiKey,
                    frappeApiSecret,
                    dealData: JSON.stringify(dealData),
                });

                await bot.editMessageText("Waiting for CRM...", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch (err) {
                console.error("[ERROR]", err.response?.data || err.message);
                await bot.editMessageText("Error creating deal.", {
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
        } else if (action.startsWith("more_")) {
            const doctype = action.split("_")[1] === "lead" ? "CRM Lead" : "CRM Deal";
            bot.session[chatId].search.page += 1;
            bot.answerCallbackQuery(query.id);
            await runSearch(chatId, bot.session[chatId].search.query, doctype);
        } else if (action.startsWith("prev_")) {
            const doctype = action.split("_")[1] === "lead" ? "CRM Lead" : "CRM Deal";
            if (bot.session[chatId].search.page > 1) {
                bot.session[chatId].search.page -= 1;
                bot.answerCallbackQuery(query.id);
                await runSearch(chatId, bot.session[chatId].search.query, doctype);
            }
        } else if (action.startsWith("filter_")) {
            const doctype = action.split("_")[1] === "lead" ? "CRM Lead" : "CRM Deal";
            bot.answerCallbackQuery(query.id);
            await bot.sendMessage(
                chatId,
                `Filter ${doctype.toLowerCase()} by:\n\`owner:glenn\`\n\`status:Open\`\n\nSend: 
/search${doctype === "CRM Lead" ? "leads" : "deals"} Test filter:owner:glenn,status:Open
`,{ parse_mode: "Markdown" }
            );
        }

        bot.answerCallbackQuery(query.id);
    });
}

module.exports = setupCallbacks;