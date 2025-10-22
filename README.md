Telegram CRM Bot
A Telegram bot for creating/updating leads in Frappe CRM using voice messages or buttons.
Setup

Add bot token to .env.
Run npm install to install dependencies.
Set WEBHOOK_URL after deploying (e.g., Heroku, Vercel).
Run npm run dev for development or npm start for production.
Set webhook: https://api.telegram.org/bot<token>/setWebhook?url=<your_url>/webhook.

Features

Handles /start command with buttons ("Create Lead", "Update Lead").
Processes voice messages (gets file URL for n8n transcription).
Webhook for Telegram integration.

Next Steps

Connect to n8n for Whisper transcription and Frappe CRM API integration.
