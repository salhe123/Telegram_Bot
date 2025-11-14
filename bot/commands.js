const axios = require("axios");
const bot = require("./telegram");

function setupCommands() {

    // === /start ===

    bot.onText(/\/start/, (msg) => {

        const chatId = msg.chat.id;

        console.log(`[COMMAND /start] chatId: ${chatId}`);

        bot.sendMessage(chatId, "Welcome to Frappe Lead Bot!", {

            reply_markup: {

                inline_keyboard: [

                    [{ text: "Create Lead", callback_data: "creat_lead" }],

                    [{ text: "Update Lead", callback_data: "update_lead" }],

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

*Frappe Lead Bot – Quick Help*



*1. Set your CRM*  

to \`/setcrm https://your-crm.fr8labs.co\`



*2. Create Lead*  

to Send voice to Confirm draft



*3. Search Lead*  

to Type: \`/search Acme\` to See top 5 results and select and update



*4. Search Tips*  

to Use org name, contact name, or lead ID



*5. Health Check*  

to \`/health\` or visit: \`${process.env.RENDER_EXTERNAL_URL || "https://your-bot.onrender.com"}/health\`



Need help? Just type /help!

  `,

            { parse_mode: "Markdown" }

        );

    });



    // === /setcrm ===

    bot.onText(/\/setcrm (.+)/, (msg, match) => {

        const chatId = msg.chat.id;

        const url = match[1].trim();

        bot.session[chatId] = bot.session[chatId] || {};

        bot.session[chatId].crmBaseUrl = url;

        console.log(`[COMMAND /setcrm] chatId: ${chatId} to CRM: ${url}`);

        bot.sendMessage(chatId, `CRM set to: \`${url}\``, { parse_mode: "Markdown" });

    });



    // === /search (uses runSearch) ===

    bot.onText(/\/search (.+)/, async (msg, match) => {

        const chatId = msg.chat.id;

        const input = match[1].trim();



        bot.session[chatId] = bot.session[chatId] || {};

        bot.session[chatId].search = bot.session[chatId].search || {

            query: "",

            page: 1,

            filters: {},

        };

        bot.session[chatId].search.page = 1; // ← ADD THIS



        await runSearch(chatId, input);

    });

}

// === runSearch() FUNCTION ===
async function runSearch(chatId, input) {
    const crmBaseUrl =
        bot.session[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;
    if (!crmBaseUrl)
        return bot.sendMessage(chatId, "Set CRM first: */setcrm <URL>*", {
            parse_mode: "Markdown",
        });

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
    }

    // === Use stored query/filters/page ===
    const query = bot.session[chatId].search.query || "";
    const filters = bot.session[chatId].search.filters || {};
    const page = bot.session[chatId].search.page || 1;
    const start = (page - 1) * 5;

    if (!query) {
        return bot.sendMessage(chatId, "Use `/search <term>` first.");
    }

    try {
        console.log("[SEARCH] Query:", query, "Filters:", filters, "Page:", page);

        const filtersArray = [["organization", "like", `%${query}%`]];
        if (filters.owner) filtersArray.push(["owner", "=", filters.owner]);
        if (filters.status) filtersArray.push(["status", "=", filters.status]);

        const orgRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
            params: {
                filters: JSON.stringify(filtersArray),
                fields: JSON.stringify([
                    "name",
                    "organization",
                    "first_name",
                    "last_name",
                    "status",
                    "owner",
                    "modified",
                ]),
                limit_page_length: 5,
                limit_start: start,
            },
            headers: {
                Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}`,
            },
        });

        const nameRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
            params: {
                filters: JSON.stringify([["first_name", "like", `%${query}%`]]),
                fields: JSON.stringify([
                    "name",
                    "organization",
                    "first_name",
                    "last_name",
                    "status",
                    "owner",
                    "modified",
                ]),
                limit_page_length: 5,
                limit_start: start,
            },
            headers: {
                Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}`,
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
            return bot.sendMessage(chatId, `No leads found for "${query}"`);
        }

        const lines = combined
            .map((l, i) => {
                const name =
                    [l.first_name, l.last_name].filter(Boolean).join(" ") || "—";
                return `*[${i + 1 + start}] ${l.name}* | ${l.organization || "—"} — ${name} | ${l.status || "—"} | Owner: ${l.owner || "—"} | ${l.modified.split(" ")[0]}`;
            })
            .join("\n\n");

        const keyboard = combined.map((_, i) => [
            {
                text: `${i + 1 + start}`,
                callback_data: `select_lead:${combined[i].name}`,
            },
        ]);
        const nav = [];
        if (page > 1) nav.push({ text: "Previous", callback_data: "prev" });
        if (combined.length === 5)
            nav.push({ text: "More", callback_data: "more" });
        nav.push({ text: "Filter", callback_data: "filter" });
        nav.push({ text: "Create new", callback_data: "creat_lead" });
        keyboard.push(nav);

        await bot.sendMessage(
            chatId,
            `Page ${page} | Found ${combined.length} leads:\n\n${lines}`,
            {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: keyboard },
            }
        );
    } catch (err) {
        console.error("[SEARCH] ERROR:", err.response?.data || err.message);
        bot.sendMessage(chatId, "Search failed. Check CRM URL or API key.");
    }
}

module.exports = { setupCommands, runSearch };
