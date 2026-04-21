/**
 * api.js - REST API service for Splunk storage/passwords endpoint
 *
 * Provides CRUD operations for managing credentials in Splunk's
 * storage/passwords REST endpoint.
 */

const API_ENDPOINT = '/servicesNS/nobody/system/storage/passwords';

/**
 * Build auth header for Splunk API requests
 */
function getAuthHeader() {
    // Get session key from Splunk
    if (typeof splunkjs !== 'undefined' && splunkjs.mvc) {
        const tokens = splunkjs.mvc.tokens;
        if (tokens) {
            return 'Splunk ' + tokens.get('sessionKey');
        }
    }
    return null;
}

/**
 * Make authenticated API request to Splunk
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_ENDPOINT}${endpoint}`;
    const authHeader = getAuthHeader();

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (authHeader) {
        headers['Authorization'] = authHeader;
    }

    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: 'same-origin',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return await response.json();
}

/**
 * Get all credentials
 */
export async function getAllCredentials() {
    try {
        const data = await apiRequest('');
        return data.entry || [];
    } catch (error) {
        console.error('Error fetching credentials:', error);
        throw error;
    }
}

/**
 * Get a single credential by name and realm
 */
export async function getCredential(name, realm) {
    try {
        // Encode special characters in name and realm
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const endpoint = `/${encodedRealm}:${encodedName}`;
        const data = await apiRequest(endpoint);
        return data.entry || null;
    } catch (error) {
        console.error(`Error fetching credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Create a new credential
 */
export async function createCredential(username, password, realm, app, owner, roles) {
    try {
        const body = {
            name: realm ? `${realm}:${username}` : username,
            password: password,
            realm: realm || '',
            app: app || 'search',
            owner: owner || 'nobody',
            roles: roles || [],
        };

        const data = await apiRequest('', {
            method: 'POST',
            body: body,
        });
        return data.entry || null;
    } catch (error) {
        console.error('Error creating credential:', error);
        throw error;
    }
}

/**
 * Update an existing credential
 */
export async function updateCredential(name, realm, password, roles, owner, app) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const endpoint = `/${encodedRealm}:${encodedName}`;

        const body = {
            password: password,
            roles: roles || [],
            owner: owner || 'nobody',
            app: app || 'search',
        };

        const data = await apiRequest(endpoint, {
            method: 'POST',
            body: body,
        });
        return data.entry || null;
    } catch (error) {
        console.error(`Error updating credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Delete a credential
 */
export async function deleteCredential(name, realm) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const endpoint = `/${encodedRealm}:${encodedName}`;

        const data = await apiRequest(endpoint, {
            method: 'DELETE',
        });
        return data;
    } catch (error) {
        console.error(`Error deleting credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Get ACL information for a credential
 */
export async function getCredentialACL(name, realm) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const endpoint = `/${encodedRealm}:${encodedName}/acl`;

        const data = await apiRequest(endpoint);
        return data.entry || null;
    } catch (error) {
        console.error(`Error fetching ACL for ${realm}:${name}:`, error);
        throw error;
    }
}
