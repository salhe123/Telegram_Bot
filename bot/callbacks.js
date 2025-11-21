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
      doctype: "CRM Lead", // Default doctype for search
    };
    
    // Acknowledge the callback immediately for responsiveness
    await bot.answerCallbackQuery(query.id); 


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
      await bot.sendMessage(
        chatId,
        "Type: `/searchleads Acme` or `/searchleads John`",
        {
          parse_mode: "Markdown",
        }
      );
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
      await bot.sendMessage(
        chatId,
        "Type: `/searchdeals ProjectX` or `/searchdeals ClientY`",
        {
          parse_mode: "Markdown",
        }
      );
    } 
    
    // === NEW: Handle Update Lead from Search Results ===
    else if (action.startsWith("update_lead:")) {
      const leadName = action.split(":")[1];
      console.log(`[CALLBACK] update_lead to selected: ${leadName}`);
      bot.session[chatId].selectedDocName = leadName; 
      bot.session[chatId].currentDoctype = "CRM Lead";
      await bot.sendMessage(
        chatId,
        `Selected to **Update** Lead: *${leadName}*\n\nSend *voice* with the update details.`,
        { parse_mode: "Markdown" }
      );
    } 

    // === NEW: Handle Convert Lead to Deal from Search Results ===
    else if (action.startsWith("convert_lead:")) {
        const leadName = action.split(":")[1];
        console.log(`[CALLBACK] convert_lead selected: ${leadName}`);

        const activeCrm = await crmManager.getActiveCrmDetails(chatId);
        if (!activeCrm) {
            await bot.sendMessage(chatId, "No active CRM selected or authenticated. Use `/login` to set up your CRM.");
            return;
        }

        try {
            await bot.editMessageText(`Initiating conversion of Lead *${leadName}* to Deal...`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "Markdown"
            });
            
            // Trigger the n8n webhook for conversion
            await axios.post(process.env.N8N_CONVERT_LEAD_WEBHOOK_URL, {
                chatId,
                crmBaseUrl: activeCrm.url,
                frappeApiKey: activeCrm.apiKey,
                frappeApiSecret: activeCrm.apiSecret,
                leadName: leadName,
                telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
            });
            
            // The n8n workflow sends the final success message, so we just acknowledge initiation here.
        } catch (error) {
            console.error("[CALLBACK_CONVERT_LEAD] ERROR:", error.response?.data || error.message);
            await bot.editMessageText(`Failed to convert lead *${leadName}*. Check CRM details and n8n webhook.`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "Markdown"
            });
        }
    } 
    
    // === Original select_lead is now handled by update_lead: (above), keeping select_deal:
    else if (action.startsWith("select_deal:")) {
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
        await bot.editMessageText(
          "No active CRM selected. Use `/usecrm <alias>` to select one.",
          {
            chat_id: chatId,
            message_id: query.message.message_id,
          }
        );
        return;
      }

      const activeCrm = await crmManager.getActiveCrmDetails(chatId);
      if (!activeCrm) {
        await bot.editMessageText(
          `Active CRM '${activeCrmAlias}' not found. Please use \n/usecrm <alias>\n to select a valid CRM.`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
          }
        );
        return;
      }
      const crmBaseUrl = activeCrm.url;
      const frappeApiKey = activeCrm.apiKey;
      const frappeApiSecret = activeCrm.apiSecret;

      // Prefer original draft data stored in session if available and matches draftId
      let leadDataObj = null;
      if (
        bot.session[chatId] &&
        bot.session[chatId].draft &&
        bot.session[chatId].draft.draftId === draftId &&
        bot.session[chatId].draft.leadData
      ) {
        leadDataObj = bot.session[chatId].draft.leadData;
      } else {
        // Fallback: parse displayed message including nested Tasks/Notes
        leadDataObj = {};
        leadDataObj.tasks = [];
        leadDataObj.notes = [];

        const lines = query.message.text.split("\n");
        let currentSection = null;

        for (const rawLine of lines) {
          // remove formatting asterisks but preserve indentation for nested items
          const line = rawLine.replace(/\*/g, "").replace(/\r/g, "");
          if (!line.trim()) continue;

          // Top-level bullet like: • First Name: Alice
          const topMatch = line.trim().match(/^•\s*(.+?):\s*(.*)$/);
          if (topMatch) {
            const key = topMatch[1].trim().toLowerCase().replace(/ /g, "_");
            const value = topMatch[2].trim();

            if (key === "tasks") {
              currentSection = "tasks";
              continue;
            } else if (key === "notes") {
              currentSection = "notes";
              continue;
            } else {
              leadDataObj[key] = value;
              currentSection = null;
              continue;
            }
          }

          // Nested item lines under Tasks/Notes, e.g. "- title: Follow up..., description: ..., due_date: ..."
          const nestedMatch = line.match(/^\s*-\s*(.+)$/);
          if (nestedMatch && currentSection) {
            const payload = nestedMatch[1].trim();
            const obj = {};
            const parts = payload
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            for (const part of parts) {
              const kv = part.split(":");
              if (kv.length >= 2) {
                const k = kv[0].trim().toLowerCase().replace(/ /g, "_");
                const v = kv.slice(1).join(":").trim();
                obj[k] = v;
              } else {
                obj.text = part;
              }
            }
            if (currentSection === "tasks") leadDataObj.tasks.push(obj);
            if (currentSection === "notes") leadDataObj.notes.push(obj);
            continue;
          }

          // Lines that look like indented nested properties (e.g. "    - title: ...")
          const indentedMatch = rawLine.match(/^\s+[-•]\s*(.+)$/);
          if (indentedMatch && currentSection) {
            const payload = indentedMatch[1].trim();
            const obj = {};
            const parts = payload
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            for (const part of parts) {
              const kv = part.split(":");
              if (kv.length >= 2) {
                const k = kv[0].trim().toLowerCase().replace(/ /g, "_");
                const v = kv.slice(1).join(":").trim();
                obj[k] = v;
              } else {
                obj.text = part;
              }
            }
            if (currentSection === "tasks") leadDataObj.tasks.push(obj);
            if (currentSection === "notes") leadDataObj.notes.push(obj);
            continue;
          }
        }
      }

      // Ensure arrays exist
      leadDataObj.tasks = Array.isArray(leadDataObj.tasks)
        ? leadDataObj.tasks
        : leadDataObj.tasks
          ? [leadDataObj.tasks]
          : [];
      leadDataObj.notes = Array.isArray(leadDataObj.notes)
        ? leadDataObj.notes
        : leadDataObj.notes
          ? [leadDataObj.notes]
          : [];

      try {
        await bot.editMessageText("Creating lead...", {
          chat_id: chatId,
          message_id: query.message.message_id,
        });

        // send leadData as an object (not string)
        await axios.post(process.env.N8N_CONFIRM_WEBHOOK_URL, {
          draftId,
          chatId,
          crmBaseUrl,
          frappeApiKey,
          frappeApiSecret,
          leadData: leadDataObj,
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
      // ... existing code ...
    } else if (action.startsWith("confirm_deal_draft:")) {
      const draftId = action.split(":")[1];

      const activeCrmAlias = crmManager.getActiveCrmAlias(chatId);
      if (!activeCrmAlias) {
        await bot.editMessageText(
          "No active CRM selected. Use `/usecrm <alias>` to select one.",
          {
            chat_id: chatId,
            message_id: query.message.message_id,
          }
        );
        return;
      }

      const activeCrm = await crmManager.getActiveCrmDetails(chatId);
      if (!activeCrm) {
        await bot.editMessageText(
          `Active CRM '${activeCrmAlias}' not found. Please use 
/usecrm <alias>
 to select a valid CRM.`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
          }
        );
        return;
      }
      const crmBaseUrl = activeCrm.url;
      const frappeApiKey = activeCrm.apiKey;
      const frappeApiSecret = activeCrm.apiSecret;

      // --- START: ADVANCED DATA PARSING (Same as Lead Logic) ---
      const dealDataObj = {};
      dealDataObj.tasks = [];
      dealDataObj.notes = [];

      const lines = query.message.text.split("\n");
      let currentSection = null;

      for (const rawLine of lines) {
        // remove formatting asterisks but preserve indentation for nested items
        const line = rawLine.replace(/\*/g, "").replace(/\r/g, "");
        if (!line.trim()) continue;

        // 1. Top-level bullet like: • Deal Name: Project X
        const topMatch = line.trim().match(/^•\s*(.+?):\s*(.*)$/);
        if (topMatch) {
          const key = topMatch[1].trim().toLowerCase().replace(/ /g, "_");
          const value = topMatch[2].trim();

          if (key === "tasks") {
            currentSection = "tasks";
            continue;
          } else if (key === "notes") {
            currentSection = "notes";
            continue;
          } else {
            dealDataObj[key] = value;
            currentSection = null;
            continue;
          }
        }

        // 2. Nested item lines under Tasks/Notes
        const indentedMatch = rawLine.match(/^\s+[-•]\s*(.+)$/);
        if (indentedMatch && currentSection) {
          const payload = indentedMatch[1].trim();
          const obj = {};
          const parts = payload
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
          for (const part of parts) {
            const kv = part.split(":");
            if (kv.length >= 2) {
              const k = kv[0].trim().toLowerCase().replace(/ /g, "_");
              const v = kv.slice(1).join(":").trim();
              obj[k] = v;
            } else {
              obj.text = part;
            }
          }
          if (currentSection === "tasks") dealDataObj.tasks.push(obj);
          if (currentSection === "notes") dealDataObj.notes.push(obj);
          continue;
        }
      }

      // Ensure arrays exist and are arrays (important for n8n iterators)
      dealDataObj.tasks = Array.isArray(dealDataObj.tasks)
        ? dealDataObj.tasks
        : dealDataObj.tasks
          ? [dealDataObj.tasks]
          : [];
      dealDataObj.notes = Array.isArray(dealDataObj.notes)
        ? dealDataObj.notes
        : dealDataObj.notes
          ? [dealDataObj.notes]
          : [];
      // --- END: ADVANCED DATA PARSING ---

      try {
        await bot.editMessageText("Creating deal...", {
          chat_id: chatId,
          message_id: query.message.message_id,
        });

        // Send the full object (dealDataObj) to the n8n webhook
        await axios.post(process.env.N8N_CONFIRM_DEAL_WEBHOOK_URL, {
          draftId,
          chatId,
          crmBaseUrl,
          frappeApiKey,
          frappeApiSecret,
          dealData: dealDataObj,
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
      await runSearch(chatId, null, doctype);
    } else if (action.startsWith("prev_")) {
      const doctype = action.split("_")[1] === "lead" ? "CRM Lead" : "CRM Deal";
      if (bot.session[chatId].search.page > 1) {
        bot.session[chatId].search.page -= 1;
        await runSearch(chatId, null, doctype); 
      }
    } else if (action.startsWith("filter_")) {
      const doctype = action.split("_")[1] === "lead" ? "CRM Lead" : "CRM Deal";
      await bot.sendMessage(
        chatId,
        `Filter ${doctype.toLowerCase()} by:\n\`owner:glenn\`\n\`status:Open\`\n\nSend: 
/search${doctype === "CRM Lead" ? "leads" : "deals"} Test filter:owner:glenn,status:Open
`,
        { parse_mode: "Markdown" }
      );
    }
  });
}

module.exports = setupCallbacks;