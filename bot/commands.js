const axios = require("axios");
const bot = require("./telegram");
const crmManager = require("./crm_manager");
const { getFrappeApiKeys } = require("../config/crmApiKeys"); // Import directly

// Define states for the multi-step login process
const LOGIN_STATE = {
    NONE: 0,
    WAITING_FOR_ALIAS: 1,
    WAITING_FOR_USERNAME: 2,
    WAITING_FOR_PASSWORD: 3,
};

function setupCommands() {
    // Initialize user CRM sessions
    bot.on("message", (msg) => {
        crmManager.initializeUserCrmSession(msg.chat.id);
    });

    // === /start ===
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        console.log(`[COMMAND /start] chatId: ${chatId}`);
        bot.sendMessage(chatId, "Welcome to Frappe CRM Bot!", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Create Lead", callback_data: "creat_lead" }],
                    [{ text: "Update Lead", callback_data: "update_lead" }],
                    [{ text: "Create Deal", callback_data: "creat_deal" }],
                    [{ text: "Update Deal", callback_data: "update_deal" }],
                ],
            },
        });
    });

    bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        console.log(`[COMMAND /help] chatId: ${chatId}`);
        bot.sendMessage(
            chatId,
            `
*Frappe CRM Bot – Quick Help*

*1. CRM Management*
  - \`/login\`: Log in to your Frappe CRM instance.
  - \`/listcrms\`: List your configured CRM instances.
  - \`/usecrm <alias>\`: Set an active CRM instance.
  - \`/delcrm <alias>\`: Delete a configured CRM instance.

*2. Lead Management*
  - Create Lead: Send voice to Confirm draft (Tasks & Notes can be included in voice)
  - Update Lead: Type: \`/searchleads Acme\` to See top 5 results and select and update (Tasks & Notes can be included in voice)

*3. Deal Management*
  - Create Deal: Send voice to Confirm draft (Tasks & Notes can be included in voice)
  - Update Deal: Type: \`/searchdeals ProjectX\` to See top 5 results and select and update (Tasks & Notes can be included in voice)

*4. Search Tips*  
to Use org name, contact name, or ID

*5. Integrated Task & Note Creation*
  - Tasks and Notes are now created via voice input when creating or updating Leads and Deals.
  - Simply mention tasks (e.g., "create a task to call John tomorrow") or notes (e.g., "add a note: client was happy") in your voice message.

*6. Convert Lead to Deal*
  - \`/convertlead <lead_name>\` (Currently disabled as per your request)

Need help? Just type /help!
  `,
            { parse_mode: "Markdown" }
        );
    });

    // === /login command ===
    bot.onText(/\/login/, async (msg) => {
        const chatId = msg.chat.id;
        bot.session[chatId] = bot.session[chatId] || {};
        bot.session[chatId].loginState = LOGIN_STATE.WAITING_FOR_ALIAS;
        await bot.sendMessage(chatId, "Please enter the alias for your CRM instance (e.g., 'mycompany', 'anothercrm'):");
    });

    // === /listcrms command ===
    bot.onText(/\/listcrms/, async (msg) => {
        const chatId = msg.chat.id;
        const crmAliases = crmManager.listUserCrmAliases(chatId);
        if (crmAliases.length === 0) {
            return bot.sendMessage(chatId, "No CRMs configured yet. Use `/login` to add one.");
        }
        const crmList = crmAliases.map(alias => {
            const isActive = crmManager.getActiveCrmAlias(chatId) === alias;
            return `- ${alias} ${isActive ? "(active)" : ""}`;
        }).join("\n");
        await bot.sendMessage(chatId, `Your configured CRMs:\n${crmList}`);
    });

    // === /usecrm command ===
    bot.onText(/\/usecrm (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const alias = match[1].trim();
        const crmConfig = await crmManager.getCrmConfig(chatId, alias);
        if (crmConfig && crmManager.setActiveCrmAlias(chatId, alias)) {
            await bot.sendMessage(chatId, `CRM '${alias}' is now active.`);
        } else {
            await bot.sendMessage(chatId, `CRM with alias '${alias}' not found or not configured.`);
        }
    });

    // === /delcrm command ===
    bot.onText(/\/delcrm (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const alias = match[1].trim();
        if (crmManager.deleteUserCrm(chatId, alias)) {
            await bot.sendMessage(chatId, `CRM '${alias}' deleted successfully.`);
        } else {
            await bot.sendMessage(chatId, `CRM with alias '${alias}' not found.`);
        }
    });

    // === General message handler for login flow ===
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        // Ignore commands and messages from the bot itself
        if (msg.text && msg.text.startsWith("/") || msg.from.is_bot) {
            return;
        }

        bot.session[chatId] = bot.session[chatId] || {};
        const loginState = bot.session[chatId].loginState || LOGIN_STATE.NONE;

        switch (loginState) {
            case LOGIN_STATE.WAITING_FOR_ALIAS:
                const alias = msg.text.trim();
                if (!crmManager.validateCrmAlias(alias)) {
                    await bot.sendMessage(chatId, `Alias '${alias}' not recognized. Please contact your admin or try another alias.`);
                    bot.session[chatId].loginState = LOGIN_STATE.NONE; // Reset state
                    return;
                }
                bot.session[chatId].loginAlias = alias;
                bot.session[chatId].loginState = LOGIN_STATE.WAITING_FOR_USERNAME;
                await bot.sendMessage(chatId, `Alias '${alias}' found. Now, please enter your CRM username:`);
                break;

            case LOGIN_STATE.WAITING_FOR_USERNAME:
                const username = msg.text.trim();
                bot.session[chatId].loginUsername = username;
                bot.session[chatId].loginState = LOGIN_STATE.WAITING_FOR_PASSWORD;
                await bot.sendMessage(chatId, `Username '${username}' recorded. Please enter your CRM password:`);
                break;

            case LOGIN_STATE.WAITING_FOR_PASSWORD:
                const password = msg.text.trim();
                const loginAlias = bot.session[chatId].loginAlias;
                const loginUsername = bot.session[chatId].loginUsername;

                await bot.sendMessage(chatId, "Attempting to log in to CRM...");

                try {
                    const isAuthenticated = await crmManager.authenticateUser(loginAlias, loginUsername, password);
                    if (isAuthenticated) {
                        const crmDetails = getFrappeApiKeys(loginAlias); // Corrected: Call getFrappeApiKeys directly
                        if (crmDetails) {
                            await crmManager.addAuthenticatedCrm(chatId, loginAlias, crmDetails.url);
                            crmManager.setActiveCrmAlias(chatId, loginAlias);
                            await bot.sendMessage(chatId, `Successfully logged in to CRM '${loginAlias}'! It is now your active CRM.`);
                        } else {
                            await bot.sendMessage(chatId, `Login successful, but could not retrieve CRM details for '${loginAlias}'. Please contact admin.`);
                        }
                    } else {
                        await bot.sendMessage(chatId, "Authentication failed. Please check your username and password.");
                    }
                } catch (error) {
                    console.error("[LOGIN_FLOW] Authentication error:", error);
                    await bot.sendMessage(chatId, "An error occurred during authentication. Please try again later.");
                } finally {
                    // Clear sensitive info and reset state
                    delete bot.session[chatId].loginAlias;
                    delete bot.session[chatId].loginUsername;
                    // Password is not stored in session, so no need to delete
                    bot.session[chatId].loginState = LOGIN_STATE.NONE;
                }
                break;

            case LOGIN_STATE.NONE:
            default:
                // Do nothing, or handle other non-command messages if needed
                break;
        }
    });

    // === /createtask ===
    bot.onText(/\/createtask (\S+) (\S+)(?: (.*))?/s, async (msg, match) => {
        const chatId = msg.chat.id;
        const [, docName, taskTitle, taskDescription] = match; // Renamed leadName to docName for generality

        const activeCrm = await crmManager.getActiveCrmDetails(chatId);
        if (!activeCrm) {
            return bot.sendMessage(chatId, "No active CRM selected or authenticated. Use `/login` to set up your CRM.");
        }

        try {
            await axios.post(process.env.N8N_CREATE_TASK_WEBHOOK_URL, {
                chatId,
                crmBaseUrl: activeCrm.url,
                frappeApiKey: activeCrm.apiKey,
                frappeApiSecret: activeCrm.apiSecret,
                docName: docName.trim(), // Use docName
                taskTitle: taskTitle.trim(),
                taskDescription: taskDescription ? taskDescription.trim() : '',
                telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
            });
            await bot.sendMessage(chatId, `Task creation request sent for '${docName.trim()}'.`);
        } catch (error) {
            console.error("[CREATE_TASK] ERROR:", error.response?.data || error.message);
            await bot.sendMessage(chatId, "Failed to create task. Please check n8n webhook URL and CRM details.");
        }
    });

    // === /createnote ===
    bot.onText(/\/createnote (\S+) "([^"]+)"(?: (.*))?/s, async (msg, match) => {
        const chatId = msg.chat.id;
        const [, docName, noteTitle, noteContent] = match;

        const activeCrm = await crmManager.getActiveCrmDetails(chatId);
        if (!activeCrm) {
            return bot.sendMessage(chatId, "No active CRM selected or authenticated. Use `/login` to set up your CRM.");
        }

        try {
            await axios.post(process.env.N8N_CREATE_NOTE_WEBHOOK_URL, {
                chatId,
                crmBaseUrl: activeCrm.url,
                frappeApiKey: activeCrm.apiKey,
                frappeApiSecret: activeCrm.apiSecret,
                docName: docName.trim(),
                noteTitle: noteTitle.trim(),
                noteContent: noteContent ? noteContent.trim() : '',
                telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
            });
            await bot.sendMessage(chatId, `Note creation request sent for '${docName.trim()}'.`);
        } catch (error) {
            console.error("[CREATE_NOTE] ERROR:", error.response?.data || error.message);
            await bot.sendMessage(chatId, "Failed to create note. Please check n8n webhook URL and CRM details.");
        }
    });

    // === /convertlead ===
    bot.onText(/\/convertlead (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const leadName = match[1].trim();

        const activeCrm = await crmManager.getActiveCrmDetails(chatId);
        if (!activeCrm) {
            return bot.sendMessage(chatId, "No active CRM selected or authenticated. Use `/login` to set up your CRM.");
        }

        try {
            await bot.sendMessage(chatId, `Attempting to convert lead '${leadName}' to deal...`);
            await axios.post(process.env.N8N_CONVERT_LEAD_WEBHOOK_URL, {
                chatId,
                crmBaseUrl: activeCrm.url,
                frappeApiKey: activeCrm.apiKey,
                frappeApiSecret: activeCrm.apiSecret,
                leadName: leadName,
                telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
            });
        } catch (error) {
            console.error("[CONVERT_LEAD] ERROR:", error.response?.data || error.message);
            await bot.sendMessage(chatId, "Failed to convert lead. Please check n8n webhook URL and CRM details.");
        }
    });

    // === /searchleads ===
    bot.onText(/\/searchleads (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const input = match[1].trim();

        bot.session[chatId] = bot.session[chatId] || {};
        bot.session[chatId].search = bot.session[chatId].search || {
            query: "",
            page: 1,
            filters: {},
            doctype: "Lead" // Set doctype for search
        };
        bot.session[chatId].search.page = 1;

        await runSearch(chatId, input, "CRM Lead"); // Pass doctype
    });

    // === /searchdeals ===
    bot.onText(/\/searchdeals (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const input = match[1].trim();

        bot.session[chatId] = bot.session[chatId] || {};
        bot.session[chatId].search = bot.session[chatId].search || {
            query: "",
            page: 1,
            filters: {},
            doctype: "Deal" // Set doctype for search
        };
        bot.session[chatId].search.page = 1;

        await runSearch(chatId, input, "CRM Deal"); // Pass doctype
    });
}

// === runSearch() FUNCTION ===
// Modified to accept a doctype argument
async function runSearch(chatId, input, doctype) {
    const activeCrm = await crmManager.getActiveCrmDetails(chatId);
    if (!activeCrm) {
        return bot.sendMessage(chatId, "No active CRM selected or authenticated. Use `/login` to set up your CRM.");
    }

    const crmBaseUrl = activeCrm.url;
    const frappeApiKey = activeCrm.apiKey;
    const frappeApiSecret = activeCrm.apiSecret;

    // === ONLY UPDATE query/filters if input is provided (from /search) ===
    if (input) {
        let query = input;
        let filters = {};

        if (input.includes("filter:")) {
            const parts = input.split("filter:");
            query = parts[0].trim();
            const filterStr = parts[1].trim();
            filterStr.split(",").forEach((pair) => {
                const [k, v] = pair.split(":").map((s) => s.trim());
                if (k && v) filters[k] = v;
            });
        }

        // Only update session if new search
        bot.session[chatId].search.query = query;
        bot.session[chatId].search.filters = filters;
        bot.session[chatId].search.page = 1;
        bot.session[chatId].search.doctype = doctype; // Store doctype in session
    }

    // === Use stored query/filters/page ===
    const query = bot.session[chatId].search.query || "";
    const filters = bot.session[chatId].search.filters || {};
    const page = bot.session[chatId].search.page || 1;
    const currentDoctype = bot.session[chatId].search.doctype || doctype; // Use doctype from session or passed argument
    const start = (page - 1) * 5;

    if (!query) {
        return bot.sendMessage(chatId, `Use \`/search${currentDoctype === "CRM Lead" ? "leads" : "deals"} <term>\` first.`);
    }

    try {
        let fieldsToFetch = [
            "name",
            "organization",
            "status",
            "owner",
            "modified"
        ];

        if (currentDoctype === "CRM Lead") {
            fieldsToFetch.push("first_name", "last_name");
        } else if (currentDoctype === "CRM Deal") {
            fieldsToFetch.push("name");
        }

        console.log(`[SEARCH] Doctype: ${currentDoctype}, Query: ${query}, Filters: ${JSON.stringify(filters)}, Page: ${page}`);

        const filtersArray = [["organization", "like", `%${query}%`]];
        if (filters.owner) filtersArray.push(["owner", "=", filters.owner]);
        if (filters.status) filtersArray.push(["status", "=", filters.status]);

        const orgRes = await axios.get(`${crmBaseUrl}/api/resource/${currentDoctype}`, {
            params: {
                filters: JSON.stringify(filtersArray),
                fields: JSON.stringify(fieldsToFetch),
                limit_page_length: 5,
                limit_start: start,
            },
            headers: {
                Authorization: `token ${frappeApiKey}:${frappeApiSecret}`,
            },
        });

        // For deals, search by deal_name. For leads, keep organizational search.
        const nameSearchField = currentDoctype === "CRM Deal" ? "name" : "first_name";
        const nameRes = await axios.get(`${crmBaseUrl}/api/resource/${currentDoctype}`, {
            params: {
                filters: JSON.stringify([[nameSearchField, "like", `%${query}%`]]),
                fields: JSON.stringify(fieldsToFetch),
                limit_page_length: 5,
                limit_start: start,
            },
            headers: {
                Authorization: `token ${frappeApiKey}:${frappeApiSecret}`,
            },
        });

        const seen = new Set();
        const combined = [...(orgRes.data.data || []), ...(nameRes.data.data || [])]
            .filter((l) => {
                if (seen.has(l.name)) return false;
                seen.add(l.name);
                return true;
            })
            .slice(0, 5);

        if (!combined.length) {
            return bot.sendMessage(chatId, `No ${currentDoctype.toLowerCase()}s found for "${query}"`);
        }

        const lines = combined
            .map((item, i) => {
                const primaryName = currentDoctype === "CRM Deal" ? item.name : ([item.first_name, item.last_name].filter(Boolean).join(" ")) || "—";
                return `*[${i + 1 + start}] ${item.name}* | ${item.organization || "—"} — ${primaryName} | ${item.status || "—"} | Owner: ${item.owner || "—"} | ${item.modified.split(" ")[0]}`;
            })
            .join("\n\n");

        const keyboard = combined.map((_, i) => [
            {
                text: `${i + 1 + start}`,
                callback_data: `select_${currentDoctype === "CRM Lead" ? "lead" : "deal"}:${combined[i].name}`,
            },
        ]);
        const nav = [];
        if (page > 1) nav.push({ text: "Previous", callback_data: `prev_${currentDoctype === "CRM Lead" ? "lead" : "deal"}` });
        if (combined.length === 5)
            nav.push({ text: "More", callback_data: `more_${currentDoctype === "CRM Lead" ? "lead" : "deal"}` });
        nav.push({ text: "Filter", callback_data: `filter_${currentDoctype === "CRM Lead" ? "lead" : "deal"}` });
        nav.push({ text: "Create new", callback_data: `creat_${currentDoctype === "CRM Lead" ? "lead" : "deal"}` });
        keyboard.push(nav);

        await bot.sendMessage(
            chatId,
            `Page ${page} | Found ${combined.length} ${currentDoctype.toLowerCase()}s:\n\n${lines}`,
            {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: keyboard },
            }
        );
    } catch (err) {
        console.error(`[SEARCH] ${currentDoctype} ERROR:`, err.response?.data || err.message);
        bot.sendMessage(chatId, `${currentDoctype} search failed. Check CRM URL or API key.`);
    }
}

module.exports = { setupCommands, runSearch };