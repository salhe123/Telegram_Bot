require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// === LOG STARTUP ===
console.log('Bot initialized with token:', process.env.TELEGRAM_BOT_TOKEN ? 'YES' : 'NO');
console.log('Frapps CRM API:', process.env.FRAPPE_CRM_BASE_URL ? 'Configured' : 'Missing');

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
  if (!req.body || !req.body.update_id) {
    console.log('Invalid webhook payload received');
    return res.sendStatus(200);
  }
  console.log('Webhook update received:', req.body.update_id);
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === ROOT ROUTE ===
app.get('/', (req, res) => {
  console.log('Health check: /');
  res.send('Bot running');
});

// === /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`/start from chatId: ${chatId}`);
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
  console.log(`/help from chatId: ${chatId}`);
  bot.sendMessage(chatId, `
*Frappe Lead Bot Help*
- Send *voice message* to create lead
- Use */setcrm <URL>* to set CRM
- Tap *Confirm* or *Cancel* on draft
  `, { parse_mode: 'Markdown' });
});

// === CALLBACKS ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  console.log(`Callback from ${chatId}: ${action}`);

  if (action === 'creat_lead') {
    console.log(`User ${chatId} clicked Create Lead`);
    await bot.sendMessage(chatId, 'Send a *voice message* with lead details.\nSet CRM with */setcrm <URL>* first.', { parse_mode: 'Markdown' });

  } else if (action === 'update_lead') {
    console.log(`User ${chatId} clicked Update Lead (coming soon)`);
    await bot.sendMessage(chatId, 'Coming soon...');

  } else if (action.startsWith('confirm_draft:')) {
    const draftId = action.split(':')[1];
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    // FIND DRAFT MESSAGE IN CHAT
    let draftMessage;
    try {
      const history = await bot.getChatHistory(chatId, 0, 20);
      draftMessage = history.find(m => 
        m.text && m.text.includes(`draftId: \`${draftId}\``)
      );
    } catch (err) {
      console.error('Failed to get chat history:', err.message);
    }

    if (!draftMessage) {
      await bot.editMessageText('Draft not found. Try again.', {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      return;
    }

    // PARSE leadData FROM TEXT
    const text = draftMessage.text;
    const lines = text.split('\n').filter(l => l.includes(':'));
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
      await bot.editMessageText('Creating lead in CRM...', {
        chat_id: chatId,
        message_id: query.message.message_id
      });

      console.log(`Confirm: draftId=${draftId}, chatId=${chatId}`);
      await axios.post('https://seyaa.app.n8n.cloud/webhook-test/CONFIRM_LEAD', {
        draftId,
        chatId,
        crmBaseUrl,
        leadData: JSON.stringify(leadData)
      });

      await bot.editMessageText('Lead created successfully!', {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    } catch (err) {
      console.error('Confirm error:', err.message);
      await bot.editMessageText('Error creating lead. Try again.', {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    }

  } else if (action.startsWith('cancel_draft:')) {
    const draftId = action.split(':')[1];
    console.log(`Cancel button: draftId=${draftId}, chatId=${chatId}`);
    await bot.editMessageText('Lead draft cancelled.', {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }

  bot.answerCallbackQuery(query.id);
});

// === /setcrm ===
bot.onText(/\/setcrm (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const crmUrl = match[1].trim();
  console.log(`Set CRM URL for ${chatId}: ${crmUrl}`);
  bot.session = bot.session || {};
  bot.session[chatId] = bot.session[chatId] || {};
  bot.session[chatId].crmBaseUrl = crmUrl;
  bot.sendMessage(chatId, `CRM set to: \`${crmUrl}\``, { parse_mode: 'Markdown' });
});

// === VOICE HANDLER ===
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;
  console.log(`Voice message from ${chatId}, fileId: ${fileId}`);

  try {
    await bot.sendMessage(chatId, 'Processing voice...');

    const file = await bot.getFile(fileId);
    if (!file?.file_path) throw new Error('No file path');

    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const crmBaseUrl = bot.session?.[chatId]?.crmBaseUrl || process.env.FRAPPE_CRM_BASE_URL;

    if (!crmBaseUrl) {
      console.log(`CRM URL missing for ${chatId}`);
      await bot.sendMessage(chatId, 'Set CRM first: */setcrm <URL>*', { parse_mode: 'Markdown' });
      return;
    }

    console.log(`Sending voice to n8n: chatId=${chatId}, crmBaseUrl=${crmBaseUrl}`);
    await axios.post('https://seyaa.app.n8n.cloud/webhook-test/VOICE_LEAD_TRIGGER', {
      fileUrl,
      chatId,
      crmBaseUrl
    });

    console.log(`Voice sent to n8n successfully for ${chatId}`);
    await bot.sendMessage(chatId, 'Voice sent! n8n is analyzing...');
  } catch (err) {
    console.error('Voice error:', err.message);
    await bot.sendMessage(chatId, 'Error. Try again.');
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