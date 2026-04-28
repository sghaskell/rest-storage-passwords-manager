/**
 * api.js - REST API service for Splunk storage/passwords endpoint
 *
 * Uses the splunkd/__raw proxy with cookie-based authentication and
 * CSRF protection, matching the pattern used by SplunkJS dashboards.
 */

const API_ENDPOINT = '/en-US/splunkd/__raw/servicesNS/-/-/storage/passwords';

/**
 * Parse Splunk XML error responses to extract human-readable messages.
 * Strips HTML entities and extracts content between <msg> tags.
 */
function parseError(errorText) {
    if (!errorText || typeof errorText !== 'string') return '';
    const match = errorText.match(/<msg[^>]*>([\s\S]*?)<\/msg>/i);
    // Extract message text from XML <msg> tag
    let extracted = (match && match[1])
        ? match[1].trim()
        : null;

    if (extracted) {
        // Strip common HTML entities
        return extracted
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    return errorText.trim();
}

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
        const parsedMsg = parseError(errorText);
        const error = new Error(parsedMsg || `API Error ${response.status}`);
        error.status = response.status; // Preserve for createCredential conflict detection
        throw error;
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
        const parsedMsg = parseError(errorText);
        const error = new Error(parsedMsg || `API Error ${response.status}`);
        error.status = response.status; // Preserve for createCredential conflict detection
        throw error;
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
 * Build ACL path for a credential using Splunk's storage/passwords convention.
 * Uses "credential:" prefix with URL-encoded stanza key to match Splunk REST API.
 *
 * @param {string} stanzaKey - The credential stanza (e.g., "prod:api-user:")
 * @param {string} owner     - Owner (defaults to "nobody")
 * @param {string} app       - App context (defaults to "search")
 * @returns {string} Full ACL path ready for splunkd/__raw requests
 */
function buildAclPath(stanzaKey, owner, app) {
    const credId = encodeURIComponent(`credential:${stanzaKey}`);
    const safeOwner = encodeURIComponent(owner || 'nobody');
    const safeApp = encodeURIComponent(app || 'search');
    return `/servicesNS/${safeOwner}/${safeApp}/configs/conf-passwords/${credId}/acl`;
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
                name: username,
                password: password,
                realm: realm || '',
                owner: owner || 'nobody',
                app: app || 'search',
            },
        });

        // Step 2: Set ACL permissions using buildAclPath
        const stanzaKey = (created.entry && created.entry.length > 0) ? created.entry[0].name : '';
        if (stanzaKey) {
            const aclPath = buildAclPath(stanzaKey, owner || 'nobody', app || 'search');
            await splunkdRequest(aclPath, {
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

        // Update ACL separately using buildAclPath
        const stanzaKey = `${realm}:${name}:`;
        const aclPath = buildAclPath(stanzaKey, owner || 'nobody', app || 'search');
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

/**
 * Get the clear-text password for a credential.
 * Fetches the credential via storage/passwords and extracts clear_password from response.
 */
async function getCredentialPassword(name, realm) {
    const encodedName = encodeURIComponent(name);
    const encodedRealm = encodeURIComponent(realm);
    const data = await apiRequest(`/${encodedRealm}:${encodedName}`);
    return (data.entry && data.entry[0] && data.entry[0].content)
        ? data.entry[0].content.clear_password || null
        : null;
}

/**
 * Move a credential to a different app.
 * POSTs to the /move endpoint on the conf-passwords resource.
 */
async function moveCredential(name, realm, newApp) {
    const encodedName = encodeURIComponent(name);
    const encodedRealm = encodeURIComponent(realm);
    const stanzaKey = `${encodedRealm}:${encodedName}:`;
    const credId = encodeURIComponent(`credential:${stanzaKey}`);

    await splunkdRequest(
        `/servicesNS/nobody/${encodeURIComponent(newApp)}/configs/conf-passwords/${credId}/move`,
        {
            method: 'POST',
            body: {
                app: newApp,
                user: 'nobody',
            },
        }
    );
}

/**
 * Fetch available apps from Splunk /apps/local endpoint.
 * Returns array of { name } objects for app dropdown.
 * Gracefully returns empty array on failure.
 */
async function getApps() {
    try {
        const data = await splunkdRequest('/servicesNS/-/-/apps/local', { method: 'GET' });
        return (data.entry || []).map(e => ({ name: e.name }));
    } catch (err) {
        console.warn('Failed to fetch apps:', err.message);
        return [];
    }
}

/**
 * Fetch current authenticated user from /authentication/current-context endpoint.
 * Returns { username, fullName, email } object. Defaults to { username: 'nobody' } on failure.
 */
async function getUsers() {
    try {
        const data = await splunkdRequest('/servicesNS/nobody/system/authentication/current-context', { method: 'GET' });
        const entry = (data.entry || [])[0];
        if (!entry) return { username: 'nobody' };
        return {
            username: entry.content?.name || entry.name || 'nobody',
            fullName: entry.content?.fullName || '',
            email: entry.content?.email || '',
        };
    } catch (err) {
        console.warn('Failed to fetch current user:', err.message);
        return { username: 'nobody' };
    }
}

/**
 * Fetch available roles from /authorization/roles endpoint.
 * Returns array of role name strings for role dropdowns.
 * Gracefully returns empty array on failure.
 */
async function getRoles() {
    try {
        const data = await splunkdRequest('/servicesNS/-/-/authorization/roles', { method: 'GET' });
        return (data.entry || []).map(e => e.name);
    } catch (err) {
        console.warn('Failed to fetch roles:', err.message);
        return [];
    }
}

/**
 * Parse create error to detect duplicate credential conflicts.
 * Returns { isDuplicate, conflictName, message } for user-friendly feedback.
 */
function parseCreateError(error) {
    const isDuplicate = error.status === 409 ||
        (error.message && /already exists/i.test(error.message));
    return {
        isDuplicate,
        conflictName: null,
        message: isDuplicate
            ? 'A credential with this name already exists. Use the Edit button on the existing row to update it.'
            : (error.message || 'Failed to create credential'),
    };
}

// Default role constants for form defaults — prevents empty ACL stripping access (GAP-V03/V04)
const DEFAULT_READ_ROLES = ['admin', 'power'];
const DEFAULT_WRITE_ROLES = ['admin', 'power'];

// Export all API functions (CommonJS, consumed via require('./api') in bundle.jsx)
module.exports = {
    parseError,
    parseCreateError,
    buildAclPath,
    getAllCredentials,
    getCredential,
    createCredential,
    updateCredential,
    deleteCredential,
    getCredentialACL,
    getCredentialPassword,
    moveCredential,
    getApps,
    getUsers,
    getRoles,
    DEFAULT_READ_ROLES,
    DEFAULT_WRITE_ROLES,
};
