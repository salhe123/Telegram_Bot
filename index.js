require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// === LOG STARTUP ===
console.log('Bot initialized with token:', process.env.TELEGRAM_BOT_TOKEN ? 'YES' : 'NO');
console.log('Frappe CRM API:', process.env.FRAPPE_CRM_BASE_URL ? 'Configured' : 'Missing');

// === MIDDLEWARE ===
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf; } }));

// === SET WEBHOOK ===
const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || 'https://telegram-bot-8qcb.onrender.com'}/webhook`;
console.log('Setting webhook to:', webhookUrl);
bot.setWebHook(webhookUrl)
  .then(() => console.log('Webhook set successfully'))
  .catch(err => console.error('Webhook set failed:', err));

// === WEBHOOK ROUTE ===
app.post('/webhook', (req, res) => {
  if (!req.body || !req.body.update_id) return res.sendStatus(200);
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === ROOT ROUTE ===
app.get('/', (req, res) => res.send('Bot running'));

// === /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to Frappe Lead Bot!', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Create Lead', callback_data: 'creat_lead' }],
        [{ text: 'Update Lead', callback_data: 'update_lead' }]
      ]
    }
  });
});

// === /help ===
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
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

Need help? Just type /help!
  `, { parse_mode: 'Markdown' });
});

// === CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action === 'creat_lead') {
    await bot.sendMessage(chatId, 'Send a *voice message* with lead details.\nSet CRM with */setcrm <URL>* first.', { parse_mode: 'Markdown' });

  } else if (action === 'update_lead') {
    await bot.sendMessage(chatId, 'Type: `/updatelead Acme` or `/updatelead John`', { parse_mode: 'Markdown' });

  } else if (action.startsWith('confirm_draft:')) {
    const draftId = action.split(':')[1];
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;
    const draftMessage = query.message;

    if (!draftMessage?.text || !draftMessage.text.includes(`draftId: \`${draftId}\``)) {
      return bot.editMessageText('Draft not found.', { chat_id: chatId, message_id: query.message.message_id });
    }

    const lines = draftMessage.text.split('\n').filter(l => l.includes(':') && l.includes('*'));
    const leadData = {};
    lines.forEach(line => {
      const match = line.match(/• \*(.+?):\* (.+)/);
      if (match) {
        const key = match[1].trim().toLowerCase().replace(/ /g, '_');
        const value = match[2].trim();
        leadData[key] = value;
      }
    });

    try {
      await bot.editMessageText('Creating lead...', { chat_id: chatId, message_id: query.message.message_id });
      await axios.post(process.env.N8N_CONFIRM_WEBHOOK_URL, { draftId, chatId, crmBaseUrl, leadData: JSON.stringify(leadData) });
      await bot.editMessageText('Waiting for CRM...', { chat_id: chatId, message_id: query.message.message_id });
    } catch (err) {
      await bot.editMessageText('Error. Try again.', { chat_id: chatId, message_id: query.message.message_id });
    }

  } else if (action.startsWith('cancel_draft:')) {
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
  bot.sendMessage(chatId, `CRM set to: \`${url}\``, { parse_mode: 'Markdown' });
});

// === /updatelead SEARCH (2 API CALLS) ===
bot.onText(/\/updatelead (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1].trim();
  const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

  if (!crmBaseUrl) return bot.sendMessage(chatId, 'Set CRM first: */setcrm <URL>*', { parse_mode: 'Markdown' });

  console.log('SEARCH QUERY:', query);
  console.log('CRM URL:', crmBaseUrl);

  try {
    // CALL 1: org
    const orgRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
      params: {
        filters: JSON.stringify([["organization", "like", `%${query}%`]]),
        fields: JSON.stringify(["name", "organization", "first_name", "last_name", "status", "owner", "modified"]),
        limit_page_length: 5
      },
      headers: { 'Authorization': `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}` }
    });

    // CALL 2: first_name
    const nameRes = await axios.get(`${crmBaseUrl}/api/resource/CRM Lead`, {
      params: {
        filters: JSON.stringify([["first_name", "like", `%${query}%`]]),
        fields: JSON.stringify(["name", "organization", "first_name", "last_name", "status", "owner", "modified"]),
        limit_page_length: 5
      },
      headers: { 'Authorization': `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_SECRET_KEY}` }
    });

    // MERGE & DEDUPE
    const seen = new Set();
    const combined = [...orgRes.data.data, ...nameRes.data.data]
      .filter(l => {
        if (seen.has(l.name)) return false;
        seen.add(l.name);
        return true;
      })
      .slice(0, 5);

    console.log('COMBINED RESULTS:', combined);

    if (!combined.length) {
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

    await bot.sendMessage(chatId, `Found ${combined.length} leads:\n\n${lines}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (err) {
    console.error('SEARCH ERROR:', err.response?.data || err.message);
    bot.sendMessage(chatId, 'Search failed. Check CRM URL.');
  }
});

// === VOICE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  try {
    await bot.sendMessage(chatId, 'Processing voice...');
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    if (!crmBaseUrl) return bot.sendMessage(chatId, 'Set CRM: */setcrm <URL>*', { parse_mode: 'Markdown' });

    await axios.post(process.env.N8N_VOICE_WEBHOOK_URL, { fileUrl, chatId, crmBaseUrl });
    await bot.sendMessage(chatId, 'Voice sent! Analyzing...');
  } catch (err) {
    bot.sendMessage(chatId, 'Error. Try again.');
  }
});

// === SERVER ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook: ${webhookUrl}`);
});