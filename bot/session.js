const bot = require("./telegram");

function initializeSession() {
  bot.session = bot.session || {};
}

module.exports = initializeSession;
