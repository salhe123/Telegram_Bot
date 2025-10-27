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

// === WEBHOOK ROUTE (Telegram → Bot) ===
app.post('/webhook', (req, res) => {
  if (!req.body || !req.body.update_id) {
    console.log('Invalid webhook data');
    return res.sendStatus(200);
  }
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === ROOT ROUTE ===
app.get('/', (req, res) => {
  res.send('Telegram Bot is running! Webhook: /webhook');
});

// === /start COMMAND ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received /start from chatId: ${chatId}`);
  bot.sendMessage(chatId, 'Welcome to Frappe Lead Bot! Choose an action:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Create Lead', callback_data: 'create_lead' }],
        [{ text: 'Update Lead', callback_data: 'update_lead' }]
      ]
    }
  });
});

// === /help COMMAND ===
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received /help from chatId: ${chatId}`);
  bot.sendMessage(chatId, `
*Frappe Lead Bot Help*
- This bot helps you create and manage leads in your Frappe CRM.
- *Key Features*:
  - Create leads via voice messages (e.g., "My name is John, email john@email.com").
  - Set CRM URL with /setcrm <URL> (e.g., /setcrm https://client-crm.fr8labs.co).
  - Confirm lead data after review.
- *Important Notes*:
  - Mandatory field: *first_name* must be provided.
  - Use /setcrm before sending voice messages to link your CRM.
  - Reply 'confirm' or send edits after reviewing the draft.
- For support, contact the admin or check the n8n workflow logs.
  `, { parse_mode: 'Markdown' });
});

// === BUTTON CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  console.log(`Callback from ${chatId}: ${action}`);

  if (action === 'create_lead') {
    await bot.sendMessage(chatId, 'Please send a *voice message* with lead details and specify CRM URL (e.g., /setcrm https://client-crm.fr8labs.co)', { parse_mode: 'Markdown' });
  } else if (action === 'update_lead') {
    await bot.sendMessage(chatId, 'Update Lead feature coming soon...');
  }

  bot.answerCallbackQuery(query.id);
});

// === CRM URL SET COMMAND ===
bot.onText(/\/setcrm (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const crmUrl = match[1];
  console.log(`Set CRM URL for ${chatId} to: ${crmUrl}`);
  bot.session = bot.session || {};
  bot.session[chatId] = bot.session[chatId] || {};
  bot.session[chatId].crmBaseUrl = crmUrl;
  bot.sendMessage(chatId, `CRM URL set to: ${crmUrl}`);
});

// === VOICE MESSAGE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;
  console.log(`Voice message from ${chatId}, fileId: ${fileId}`);

  try {
    await bot.sendMessage(chatId, 'Processing your voice message...');

    const file = await bot.getFile(fileId);
    if (!file || !file.file_path) throw new Error('Failed to get file path');
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    if (!crmBaseUrl) {
      await bot.sendMessage(chatId, 'Please set CRM URL first with /setcrm <URL>');
      return;
    }

    // === SEND TO n8n ===
    await axios.post('https://seyaa.app.n8n.cloud/webhook-test/VOICE_LEAD_TRIGGER', {
      fileUrl,
      chatId,
      crmBaseUrl
    });

    // === SAVE draftId IN SESSION ===
    const tempDraftId = `${chatId}-${Date.now()}`;
    bot.session[chatId].draftId = tempDraftId;
    console.log(`Draft ID saved: ${tempDraftId}`);

    await bot.sendMessage(chatId, 'Voice sent! n8n is processing...');
  } catch (error) {
    console.error(`Voice error for ${chatId}:`, error.message);
    await bot.sendMessage(chatId, 'Error processing voice. Try again.');
  }
});

// === CONFIRM TEXT HANDLER ===
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim().toLowerCase();

  if (text === 'confirm') {
    const session = bot.session?.[chatId];
    if (!session?.draftId) {
      await bot.sendMessage(chatId, 'No draft found. Send a new voice message.');
      return;
    }

    const { draftId, crmBaseUrl } = session;

    try {
      await axios.post('https://seyaa.app.n8n.cloud/webhook/CONFIRM_LEAD', {
        draftId,
        chatId,
        crmBaseUrl
      });

      await bot.sendMessage(chatId, 'Lead confirmed! Creating in CRM...');
      console.log(`Confirm sent: draftId=${draftId}`);
    } catch (err) {
      console.error('Confirm error:', err.message);
      await bot.sendMessage(chatId, 'Error confirming. Try again.');
    }
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