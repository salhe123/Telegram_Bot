// config/crmApiKeys.js
// This file simulates a secure backend storage for pre-prepared CRM API keys.
// In a production environment, these would be loaded from a secure database,
// environment variables, or a secrets management service.

const crmApiKeys = {
    "Glen": {
        url: "https://crm-demo.fr8labs.co/",
        apiKey: process.env.FRAPPE_API_KEY,
        apiSecret: process.env.FRAPPE_SECRET_KEY,
    },
    "anothercrm": {
        url: "https://anothercrm.frappecrm.com", 
        apiKey: process.env.FRAPPE_API_KEY_ANOTHERCRM,
        apiSecret: process.env.FRAPPE_API_SECRET_ANOTHERCRM,
    },
    // Add more CRM instances as needed
};

function getFrappeApiKeys(alias) {
    const crm = crmApiKeys[alias];
    if (!crm) {
        return null;
    }
    // Ensure API keys are actually set in environment variables
    if (!crm.apiKey || !crm.apiSecret) {
        console.warn(`[CRM_API_KEYS] API keys for alias '${alias}' are not set in environment variables.`);
        return null;
    }
    return {
        url: crm.url,
        apiKey: crm.apiKey,
        apiSecret: crm.apiSecret,
    };
}

function listAvailableCrmAliases() {
    return Object.keys(crmApiKeys);
}

module.exports = {
    getFrappeApiKeys,
    listAvailableCrmAliases,
};
