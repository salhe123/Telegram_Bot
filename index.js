require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// === MIDDLEWARE ===
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf; } }));

// === SET WEBHOOK ===
const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || 'https://telegram-bot-8qcb.onrender.com'}/webhook`;
console.log('[WEBHOOK] Setting to:', webhookUrl);
bot.setWebHook(webhookUrl)
  .then(() => console.log('[WEBHOOK] SUCCESS: Webhook set'))
  .catch(err => console.error('[WEBHOOK] FAILED:', err.message));

// === WEBHOOK ROUTE ===
app.post('/webhook', (req, res) => {
  if (!req.body || !req.body.update_id) {
    console.log('[WEBHOOK] IGNORED: No update_id');
    return res.sendStatus(200);
  }
  console.log('[WEBHOOK] RECEIVED update_id:', req.body.update_id);
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    timezone: 'EAT (UTC+3)',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: {
      token: !!process.env.TELEGRAM_BOT_TOKEN,
      crm: !!process.env.FRAPPE_CRM_BASE_URL,
      n8n_voice: !!process.env.N8N_VOICE_WEBHOOK_URL,
      n8n_update: !!process.env.N8N_UPDATE_WEBHOOK_URL,
      n8n_confirm: !!process.env.N8N_CONFIRM_WEBHOOK_URL
    }
  };
  console.log('[HEALTH] GET /health → 200');
  res.json(health);
});

// === ROOT ROUTE ===
app.get('/', (req, res) => {
  console.log('[ROOT] GET / → 200');
  res.send('Frappe Lead Bot is running');
});

// === /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`[COMMAND /start] chatId: ${chatId}`);
  bot.sendMessage(chatId, 'Welcome to Frappe Lead Bot!', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Create Lead', callback_data: 'creat_lead' }],
        [{ text: 'Update Lead', callback_data: 'update_lead' }]
      ]
    }
  });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`[COMMAND /help] chatId: ${chatId}`);
  bot.sendMessage(chatId, `
*Frappe Lead Bot – Quick Help*

*1. Set your CRM*  
→ \`/setcrm https://your-crm.fr8labs.co\`

*2. Create Lead*  
→ Send voice → Confirm draft

*3. Update Lead*  
→ Type: \`/updatelead Acme\` → See top 5 results

*4. Search Tips*  
→ Use org name, contact name, or lead ID

*5. Health Check*  
→ \`/health\` or visit: \`${process.env.RENDER_EXTERNAL_URL || 'https://your-bot.onrender.com'}/health\`

Need help? Just type /help!
  `, { parse_mode: 'Markdown' });
});

// === CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  console.log(`[CALLBACK] chatId: ${chatId} | action: ${action}`);

  if (action === 'creat_lead') {
    console.log(`[CALLBACK] creat_lead → prompt voice`);
    await bot.sendMessage(chatId, 'Send a *voice message* with lead details.\nSet CRM with */setcrm <URL>* first.', { parse_mode: 'Markdown' });

  } else if (action === 'update_lead') {
    console.log(`[CALLBACK] update_lead → prompt /updatelead`);
    await bot.sendMessage(chatId, 'Type: `/updatelead Acme` or `/updatelead John`', { parse_mode: 'Markdown' });

  } else if (action.startsWith('select_lead:')) {
    const leadName = action.split(':')[1];
    bot.session = bot.session || {};
    bot.session[chatId] = bot.session[chatId] || {};
    bot.session[chatId].selectedLead = leadName;
    console.log(`[CALLBACK] select_lead → saved: ${leadName}`);
    await bot.sendMessage(chatId, `Selected: *${leadName}*\n\nSend *voice* to update.`, { parse_mode: 'Markdown' });

  } 
     else if (action.startsWith('confirm_draft:')) {
    const draftId = action.split(':')[1];
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    console.log(`[CALLBACK] confirm_draft → draftId: ${draftId}`);

    try {
      await bot.editMessageText('Creating lead...', { chat_id: chatId, message_id: query.message.message_id });

      // Get leadData from n8n (sent as draftData in message)
      const leadData = query.message.draftData ? JSON.parse(query.message.draftData) : {};

      await axios.post(process.env.N8N_CONFIRM_WEBHOOK_URL, {
        draftId,
        chatId,
        crmBaseUrl,
        leadData: JSON.stringify(leadData)
      });

      await bot.editMessageText('Waiting for CRM...', { chat_id: chatId, message_id: query.message.message_id });
    } catch (err) {
      console.error('[CALLBACK] ERROR:', err.message);
      await bot.editMessageText('Error. Try again.', { chat_id: chatId, message_id: query.message.message_id });
    }

  } else if (action.startsWith('cancel_draft:')) {
    console.log('[CALLBACK] cancel_draft → user cancelled');
    await bot.editMessageText('Cancelled.', { chat_id: chatId, message_id: query.message.message_id });
  }

  bot.answerCallbackQuery(query.id);
});

// === /setcrm ===
bot.onText(/\/setcrm (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();
  bot.session = bot.session || {};
  bot.session[chatId] = bot.session[chatId] || {};
  bot.session[chatId].crmBaseUrl = url;
  console.log(`[COMMAND /setcrm] chatId: ${chatId} → CRM: ${url}`);
  bot.sendMessage(chatId, `CRM set to: \`${url}\``, { parse_mode: 'Markdown' });
});

// === /updatelead SEARCH ===
bot.onText(/\/updatelead (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1].trim();
  const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

  console.log(`[COMMAND /updatelead] chatId: ${chatId} | query: "${query}" | crm: ${crmBaseUrl}`);

  if (!crmBaseUrl) {
    console.log('[ERROR] /updatelead → CRM not set');
    return bot.sendMessage(chatId, 'Set CRM first: */setcrm <URL>*', { parse_mode: 'Markdown' });
  }

  try {
    console.log('[SEARCH] Calling Frappe API (org + name)...');
    const orgRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
      params: {
        filters: JSON.stringify([["organization", "like", `%${query}%`]]),
        fields: JSON.stringify(["name", "organization", "first_name", "last_name", "status", "owner", "modified"]),
        limit_page_length: 5
      },
      headers: { 'Authorization': `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}` }
    });

    const nameRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
      params: {
        filters: JSON.stringify([["first_name", "like", `%${query}%`]]),
        fields: JSON.stringify(["name", "organization", "first_name", "last_name", "status", "owner", "modified"]),
        limit_page_length: 5
      },
      headers: { 'Authorization': `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}` }
    });

    const seen = new Set();
    const combined = [...orgRes.data.data, ...nameRes.data.data]
      .filter(l => {
        if (seen.has(l.name)) return false;
        seen.add(l.name);
        return true;
      })
      .slice(0, 5);

    console.log('[SEARCH] Found leads:', combined.map(l => l.name).join(', ') || 'none');

    if (!combined.length) {
      console.log('[SEARCH] No results');
      return bot.sendMessage(chatId, `No leads found for "${query}"`);
    }

    const lines = combined.map((l, i) => {
      const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || '—';
      return `*[${i+1}] ${l.name}* | ${l.organization || '—'} — ${name} | ${l.status || '—'} | Owner: ${l.owner || '—'} | ${l.modified.split(' ')[0]}`;
    }).join('\n\n');

    const keyboard = combined.map((_, i) => [{ text: `${i+1}`, callback_data: `select_lead:${combined[i].name}` }]);
    keyboard.push([
      { text: 'More', callback_data: 'more' },
      { text: 'Filter', callback_data: 'filter' },
      { text: 'Create new', callback_data: 'creat_lead' }
    ]);

    console.log('[SEARCH] Sending results to user');
    await bot.sendMessage(chatId, `Found ${combined.length} leads:\n\n${lines}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (err) {
    console.error('[SEARCH] ERROR:', err.response?.data || err.message);
    bot.sendMessage(chatId, 'Search failed. Check CRM URL.');
  }
});

// === VOICE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  console.log(`[VOICE] Received | chatId: ${chatId} | fileId: ${fileId}`);

  // INIT SESSION
  bot.session = bot.session || {};
  bot.session[chatId] = bot.session[chatId] || {};

  try {
    await bot.sendMessage(chatId, 'Processing voice...');
    console.log('[VOICE] Getting file link...');
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    console.log('[VOICE] File URL:', fileUrl);

    const crmBaseUrl = bot.session[chatId].crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;
    if (!crmBaseUrl) {
      console.log('[VOICE] CRM not set');
      return bot.sendMessage(chatId, 'Set CRM: */setcrm <URL>*', { parse_mode: 'Markdown' });
    }

    const payload = { fileUrl, chatId, crmBaseUrl };
    const isUpdate = !!bot.session[chatId].selectedLead;

    if (isUpdate) {
      payload.leadName = bot.session[chatId].selectedLead;
      payload.isUpdate = true;
      delete bot.session[chatId].selectedLead;
      console.log(`[VOICE] UPDATE MODE → leadName: ${payload.leadName}`);
    } else {
      console.log('[VOICE] CREATE MODE → no selected lead');
    }

    const webhookUrl = isUpdate ? process.env.N8N_VOICE_WEBHOOK_URL : process.env.N8N_VOICE_WEBHOOK_URL;
    console.log(`[VOICE] POST to n8n → ${webhookUrl}`);
    console.log('[VOICE] Payload:', JSON.stringify(payload, null, 2));

    await axios.post(webhookUrl, payload);
    console.log('[VOICE] SUCCESS: sent to n8n');

    await bot.sendMessage(chatId, isUpdate ? 'Updating lead...' : 'Analyzing...');
  } catch (err) {
    console.error('[VOICE] ERROR:', err.message);
    bot.sendMessage(chatId, 'Error. Try again.');
  }
});

// === SERVER ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[SERVER] Running on port ${port}`);
  console.log(`[SERVER] Health: http://localhost:${port}/health`);
  console.log(`[SERVER] Webhook: ${webhookUrl}`);
});