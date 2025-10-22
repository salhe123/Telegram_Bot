require('dotenv').config();
import express, { json } from 'express';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

app.use(json());

// Set Telegram webhook
bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook`);

// Webhook route for Telegram
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Handle /start command
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

// Handle voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;
  try {
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    bot.sendMessage(chatId, `Received voice message. File URL: ${fileUrl}`);
    // TODO: Send fileUrl to n8n for Whisper transcription
  } catch (error) {
    bot.sendMessage(chatId, 'Error processing voice message.');
    console.error(error);
  }
});

// Handle button callbacks
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  bot.sendMessage(chatId, `Selected: ${action}`);
  // TODO: Implement button-guided flow for lead creation/update
  bot.answerCallbackQuery(query.id);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});