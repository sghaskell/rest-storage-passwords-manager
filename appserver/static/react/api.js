/**
 * api.js - REST API service for Splunk storage/passwords endpoint
 *
 * Uses the splunkd/__raw proxy with cookie-based authentication and
 * CSRF protection, matching the pattern used by SplunkJS dashboards.
 */

const API_ENDPOINT = '/en-US/splunkd/__raw/servicesNS/-/-/storage/passwords';
const DEFAULT_FETCH_TIMEOUT_MS = 30000;

/**
 * Parse Splunk error responses — handles both XML (<msg>) and JSON formats.
 * Splunk web proxy may return either depending on context.
 */
function parseError(errorText) {
    if (!errorText || typeof errorText !== 'string') return '';

    // Try JSON format first: {"messages":[{"type":"WARN","text":"..."}]}
    try {
        const j = JSON.parse(errorText);
        if (j.messages && Array.isArray(j.messages)) {
            const msgs = j.messages.map(m => m.text || '').filter(Boolean);
            if (msgs.length) return msgs.join('; ');
        }
        // Try {"error":"..."} format
        if (j.error && typeof j.error === 'string') return j.error;
    } catch (_) {}

    // Fall back to XML <msg> tag extraction
    const match = errorText.match(/<msg[^>]*>([\s\S]*?)<\/msg>/i);
    let extracted = (match && match[1]) ? match[1].trim() : null;

    if (extracted) {
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
 * Serialize an object to application/x-www-form-urlencoded.
 * Skips null/undefined values. Empty strings are encoded as key= (valid for Splunk).
 * Arrays are encoded as repeated keys (key=value&key=value).
 */
function formEncode(data) {
    if (!data || typeof data !== 'object') return '';
    const parts = [];
    Object.entries(data).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) {
            value.forEach(v => {
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
            });
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    });
    return parts.join('&');
}

/**
 * Parse Splunk XML responses into a flat object.
 * Handles search job creation responses (sid) and polling responses (isDone, dispatchState, messages).
 */
function parseSplunkXml(xml) {
    const result = {};
    // Extract simple tags: <sid>s123...</sid>, <isDone>1</isDone>, etc.
    const tagRegex = /<(\w+)>([^<]*)<\/\1>/g;
    let m;
    while ((m = tagRegex.exec(xml)) !== null) {
        result[m[1]] = m[2].trim();
    }
    // Extract <entry> blocks with nested content
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (entryMatch) {
        const contentMatch = entryMatch[1].match(/<content>([\s\S]*?)<\/content>/);
        if (contentMatch) {
            const contentObj = {};
            let cm;
            while ((cm = tagRegex.exec(contentMatch[1])) !== null) {
                contentObj[cm[1]] = cm[2].trim();
            }
            result.entry = [{ content: contentObj }];
        }
        // Extract <name> from entry
        const nameMatch = entryMatch[1].match(/<name>([^<]*)<\/name>/);
        if (nameMatch) result.name = nameMatch[1].trim();
    }
    return result;
}

/**
 * Make authenticated API request to Splunk via splunkd/__raw proxy.
 * Uses cookie-based auth and form-urlencoded body for mutations.
 * Body is serialized unconditionally for mutations (POST/PUT/PATCH), matching legacy behavior.
 */
async function apiRequest(endpoint, options = {}) {
    const method = options.method || 'GET';
    let url = `${API_ENDPOINT}${endpoint}`;

    // Always append output_mode=json — Splunk web proxy converts to JSON reliably.
    // GET: required because Splunk defaults to XML responses.
    // POST/PUT/PATCH: included in body via formEncode, ensuring JSON responses for .json() parsing.
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}output_mode=json&count=0`;

    // Replicate exact header set from password-crud.js splunkdFetch().
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    let body = undefined;
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    // CSRF token — cookie name may include port on some installs (splunkweb_csrf_token_8000)
    const csrfToken = getCSRFToken();
    if (csrfToken && isMutation) {
        headers['X-Splunk-Form-Key'] = csrfToken;
    }

    // Serialize body for mutations UNCONDITIONALLY — body must reach Splunk even without CSRF
    if (isMutation && options.body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        // Inject output_mode=json into body so mutation responses are JSON (fixes .json() parsing)
        const bodyData = { ...options.body, output_mode: 'json' };
        body = formEncode(bodyData);
    }

    const timeout = options.timeout || DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: body,
            credentials: 'include',
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            const parsedMsg = parseError(errorText);
            const error = new Error(parsedMsg || `API Error ${response.status}`);
            error.status = response.status;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('json') && !contentType.includes('javascript')) {
            const text = await response.text();
            if (!text || text.trim().length === 0) {
                return {};
            }
            console.warn(`apiRequest: non-JSON response (${contentType}), status ${response.status}`);
            return { error: 'Invalid response — expected JSON' };
        }
        return response.json().catch(() => ({ error: 'Invalid response — failed to parse JSON' }));
    } finally {
        clearTimeout(timerId);
    }
}

/**
 * Make request to a full SPLUNKD proxy path (not under storage/passwords)
 */
async function splunkdRequest(path, options = {}) {
    const method = options.method || 'GET';
    let url = `/en-US/splunkd/__raw${path}`;

    // Always append output_mode=json for GET — Splunk defaults to XML.
    // Do NOT append count=0 — on /results endpoints it returns 0 results.
    if (method === 'GET') {
        const separator = url.includes('?') ? '&' : '?';
    url += `${separator}output_mode=json`;
    }

    // Replicate exact header set from password-crud.js splunkdFetch().
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    let body = undefined;
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    // CSRF token for ALL mutations — required even for DELETE requests without a body
    if (isMutation) {
        const csrfToken = getCSRFToken();
        if (csrfToken) {
            headers['X-Splunk-Form-Key'] = csrfToken;
        }
    }

    if (isMutation && options.body) {
        // Serialize body for mutations UNCONDITIONALLY — body must reach Splunk even without CSRF
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        // Inject output_mode=json into mutation bodies so Splunk returns JSON instead of XML.
        // This fixes .json() parsing on POST/PUT/PATCH responses across all callers:
        // - createCredential (splunkdRequest for POST /storage/passwords and /configs/.../acl)
        // - updateCredential (apiRequest for /storage/passwords, splunkdRequest for ACL)
        // - deleteCredential (pre-delete ACL bump via splunkdRequest)
        const bodyData = { ...options.body, output_mode: 'json' };
        body = formEncode(bodyData);
    }

    const timeout = options.timeout || DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: body,
            credentials: 'include',
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            const parsedMsg = parseError(errorText);
            const error = new Error(parsedMsg || `API Error ${response.status}`);
            error.status = response.status;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('json') && !contentType.includes('javascript')) {
            const text = await response.text();
            if (!text || text.trim().length === 0) {
                return {};
            }
            // Parse Splunk XML response — simple tag extraction for search job creation, etc.
            return parseSplunkXml(text);
        }
        return response.json().catch(() => ({ error: 'Invalid response — failed to parse JSON' }));
    } finally {
        clearTimeout(timerId);
    }
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
async function createCredential(username, password, realm, app, owner, readRoles, writeRoles, sharing = 'app') {
    try {
        // Step 1: Create credential — uses actual owner in URI (matches legacy createSingleCredential L472-476)
        const resolvedOwner = encodeURIComponent(owner || 'nobody');
        const resolvedApp = encodeURIComponent(app || 'search');
        const createUri = `/servicesNS/${resolvedOwner}/${resolvedApp}/storage/passwords`;
        const created = await splunkdRequest(createUri, {
            method: 'POST',
            body: {
                name: username,
                password: password,
                realm: realm || '',
            },
        });

        // Step 2: Set ACL — build explicit path using credential:${realm}:${username}:
        // Matches legacy line 477: hardcoded credential%3A${realm}%3A${username}%3A/acl
        const aclPath = `/servicesNS/${resolvedOwner}/${resolvedApp}/configs/conf-passwords/credential%3A${encodeURIComponent(realm || '')}%3A${encodeURIComponent(username)}%3A/acl`;

        // Two-step ACL write required by splunkd when sharing='user' (legacy L479-481)
        if (sharing === 'user') {
            await splunkdRequest(aclPath, {
                method: 'POST',
                body: {
                    'perms.read': readRoles ? readRoles.join(',') : '',
                    'perms.write': writeRoles ? writeRoles.join(',') : '',
                    sharing: 'app',
                    owner: owner || 'nobody',
                },
            });
        }

        // Final ACL with actual sharing value
        await splunkdRequest(aclPath, {
            method: 'POST',
            body: {
                'perms.read': readRoles ? readRoles.join(',') : '',
                'perms.write': writeRoles ? writeRoles.join(',') : '',
                sharing: sharing,
                owner: owner || 'nobody',
            },
        });

        return created.entry || null;
    } catch (error) {
        console.error('Error creating credential:', error);
        throw error;
    }
}

/**
 * Update an existing credential password, then set ACL permissions.
 * Mirrors legacy handleUpdateCredential exactly (password-crud.js L511-554):
1. ACL bump: sharing=app for predictable splunkd URI behaviour
2. POST password only to nobody/{sourceApp}/storage/passwords/{stanza}
3. If app changed, POST /move endpoint
4. Final ACL with actual sharing value against target app
 */
async function updateCredential(name, realm, password, readRoles, writeRoles, owner, newApp, sharing = 'app', sourceApp) {
    try {
        const stanzaKey = `${(realm || '')}:${name}:`;
        const encodedStanza = encodeURIComponent(stanzaKey);
        const actualSourceApp = sourceApp || (owner === 'nobody' ? getCurrentApp() : 'search');
        const targetApp = newApp || actualSourceApp;

        // Step 1: ACL bump to app scope first (legacy L522-523)
        const sourceAclPath = buildAclPath(stanzaKey, owner || 'nobody', actualSourceApp);
        await splunkdRequest(sourceAclPath, {
            method: 'POST',
            body: {
                'perms.read': readRoles ? readRoles.join(',') : '',
                'perms.write': writeRoles ? writeRoles.join(',') : (owner || 'nobody'),
                sharing: 'app',
                owner: owner || 'nobody',
            },
        });

        // Step 2: Update password only — nobody/{sourceApp} path per legacy L526-529
        if (password) {
            await splunkdRequest(
                `/servicesNS/nobody/${encodeURIComponent(actualSourceApp)}/storage/passwords/${encodedStanza}`,
                { method: 'POST', body: { password } }
            );
        }

        // Step 3: Move if app changed — legacy L532-538
        if (actualSourceApp !== targetApp) {
            const moveCredId = encodeURIComponent(`credential:${stanzaKey}`);
            await splunkdRequest(
                `/servicesNS/nobody/${encodeURIComponent(actualSourceApp)}/configs/conf-passwords/${moveCredId}/move`,
                { method: 'POST', body: { app: targetApp, user: 'nobody' } }
            );
        }

        // Step 4: Final ACL with actual sharing value against target app (legacy L541-546)
        const finalAclPath = buildAclPath(stanzaKey, owner || 'nobody', targetApp);
        await splunkdRequest(finalAclPath, {
            method: 'POST',
            body: {
                'perms.read': readRoles ? readRoles.join(',') : '',
                'perms.write': writeRoles ? writeRoles.join(',') : (owner || 'nobody'),
                sharing: sharing,
                owner: owner || 'nobody',
            },
        });
    } catch (error) {
        console.error(`Error updating credential ${realm}:${name}:`, error);
        throw error;
    }
}

/**
 * Delete a credential.
 * Mirrors legacy executeDelete exactly (password-crud.js L569-582):
1. ACL bump using row's actual owner/app/acl_read/acl_write
2. DELETE via /servicesNS/{owner}/{app}/storage/passwords/{stanza}
 */
async function deleteCredential(name, realm, app, owner, readRoles, writeRoles, sharing = 'app') {
    try {
        const stanzaKey = `${(realm || '')}:${name}:`;
        const resolvedOwner = owner || 'nobody';
        const resolvedApp = app || getCurrentApp() || 'search';

        // Pre-delete ACL bump using per-credential ownership (legacy L572-576)
        const effectiveSharing = sharing === 'user' ? 'app' : sharing;
        const aclPath = buildAclPath(stanzaKey, resolvedOwner, resolvedApp);
        await splunkdRequest(aclPath, {
            method: 'POST',
            body: {
                'perms.read': readRoles ? (Array.isArray(readRoles) ? readRoles.join(',') : readRoles) : '*',
                'perms.write': writeRoles ? (Array.isArray(writeRoles) ? writeRoles.join(',') : writeRoles) : (resolvedOwner),
                sharing: effectiveSharing,
                owner: resolvedOwner,
            },
        });

        // DELETE via explicit splunkd path (legacy L578-580)
        const encodedStanza = encodeURIComponent(stanzaKey);
        await splunkdRequest(
            `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza}`,
            { method: 'DELETE' }
        );
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
 * For user-scoped credentials, temporarily bumps sharing to 'app' so the fetch succeeds,
 * then restores original sharing — mirrors legacy L425-433 exactly.
 */
async function getCredentialPassword(name, realm, app, owner, sharing) {
    const resolvedOwner = owner || 'nobody';
    const resolvedApp = app || getCurrentApp() || 'search';
    const stanzaKey = `${(realm || '')}:${name}:`;
    let didBumpSharing = false;

    // Temporary sharing bump for user-scoped credentials (legacy L427-429)
    if (sharing === 'user') {
        const aclPath = buildAclPath(stanzaKey, resolvedOwner, resolvedApp);
        await splunkdRequest(aclPath, {
            method: 'POST',
            body: {
                sharing: 'app',
                owner: resolvedOwner,
            },
        });
        didBumpSharing = true;
    }

    try {
        const encodedStanza = encodeURIComponent(stanzaKey);
        const data = await splunkdRequest(
            `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza}`
        );
        const pwd = (data.entry && data.entry[0] && data.entry[0].content)
            ? data.entry[0].content.clear_password || null
            : null;
        return pwd;
    } finally {
        // Restore user sharing (legacy L431-432)
        if (didBumpSharing) {
            const aclPath = buildAclPath(stanzaKey, resolvedOwner, resolvedApp);
            await splunkdRequest(aclPath, {
                method: 'POST',
                body: {
                    sharing: 'user',
                    owner: resolvedOwner,
                },
            }).catch(() => console.warn('Failed to restore user-scoped sharing after password reveal'));
        }
    }
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
 * Fetch list of all users from /authentication/users endpoint.
 * Returns array of { name, fullName, email } objects. Defaults to [] on failure.
 * Mirrors legacy password-crud.js fetchUsers() exactly.
 */
async function getUsers() {
    try {
        const data = await splunkdRequest('/servicesNS/-/-/authentication/users', { method: 'GET' });
        return (data.entry || []).map(e => ({
            name: e.name,
            fullName: e.content?.fullName || '',
            email: e.content?.email || '',
        }));
    } catch (err) {
        console.warn('Failed to fetch users:', err.message);
        return [];
    }
}

/**
 * Fetch current authenticated user. Uses Splunk.util if available, falls back to 'nobody'.
 * Mirrors legacy password-crud.js currentUser() which uses Splunk.util.getConfigValue('USERNAME').
 */
function getCurrentUser() {
    try {
        if (typeof window !== 'undefined' && window.Splunk && window.Splunk.util) {
            return window.Splunk.util.getConfigValue('USERNAME') || 'nobody';
        }
    } catch (err) {
        // Splunk.util not available
    }
    return 'nobody';
}

/**
 * Fetch available roles from /authorization/roles endpoint.
 * Returns array of role name strings for role dropdowns, with '* (all)' sentinel prepended.
 * Gracefully returns empty array on failure.
 */
async function getRoles() {
    try {
        const data = await splunkdRequest('/servicesNS/-/-/authorization/roles', { method: 'GET' });
        const roles = (data.entry || []).map(e => e.name);
        // Prepend '* (all)' sentinel — selecting * grants access to all roles (legacy password-crud.js behavior)
        return ['* (all)', ...roles];
    } catch (err) {
        console.warn('Failed to fetch roles:', err.message);
        return ['* (all)'];
    }
}

/**
 * Parse create error to detect duplicate credential conflicts.
 * Returns { isDuplicate, conflictName, message } for user-friendly feedback.
 */
function parseCreateError(error) {
    const isDuplicate = !!(error.status === 409 ||
        (error.message && /already exists/i.test(error.message)));
    return {
        isDuplicate,
        conflictName: null,
        message: isDuplicate
            ? 'A credential with this name already exists. Use the Edit button on the existing row to update it.'
            : (error.message || 'Failed to create credential'),
    };
}

/**
 * Get current app context from URL path (/app/{appname}/...)
 */
function getCurrentApp() {
    const match = window.location.pathname.match(/\/app\/([^/]+)/);
    return match ? match[1] : 'search';
}

/**
 * RFC 4180-compliant CSV parser — ported from legacy password-crud.js.
 * Handles quoted fields, escaped quotes, and comment lines (# prefix).
 * Returns { rows, errors } where each row has username, password, realm, app, owner, sharing, read, write.
 */
function parseCSV(text) {
    // Strip UTF-8 BOM (Excel/save-as adds this, breaks header detection)
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() && !l.trimStart().startsWith('#'));
    if (lines.length < 2) return { rows: [], errors: ['File is empty or has no data rows.'] };

    // RFC 4180-compliant field splitter
    function splitLine(line) {
        const fields = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuote) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') inQuote = false;
                else cur += ch;
            } else {
                if (ch === '"') inQuote = true;
                else if (ch === ',') { fields.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        fields.push(cur);
        return fields;
    }

    const headers = splitLine(lines[0]).map(h => h.trim().toLowerCase());
    if (!headers.includes('username') || !headers.includes('password')) {
        return { rows: [], errors: ['Invalid CSV: the header row must contain "username" and "password" columns. Please download the template for the correct format.'] };
    }
    const MAX_CSV_ROWS = 500;
    const defaultApp = getCurrentApp();
    const currentOwner = getCurrentUser();
    const rows = [], errors = [];

    let limitReached = false;
    lines.slice(1).forEach((line, i) => {
        if (!line.trim()) return;
        if (limitReached) return;
        if (rows.length >= MAX_CSV_ROWS) {
            errors.push(`Row limit of ${MAX_CSV_ROWS} reached — remaining rows skipped.`);
            limitReached = true;
            return;
        }
        const vals = splitLine(line);
        const row = {};
        headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });

        const sanitize = function(s) {
            if (typeof s !== 'string') return '';
            return s.replace(/\0/g, '').trim();
        };

        const MAX_FIELD_LEN = 1024;
        const username = sanitize(row.username);
        const password = sanitize(row.password);
        if (!username || !password) {
            errors.push(`Row ${i + 2}: ${!username ? 'username' : 'password'} is required — skipped.`);
            return;
        }
        if (username.length > MAX_FIELD_LEN || password.length > MAX_FIELD_LEN) {
            errors.push(`Row ${i + 2}: field exceeds ${MAX_FIELD_LEN} characters — skipped.`);
            return;
        }
        rows.push({
            username,
            password,
            realm: sanitize(row.realm),
            app: sanitize(row.app) || defaultApp,
            owner: (row.owner && row.owner !== '*') ? sanitize(row.owner) : currentOwner,
            sharing: ['global', 'app', 'user'].includes(sanitize(row.sharing)) ? sanitize(row.sharing) : 'app',
            read: sanitize(row.read) || DEFAULT_READ_ROLES.join(','),
            write: sanitize(row.write) || DEFAULT_WRITE_ROLES.join(','),
        });
    });
    return { rows, errors };
}

/**
  * Generate CSV template for download — all 8 columns with comments and example row.
  * Matches JS version downloadCSVTemplate() exactly (password-crud.js L926-1101).
  */
 function generateCSVTemplate() {
     const app = getCurrentApp();
     const owner = getCurrentUser();
     return [
        '# REST storage/passwords Manager — Bulk Import Template',
         '# Required columns : username, password',
         '# Optional columns : realm, app, owner, sharing, read, write',
         '#',
         '# Column notes:',
         '#   username : the credential username (required)',
         '#   password : the credential password (required)',
         '#   realm    : optional descriptor, e.g. prod or dev (default: empty)',
        `#   app      : Splunk app context to store the credential in (default: ${app})`,
        `#   owner    : a Splunk username — must be a real user, NOT * (default: ${owner})`,
         '#   sharing  : one of: global, app, user (default: app)',
         '#   read     : comma-separated roles that can read, or * for all — enclose in quotes if multiple, e.g. "admin,power" (default: admin,power)',
         '#   write    : comma-separated roles that can write, or * for all — enclose in quotes if multiple, e.g. "admin,power" (default: admin,power)',
         '#',
         '# Lines starting with # are ignored during import.',
         '#',
         'username,password,realm,app,owner,sharing,read,write',
        `example-user,example-password,example-realm,${app},${owner},app,"admin,power","admin,power"`,
     ].join('\n') + '\n';
 }

// Default role constants for form defaults — prevents empty ACL stripping access (GAP-V03/V04)
const DEFAULT_READ_ROLES = ['admin', 'power'];
const DEFAULT_WRITE_ROLES = ['admin', 'power'];

/**
 * Parse Splunk search results JSON into audit entry objects.
 * Splunk /results?output_mode=json returns:
 * { fields: [{name: "..."}], results: [{_time: "...", user: "...", ...}] }
 */
function parseAuditResults(response) {
    var fields = (response.fields && response.fields.map(function(f) { return f.name || ''; })) || [];
    var results = response.results || [];
    return results.map(function(entry) {
        return {
            timestamp: entry._time || '',
            user: entry.user || '',
            action: entry.action || '',
            credential: entry.password_id || '',
            info: entry.info || '',
            status: entry.status || '',
            status_code: entry.status_code || '',
        };
    });
}

/**
 * Terminate a search job (best-effort cleanup).
 */
async function terminateSearchJob(sid) {
    try {
        await splunkdRequest('/servicesNS/-/-/search/jobs/' + encodeURIComponent(sid) + '/control?action=terminate', {
            method: 'POST',
            body: { output_mode: 'json' },
        });
    } catch (_) { /* cleanup failure is non-critical */ }
}

/**
 * Parse Splunk search results JSON into access log entry objects.
 */
function parseAccessLogResults(response) {
    var results = response.results || [];
    return results.map(function(entry) {
        return {
            timestamp: entry._time || '',
            user: entry.user || entry.c_user || '',
            sc_status: entry.sc_status || '',
            cs_method: entry.cs_method || '',
        };
    });
}

/**
 * Submit and poll a Splunk search job until complete, then return parsed results.
 */
async function runSearchJob(searchQuery, earliestTime, timeRangeMs) {
    var jobResponse = await splunkdRequest('/servicesNS/-/-/search/jobs', {
        method: 'POST',
        body: {
            search: searchQuery,
            earliest_time: earliestTime,
            latest_time: 'now',
            exec_mode: 'normal',
        },
    });

    var sid = (jobResponse.sid) ||
        (jobResponse.entry && jobResponse.entry[0] && jobResponse.entry[0].content && jobResponse.entry[0].content.sid) ||
        null;
    if (!sid) {
        throw new Error('Search job failed to start — no SID returned');
    }

    var maxWaitMs = Math.max(15000, timeRangeMs > 604800000 ? 30000 : 20000);
    var startTime = Date.now();
    var pollInterval = 250;
    var result = null;

    try {
        while (Date.now() - startTime < maxWaitMs) {
            var statusResp = await splunkdRequest('/servicesNS/-/-/search/jobs/' + encodeURIComponent(sid), {
                method: 'GET',
            });

            var isDone = (statusResp && statusResp.entry && statusResp.entry[0] &&
                statusResp.entry[0].content && (statusResp.entry[0].content.isDone === '1' || statusResp.entry[0].content.isDone === true));

            if (isDone) {
                result = await splunkdRequest('/servicesNS/-/-/search/jobs/' + encodeURIComponent(sid) + '/results', {
                    method: 'GET',
                });
                break;
            }

            var dispatchState = (statusResp && statusResp.entry && statusResp.entry[0] &&
                statusResp.entry[0].content && statusResp.entry[0].content.dispatchState);
            if (dispatchState === 'FAILED' || dispatchState === 'KILLED') {
                var errorMsg = (statusResp && statusResp.entry && statusResp.entry[0] &&
                    statusResp.entry[0].content && statusResp.entry[0].content.messages) || '';
                throw new Error('Search job failed: ' + (errorMsg || dispatchState));
            }

            await new Promise(function(resolve) { setTimeout(resolve, pollInterval); });
            pollInterval = Math.min(pollInterval * 2, 2000);
        }

        // Timeout — grab partial results
        if (!result) {
            result = await splunkdRequest('/servicesNS/-/-/search/jobs/' + encodeURIComponent(sid) + '/results', {
                method: 'GET',
            });
        }
    } finally {
        await terminateSearchJob(sid);
    }

    return result;
}

/**
 * Fetch audit log entries for REST activity against storage/passwords.
 * Submits two parallel search jobs: one against _audit for actions, one against
 * _internal/splunkd_ui_access for HTTP status codes. Correlates by timestamp proximity.
 *
 * @param {number} timeRangeMs - Milliseconds to look back (e.g., 3600000 for 1 hour)
 * @returns {Array} Array of audit entry objects with timestamp, user, action, credential, info, status, status_code
 */
async function fetchAuditLog(timeRangeMs) {
    var seconds = Math.round(timeRangeMs / 1000);
    var earliestTime;
    if (seconds < 3600) {
        earliestTime = '-' + Math.round(seconds / 60) + 'm';
    } else if (seconds < 86400) {
        earliestTime = '-' + Math.round(seconds / 3600) + 'h';
    } else {
        earliestTime = '-' + Math.round(seconds / 86400) + 'd';
    }

    var auditQuery = 'search index=_audit (action=CREATE_PASSWORD OR action=EDIT_PASSWORD OR action=REMOVE_PASSWORD) | rex field=_raw "password_id=\\"(?<password_id>[^\\"]*)\\\"" | sort -_time | table _time, user, action, password_id, info';

    // splunkd_ui_access captures splunkd/__raw REST API calls from the web UI
    var accessQuery = 'search index=_internal sourcetype=splunkd_ui_access "storage/passwords" | rex "\\" (?<sc_status>\\d\\d\\d) " | rex "\\"(?<cs_method>[A-Z]+) " | sort -_time | table _time, user, sc_status, cs_method';

    try {
        var auditResp, accessResp;
        var auditPromise = runSearchJob(auditQuery, earliestTime, timeRangeMs);
        var accessPromise = runSearchJob(accessQuery, earliestTime, timeRangeMs);

        try {
            auditResp = await auditPromise;
        } catch (e) {
            console.warn('Audit log search failed:', e.message);
            throw e;
        }

        try {
            accessResp = await accessPromise;
        } catch (e) {
            console.warn('Access log search failed, audit entries will lack status codes:', e.message);
            accessResp = { results: [] };
        }

        var auditEntries = parseAuditResults(auditResp);
        var accessEntries = parseAccessLogResults(accessResp);
        return correlateAuditWithAccess(auditEntries, accessEntries);
    } catch (error) {
        if (error.status === 403 || /permission|capability|access denied/i.test(error.message || '')) {
            var permError = new Error('Insufficient permissions to query audit log. Required capability: search_filter:audit (or equivalent _audit index access).');
            permError.isPermissionError = true;
            throw permError;
        }
        throw error;
    }
}

/**
 * Correlate audit entries with access log HTTP status codes.
 * Matches by timestamp proximity (within 3 seconds).
 */
function correlateAuditWithAccess(auditEntries, accessEntries) {
    var MUTATION_METHODS = {'POST': true, 'PUT': true, 'PATCH': true, 'DELETE': true};
    var mutations = accessEntries.filter(function(a) {
        return MUTATION_METHODS[a.cs_method] && !isNaN(new Date(a.timestamp).getTime());
    });

    var sorted = mutations.slice().sort(function(a, b) {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    var CORRELATION_WINDOW_MS = 3000;

    return auditEntries.map(function(entry) {
        var auditTime = new Date(entry.timestamp).getTime();
        if (isNaN(auditTime)) {
            return Object.assign({}, entry, {
                status_code: '',
                status: getStatusCodeLabel('', entry.action),
            });
        }

        var nearest = null;
        var nearestDiff = Infinity;

        for (var i = 0; i < sorted.length; i++) {
            var accessTime = new Date(sorted[i].timestamp).getTime();
            var diff = Math.abs(accessTime - auditTime);
            if (diff <= CORRELATION_WINDOW_MS && diff < nearestDiff) {
                nearest = sorted[i];
                nearestDiff = diff;
            }
        }

        var statusCode = nearest ? nearest.sc_status : '';
        return Object.assign({}, entry, {
            status_code: statusCode,
            status: getStatusCodeLabel(statusCode, entry.action),
        });
    });
}

/**
 * Map HTTP status codes to human-readable labels, aware of the audit action.
 */
function getStatusCodeLabel(code, action) {
    if (!code) return 'Unknown';
    var num = parseInt(code, 10);
    if (num >= 200 && num < 300) return 'Success';
    if (num === 409) {
        if (action === 'CREATE_PASSWORD') return 'Duplicate';
        return 'Conflict';
    }
    if (num === 404) return 'Not Found';
    if (num === 403) return 'Forbidden';
    if (num >= 400 && num < 500) return 'Client Error';
    if (num >= 500) return 'Server Error';
    return 'Unknown';
}

// Export all API functions (CommonJS, consumed via require('./api') in bundle.jsx)
module.exports = {
    parseError,
    parseCreateError,
    buildAclPath,
    getCurrentApp,
    getCurrentUser,
    parseCSV,
    generateCSVTemplate,
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
    fetchAuditLog,
    DEFAULT_READ_ROLES,
    DEFAULT_WRITE_ROLES,
};
