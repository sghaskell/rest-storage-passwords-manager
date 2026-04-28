/**
 * api.js - REST API service for Splunk storage/passwords endpoint
 *
 * Uses the splunkd/__raw proxy with cookie-based authentication and
 * CSRF protection, matching the pattern used by SplunkJS dashboards.
 */

const API_ENDPOINT = '/en-US/splunkd/__raw/servicesNS/-/-/storage/passwords';

/**
 * Extract Splunk CSRF token from cookies
 */
function getCSRFToken() {
    return document.cookie.split('; ')
        .find(row => row.startsWith('splunkweb_csrf_token'))
        ?.split('=')[1];
}

/**
 * Make authenticated API request to Splunk via splunkd/__raw proxy.
 * Uses cookie-based auth and form-urlencoded body for mutations.
 */
async function apiRequest(endpoint, options = {}) {
    const method = options.method || 'GET';
    let url = `${API_ENDPOINT}${endpoint}`;

    // Append output_mode=json for GET requests (Splunk returns XML by default)
    if (method === 'GET') {
        const separator = url.includes('?') ? '&' : '?';
        url += `${separator}output_mode=json`;
    }

    const headers = {};
    let body = undefined;

    const csrfToken = getCSRFToken();
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-Splunk-Form-Key'] = csrfToken;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(options.body).toString();
    }

    const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json().catch(() => ({}));
}

/**
 * Make request to a full SPLUNKD proxy path (not under storage/passwords)
 */
async function splunkdRequest(path, options = {}) {
    const method = options.method || 'GET';
    let url = `/en-US/splunkd/__raw${path}`;

    if (method === 'GET') {
        const separator = url.includes('?') ? '&' : '?';
        url += `${separator}output_mode=json`;
    }

    const headers = {};
    let body = undefined;

    const csrfToken = getCSRFToken();
    if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-Splunk-Form-Key'] = csrfToken;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(options.body).toString();
    }

    const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json().catch(() => ({}));
}

/**
 * Flatten raw Splunk entry to shape expected by components
 */
function flattenCredential(entry) {
    const content = entry.content || {};
    const acl = entry.acl || {};
    const perms = acl.perms || {};
    return {
        name: content.username || '',
        realm: content.realm || '',
        app: acl.app || 'search',
        owner: acl.owner || 'nobody',
        aclRead: (perms.read || []).join(', '),
        aclWrite: (perms.write || []).join(', '),
        sharing: acl.sharing || 'app',
        stanzaKey: entry.name || '',
        editLink: (entry.links && entry.links.edit) || null,
    };
}

/**
 * Get all credentials
 */
async function getAllCredentials() {
    try {
        const data = await apiRequest('');
        return (data.entry || []).map(flattenCredential);
    } catch (error) {
        console.error('Error fetching credentials:', error);
        throw error;
    }
}

/**
 * Get a single credential by name and realm
 */
async function getCredential(name, realm) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const data = await apiRequest(`/${encodedRealm}:${encodedName}`);
        return (data.entry || [null])[0] ? flattenCredential((data.entry || [null])[0]) : null;
    } catch (error) {
        console.error(`Error fetching credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Create a new credential, then set its ACL permissions.
 * Splunk requires two separate calls: POST to create, PUT /acl for permissions.
 */
async function createCredential(username, password, realm, app, owner, readRoles, writeRoles) {
    try {
        // Step 1: Create credential
        const createUri = `/servicesNS/nobody/${app || 'search'}/storage/passwords`;
        const created = await splunkdRequest(createUri, {
            method: 'POST',
            body: {
                name: realm ? `${realm}:${username}` : username,
                password: password,
                realm: realm || '',
                owner: owner || 'nobody',
                app: app || 'search',
            },
        });

        const editLink = (created.entry && created.entry.length > 0 && created.entry[0].links && created.entry[0].links.edit) || null;

        // Step 2: Set ACL permissions
        if (editLink) {
            await splunkdRequest(`${editLink}/acl`, {
                method: 'PUT',
                body: {
                    sharing: 'app',
                    owner: owner || 'nobody',
                    perms_read: readRoles ? readRoles.join(',') : '',
                    perms_write: writeRoles ? writeRoles.join(',') : (owner || 'nobody'),
                },
            });
        }

        return created.entry || null;
    } catch (error) {
        console.error('Error creating credential:', error);
        throw error;
    }
}

/**
 * Update an existing credential password, then set ACL permissions.
 */
async function updateCredential(name, realm, password, readRoles, writeRoles, owner, app) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const endpoint = `/${encodedRealm}:${encodedName}`;

        // Update credential (password + owner + app)
        const body = {};
        if (password) body.password = password;
        if (owner) body.owner = owner;
        if (app) body.app = app;

        await apiRequest(endpoint, {
            method: 'POST',
            body: body,
        });

        // Update ACL separately
        const aclPath = `/servicesNS/nobody/${app || 'search'}/configs/conf-passwords/${encodedRealm}%3A${encodedName}/acl`;
        await splunkdRequest(aclPath, {
            method: 'PUT',
            body: {
                sharing: 'app',
                owner: owner || 'nobody',
                perms_read: readRoles ? readRoles.join(',') : '',
                perms_write: writeRoles ? writeRoles.join(',') : (owner || 'nobody'),
            },
        });
    } catch (error) {
        console.error(`Error updating credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Delete a credential
 */
async function deleteCredential(name, realm) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        await apiRequest(`/${encodedRealm}:${encodedName}`, {
            method: 'DELETE',
            body: {},
        });
    } catch (error) {
        console.error(`Error deleting credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Get ACL information for a credential
 */
async function getCredentialACL(name, realm) {
    try {
        const encodedName = encodeURIComponent(name);
        const encodedRealm = encodeURIComponent(realm);
        const data = await apiRequest(`/${encodedRealm}:${encodedName}/acl`);
        return data.entry || null;
    } catch (error) {
        console.error(`Error fetching ACL for ${realm}:${name}:`, error);
        throw error;
    }
}

// Export all API functions (CommonJS, consumed via require('./api') in bundle.jsx)
module.exports = {
    getAllCredentials,
    getCredential,
    createCredential,
    updateCredential,
    deleteCredential,
    getCredentialACL,
};
