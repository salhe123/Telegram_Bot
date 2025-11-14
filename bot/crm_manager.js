const fs = require('fs').promises;
const path = require('path');
const bot = require("./telegram"); // Import bot to manage session

const CRM_CONFIGS_FILE = path.join(__dirname, '..', 'crm_configs.json');

async function loadCrmConfigs() {
  try {
    const data = await fs.readFile(CRM_CONFIGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File does not exist, return empty object
      return {};
    }
    console.error("[CRM_MANAGER] Error loading CRM configs:", error);
    return {};
  }
}

async function saveCrmConfigs(configs) {
  try {
    await fs.writeFile(CRM_CONFIGS_FILE, JSON.stringify(configs, null, 2), 'utf8');
  } catch (error) {
    console.error("[CRM_MANAGER] Error saving CRM configs:", error);
  }
}

async function addCrm(chatId, alias, url, apiKey, apiSecret) {
  const configs = await loadCrmConfigs();
  configs[chatId] = configs[chatId] || [];

  if (configs[chatId].some(crm => crm.alias === alias)) {
    throw new Error(`CRM with alias '${alias}' already exists.`);
  }

  configs[chatId].push({ alias, url, apiKey, apiSecret });
  await saveCrmConfigs(configs);
}

async function listCrms(chatId) {
  const configs = await loadCrmConfigs();
  return configs[chatId] || [];
}

async function getCrm(chatId, alias) {
  const configs = await loadCrmConfigs();
  const userCrms = configs[chatId] || [];
  return userCrms.find(crm => crm.alias === alias);
}

async function deleteCrm(chatId, alias) {
  const configs = await loadCrmConfigs();
  configs[chatId] = (configs[chatId] || []).filter(crm => crm.alias !== alias);
  await saveCrmConfigs(configs);
}

function setActiveCrm(chatId, alias) {
  bot.session[chatId] = bot.session[chatId] || {};
  bot.session[chatId].activeCrmAlias = alias;
}

function getActiveCrmAlias(chatId) {
  return bot.session[chatId]?.activeCrmAlias;
}

module.exports = {
  loadCrmConfigs,
  saveCrmConfigs,
  addCrm,
  listCrms,
  getCrm,
  deleteCrm,
  setActiveCrm,
  getActiveCrmAlias,
};