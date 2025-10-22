require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

console.log('🤖 Bot initialized with token:', process.env.TELEGRAM_BOT_TOKEN ? 'YES' : 'NO');

app.use(express.json());

// Set Telegram webhook
const webhookUrl = `${process.env.WEBHOOK_URL}/webhook`;
console.log('🔗 Setting webhook to:', webhookUrl);
bot.setWebHook(webhookUrl).then(() => {
  console.log('✅ Webhook set successfully');
}).catch(err => {
  console.error('❌ Webhook set failed:', err);
});

// Webhook route for Telegram
app.post('/webhook', (req, res) => {
  console.log('📨 Incoming webhook:', JSON.stringify(req.body, null, 2));
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  console.log('🌐 Root route accessed');
  res.send('Telegram Bot is running! Webhook: /webhook');
});

// Handle /start command
bot.onText(/\/start/, (msg) => {
  console.log('🚀 /start command from:', msg.from.username || msg.from.first_name);
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to Frappe Lead Bot! Choose an action:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Create Lead', callback_data: 'create_lead' }],
        [{ text: 'Update Lead', callback_data: 'update_lead' }]
      ]
    }
  }).then(() => {
    console.log('✅ /start message sent to:', chatId);
  }).catch(err => {
    console.error('❌ Failed to send /start:', err);
  });
});

// Handle voice messages
bot.on('voice', async (msg) => {
  console.log('🎤 Voice message received from:', msg.from.username || msg.from.first_name);
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;
  
  try {
    console.log('📥 Getting file info for:', fileId);
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    console.log('🔗 Voice file URL:', fileUrl);
    await bot.sendMessage(chatId, `Received voice message. File URL: ${fileUrl}`);
    console.log('✅ Voice message processed for:', chatId);
    
    // TODO: Send fileUrl to n8n for Whisper transcription
  } catch (error) {
    console.error('❌ Voice processing error:', error);
    await bot.sendMessage(chatId, 'Error processing voice message.');
  }
});

// Handle button callbacks
bot.on('callback_query', (query) => {
  console.log('🔘 Button clicked:', query.data, 'by:', query.from.username);
  const chatId = query.message.chat.id;
  const action = query.data;
  
  bot.sendMessage(chatId, `Selected: ${action}`).then(() => {
    console.log('✅ Button response sent for:', action);
  }).catch(err => {
    console.error('❌ Button response failed:', err);
  });
  
  bot.answerCallbackQuery(query.id).then(() => {
    console.log('✅ Callback query answered');
  }).catch(err => {
    console.error('❌ Callback answer failed:', err);
  });
});

// Error handler
bot.on('error', (error) => {
  console.error('🤖 Bot error:', error);
});

bot.on('polling_error', (error) => {
  console.error('🤖 Polling error:', error);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 Webhook URL: ${webhookUrl}`);
});