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
*Frappe Lead Bot Help*
- Send *voice message* to create lead
- Use */setcrm <URL>* to set CRM
- Reply *confirm* to save lead
- Mandatory: *first_name*
  `, { parse_mode: 'Markdown' });
});

// === CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action === 'creat_lead') {
    await bot.sendMessage(chatId, 'Send a *voice message* with lead details.\nSet CRM with */setcrm <URL>* first.', { parse_mode: 'Markdown' });
  } else if (action === 'update_lead') {
    await bot.sendMessage(chatId, 'Coming soon...');
  }

  bot.answerCallbackQuery(query.id);
});

// === /setcrm ===
bot.onText(/\/setcrm (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const crmUrl = match[1].trim();
  bot.session = bot.session || {};
  bot.session[chatId] = bot.session[chatId] || {};
  bot.session[chatId].crmBaseUrl = crmUrl;
  bot.sendMessage(chatId, `CRM set to: \`${crmUrl}\``, { parse_mode: 'Markdown' });
});

// === VOICE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  try {
    await bot.sendMessage(chatId, 'Processing voice...');

    const file = await bot.getFile(fileId);
    if (!file?.file_path) throw new Error('No file path');

    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    if (!crmBaseUrl) {
      await bot.sendMessage(chatId, 'Set CRM first: */setcrm <URL>*', { parse_mode: 'Markdown' });
      return;
    }

    await axios.post('https://seyaa.app.n8n.cloud/webhook/VOICE_LEAD_TRIGGER', {
      fileUrl,
      chatId,
      crmBaseUrl
    });

    await bot.sendMessage(chatId, 'Voice sent! n8n is analyzing...');
  } catch (err) {
    console.error('Voice error:', err.message);
    await bot.sendMessage(chatId, 'Error. Try again.');
  }
});

// === CONFIRM REPLY HANDLER ===
bot.on('message', async (msg) => {
  if (!msg.reply_to_message?.text) return;

  const replyText = msg.reply_to_message.text;
  const draftIdMatch = replyText.match(/draftId: `([^`]+)`/);
  if (!draftIdMatch) return;

  const draftId = draftIdMatch[1];
  const chatId = msg.chat.id;
  const text = msg.text?.trim().toLowerCase();

  if (text === 'confirm') {
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    try {
      await bot.sendMessage(chatId, 'Creating lead...');
      await axios.post('https://seyaa.app.n8n.cloud/webhook-test/CONFIRM_LEAD', {
        draftId,
        chatId,
        crmBaseUrl
      });
      await bot.sendMessage(chatId, 'Lead created!');
    } catch (err) {
      await bot.sendMessage(chatId, 'Error. Try again.');
    }
  }
});

// === ERROR HANDLING ===
bot.on('error', (e) => console.error('Bot error:', e));
bot.on('polling_error', (e) => console.error('Polling error:', e));

// === START SERVER ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook: ${webhookUrl}`);
});