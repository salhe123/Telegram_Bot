const bot = require("./telegram"); // Import bot to manage session
const axios = require("axios"); // Import axios for API calls
const { getFrappeApiKeys, listAvailableCrmAliases } = require("../config/crmApiKeys");

// --- Configuration ---
// Set the desired session duration (4 hours)
const SESSION_DURATION_MS = 4 * 60 * 60 * 1000; // 14,400,000 milliseconds

// This object will store user-specific CRM configurations in memory for the current session.
// In a production environment, this would be persisted in a database.
const userCrmSessions = {}; // { chatId: { activeCrmAlias: 'alias', crms: { 'alias': { url: '...', isAuthenticated: true, authTimestamp: 1700000000000 } } } }

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

/**
 * Adds a new authenticated CRM instance and sets the current timestamp.
 * @param {number} chatId
 * @param {string} alias
 * @param {string} url
 */
async function addAuthenticatedCrm(chatId, alias, url) {
    initializeUserCrmSession(chatId);
    userCrmSessions[chatId].crms[alias] = {
        url,
        isAuthenticated: true,
        authTimestamp: Date.now(), // Store the login time
    };
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

/**
 * Checks if the user's local session for a specific CRM has expired.
 * @param {number} chatId
 * @param {string} alias
 * @returns {boolean} True if the session is expired or invalid.
 */
function isSessionExpired(chatId, alias) {
    const crmConfig = userCrmSessions[chatId]?.crms?.[alias];

    if (!crmConfig || !crmConfig.isAuthenticated || !crmConfig.authTimestamp) {
        return true; // Not authenticated or data is missing
    }

    const timeElapsed = Date.now() - crmConfig.authTimestamp;

    // Check if elapsed time is greater than the allowed duration
    if (timeElapsed > SESSION_DURATION_MS) {
        // Clear the authentication status when it expires
        crmConfig.isAuthenticated = false;
        return true; // Expired
    }

    return false; // Still valid
}

/**
 * Retrieves the active CRM details and API keys, checking for session expiration first.
 * @param {number} chatId
 * @returns {Promise<object|null>} Details or null if not authenticated or expired.
 */
async function getActiveCrmDetails(chatId) {
    initializeUserCrmSession(chatId);
    const activeAlias = userCrmSessions[chatId].activeCrmAlias;
    if (!activeAlias) {
        return null;
    }

    // Check session expiration before retrieving API keys
    if (isSessionExpired(chatId, activeAlias)) {
        console.log(`[CRM_MANAGER] Session expired for chat: ${chatId}, alias: ${activeAlias}. User must re-authenticate.`);
        return null; // Session expired, block access
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