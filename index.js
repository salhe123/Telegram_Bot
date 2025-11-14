require("dotenv").config();
const express = require("express");

const setupMiddlewares = require("./bot/middlewares");
const setupWebhooks = require("./bot/webhooks");
const setupRoutes = require("./bot/routes");
const initializeSession = require("./bot/session");
const { setupCommands } = require("./bot/commands");
const setupCallbacks = require("./bot/callbacks");
const setupVoiceHandler = require("./bot/voice");

const app = express();

setupMiddlewares(app);
setupWebhooks(app);
setupRoutes(app);

initializeSession();
setupCommands();
setupCallbacks();
setupVoiceHandler();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[SERVER] Running on port ${port}`);
});
