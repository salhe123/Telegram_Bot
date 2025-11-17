const bot = require("./telegram"); // Import bot to manage session
const axios = require("axios"); // Import axios for API calls
const { getFrappeApiKeys, listAvailableCrmAliases } = require("../config/crmApiKeys");

// This object will store user-specific CRM configurations in memory for the current session.
// In a production environment, this would be persisted in a database.
const userCrmSessions = {}; // { chatId: { activeCrmAlias: 'alias', crms: { 'alias': { url: '...', isAuthenticated: true } } } }

function initializeUserCrmSession(chatId) {
    if (!userCrmSessions[chatId]) {
        userCrmSessions[chatId] = {
            activeCrmAlias: null,
            crms: {}, // Stores authenticated CRM instances for the user
        };
    }
}

async function getCrmConfig(chatId, alias) {
    initializeUserCrmSession(chatId);
    const userSession = userCrmSessions[chatId];
    return userSession.crms[alias];
}

async function addAuthenticatedCrm(chatId, alias, url) {
    initializeUserCrmSession(chatId);
    userCrmSessions[chatId].crms[alias] = { url, isAuthenticated: true };
    // Automatically set as active if it's the first one or explicitly set
    if (!userCrmSessions[chatId].activeCrmAlias) {
        userCrmSessions[chatId].activeCrmAlias = alias;
    }
}

function setActiveCrmAlias(chatId, alias) {
    initializeUserCrmSession(chatId);
    if (userCrmSessions[chatId].crms[alias]) {
        userCrmSessions[chatId].activeCrmAlias = alias;
        return true;
    }
    return false;
}

function getActiveCrmAlias(chatId) {
    initializeUserCrmSession(chatId);
    return userCrmSessions[chatId].activeCrmAlias;
}

async function getActiveCrmDetails(chatId) {
    initializeUserCrmSession(chatId);
    const activeAlias = userCrmSessions[chatId].activeCrmAlias;
    if (!activeAlias) {
        return null;
    }
    const crmConfig = userCrmSessions[chatId].crms[activeAlias];
    if (!crmConfig || !crmConfig.isAuthenticated) {
        return null;
    }

    // Retrieve API keys from the secure backend
    const frappeApiKeys = getFrappeApiKeys(activeAlias);
    if (!frappeApiKeys) {
        console.error(`[CRM_MANAGER] API keys not found for active alias '${activeAlias}' in secure config.`);
        return null;
    }

    return {
        alias: activeAlias,
        url: crmConfig.url,
        apiKey: frappeApiKeys.apiKey,
        apiSecret: frappeApiKeys.apiSecret,
    };
}

function listUserCrmAliases(chatId) {
    initializeUserCrmSession(chatId);
    return Object.keys(userCrmSessions[chatId].crms);
}

function deleteUserCrm(chatId, alias) {
    initializeUserCrmSession(chatId);
    if (userCrmSessions[chatId].crms[alias]) {
        delete userCrmSessions[chatId].crms[alias];
        if (userCrmSessions[chatId].activeCrmAlias === alias) {
            userCrmSessions[chatId].activeCrmAlias = null; // Clear active if deleted
        }
        return true;
    }
    return false;
}

// --- New Authentication-Related Functions ---

/**
 * Validates if a given alias exists in our pre-prepared API key store.
 * @param {string} alias
 * @returns {boolean}
 */
function validateCrmAlias(alias) {
    const availableAliases = listAvailableCrmAliases();
    return availableAliases.includes(alias);
}

/**
 * Authenticates user credentials against the Frappe CRM instance.
 * @param {string} alias - The alias of the CRM instance.
 * @param {string} username - User's CRM username.
 * @param {string} password - User's CRM password.
 * @returns {Promise<boolean>} - True if authentication is successful, false otherwise.
 */
async function authenticateUser(alias, username, password) {
    const crmDetails = getFrappeApiKeys(alias);
    if (!crmDetails || !crmDetails.url) {
        console.error(`[CRM_MANAGER] CRM URL not found for alias: ${alias}`);
        return false;
    }

    try {
        const response = await axios.post(`${crmDetails.url}/api/method/login`, {
            usr: username,
            pwd: password,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Frappe CRM login endpoint typically returns 200 on success
        if (response.status === 200) {
            console.log(`[CRM_MANAGER] Authentication successful for alias: ${alias}, user: ${username}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[CRM_MANAGER] Authentication failed for alias: ${alias}, user: ${username}. Error:`, error.response?.data || error.message);
        return false;
    }
}

module.exports = {
    initializeUserCrmSession,
    getCrmConfig,
    addAuthenticatedCrm,
    setActiveCrmAlias,
    getActiveCrmAlias,
    getActiveCrmDetails,
    listUserCrmAliases,
    deleteUserCrm,
    validateCrmAlias,
    authenticateUser,
};