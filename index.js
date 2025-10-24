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
const webhookUrl = process.env.WEBHOOK_URL;
console.log('Setting webhook to:', webhookUrl);
bot.setWebHook(webhookUrl)
  .then(() => console.log('Webhook set successfully'))
  .catch(err => console.error('Webhook set failed:', err));

// === WEBHOOK ROUTE (Telegram → Bot) ===
app.post('/webhook-test/telegram-lead-webhook', (req, res) => {
  if (!req.body || !req.body.update_id) {
    console.log('Invalid webhook data');
    return res.sendStatus(200);
  }
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === ROOT ROUTE ===
app.get('/', (req, res) => {
  res.send('Telegram Bot is running! Webhook: /webhook-test/telegram-lead-webhook');
});

// === /start COMMAND ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to Frappe Lead Bot! Choose an action:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Create Lead', callback_data: 'create_lead' }],
        [{ text: 'Update Lead', callback_data: 'update_lead' }]
      ]
    }
  });
});

// === BUTTON CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  if (action === 'create_lead') {
    await bot.sendMessage(chatId, 'Please send a *voice message* with the lead details (name, email, phone, etc.) and specify CRM URL (e.g., /setcrm https://client-crm.fr8labs.co)', { parse_mode: 'Markdown' });
  } else if (action === 'update_lead') {
    await bot.sendMessage(chatId, 'Update Lead feature coming soon...');
  } else {
    await bot.sendMessage(chatId, `You selected: ${action}`);
  }

  bot.answerCallbackQuery(query.id);
});

// === CRM URL SET COMMAND ===
bot.onText(/\/setcrm (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const crmUrl = match[1];
  bot.sendMessage(chatId, `CRM URL set to: ${crmUrl}`);
  bot.session = bot.session || {};
  bot.session[chatId] = { crmBaseUrl: crmUrl };
});

// === VOICE MESSAGE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  try {
    await bot.sendMessage(chatId, 'Processing your voice message...');

    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    // SEND TO N8N WORKFLOW (MUST MATCH n8n Webhook Node Path!)
    await axios.post('https://salheseid.app.n8n.cloud/webhook/VOICE_LEAD_TRIGGER', {
      fileUrl,
      chatId,
      crmBaseUrl
    });

    console.log('Sent to n8n:', fileUrl, 'CRM:', crmBaseUrl);
    await bot.sendMessage(chatId, 'Voice sent! n8n is processing...');
  } catch (error) {
    console.error('Voice error:', error.message);
    await bot.sendMessage(chatId, 'Error processing voice. Try again.');
  }
});

// === ERROR HANDLING ===
bot.on('error', (error) => console.error('Bot error:', error));
bot.on('polling_error', (error) => console.error('Polling error:', error));

// === START SERVER ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook URL: ${webhookUrl}`);
});