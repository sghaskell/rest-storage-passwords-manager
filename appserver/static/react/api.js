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

    // Extract the real namespace owner from the entry's id URL.
    var namespaceOwner = 'nobody';
    var id = entry.id || '';
    if (id) {
        var idParts = id.split('/servicesNS/');
        if (idParts[1]) {
            namespaceOwner = idParts[1].split('/')[0];
        }
    }

    return {
        name: content.username || '',
        realm: content.realm || '',
        app: acl.app || 'search',
        owner: acl.owner || 'nobody',
        namespaceOwner: namespaceOwner,
        aclRead: (perms.read || []).join(', '),
        aclWrite: (perms.write || []).join(', '),
        sharing: acl.sharing || 'app',
        stanzaKey: entry.name || '',
        editLink: (entry.links && entry.links.edit) || null,
        mtime: entry.mtime || '',
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
/**
 * Parse a credential name from configs/conf-passwords format.
 * Format: credential::username: or credential:realm:username:
 * Returns { name, realm }
 */
function parseCredentialName(fullName) {
    var str = fullName || '';
    // Strip 'credential:' prefix
    if (str.startsWith('credential:')) {
        str = str.substring(11);
    }
    // Format is now realm:username: (trailing colon)
    // Remove trailing colon
    if (str.endsWith(':')) {
        str = str.substring(0, str.length - 1);
    }
    // Split on first colon to get realm:username
    var colonIdx = str.indexOf(':');
    if (colonIdx === -1) {
        return { name: str, realm: '' };
    }
    return {
        realm: str.substring(0, colonIdx),
        name: str.substring(colonIdx + 1),
    };
}

/**
 * Flatten a configs/conf-passwords entry to the shape expected by components.
 */
function flattenConfigEntry(entry) {
    var acl = entry.acl || {};
    var content = entry.content || {};
    var perms = acl.perms || {};
    var fullName = entry.name || '';
    var parsed = parseCredentialName(fullName);

    // Extract the real namespace owner from the entry's id URL.
    // e.g., "https://host/servicesNS/admin/search/configs/..." → "admin"
    // This is reliable because the id reflects the actual config file location,
    // whereas acl.owner / eai:acl.owner may reflect the merged ACL metadata.
    var namespaceOwner = 'nobody';
    var id = entry.id || '';
    if (id) {
        var idParts = id.split('/servicesNS/');
        if (idParts[1]) {
            namespaceOwner = idParts[1].split('/')[0];
        }
    }

    return {
        name: parsed.name,
        realm: parsed.realm,
        app: acl.app || 'search',
        owner: acl.owner || 'nobody',
        namespaceOwner: namespaceOwner,
        aclRead: (perms.read || []).join(', '),
        aclWrite: (perms.write || []).join(', '),
        sharing: acl.sharing || 'app',
        stanzaKey: fullName,
        editLink: (entry.links && entry.links.edit) || null,
        deletePath: (entry.links && entry.links.edit) ? entry.links.edit.replace(/\/edit$/, '') : null,
        mtime: entry.mtime || '',
    };
}

async function getAllCredentials() {
    try {
        // Use configs/conf-passwords which returns ALL credentials including user-scoped
        // /storage/passwords filters out user-scoped credentials
        var data = await splunkdRequest('/servicesNS/-/-/configs/conf-passwords?count=0', { method: 'GET' });
        var credentials = (data.entry || []).map(flattenConfigEntry);
        return credentials;
    } catch (error) {
        console.error('Error fetching credentials:', error);
        throw error;
    }
}

/**
 * Two-step ACL write for configs/conf-passwords. If sharing='user', first bump
 * to 'app' then set the actual value. Errors are logged but not thrown — ACL
 * failures shouldn't block undo (the credential exists, just with default ACLs).
 */
async function _setAcl(aclPath, sharing, readRoles, writeRoles, owner) {
    var aclBody = {
        'perms.read': readRoles ? readRoles.join(',') : '',
        'perms.write': writeRoles ? writeRoles.join(',') : '',
        sharing: sharing,
        owner: owner || 'nobody',
    };
    try {
        if (sharing === 'user') {
            await splunkdRequest(aclPath, {
                method: 'POST',
                body: Object.assign({}, aclBody, { sharing: 'app' }),
            });
        }
        await splunkdRequest(aclPath, { method: 'POST', body: aclBody });
    } catch (aclErr) {
        console.warn(`[createCredential] ACL set failed (non-fatal): status=${aclErr.status} path=${aclPath}`);
    }
}

/**
 * Create a new credential, then set its ACL permissions.
 *
 * Primary path: POST to storage/passwords (creates at caller's namespace).
 * Fallback on 409: POST to configs/conf-passwords (creates at exact namespace level,
 * but only when the stanza already exists at another level).
 *
 * For dual-namespace entries (e.g., nobody/app + admin/user), create the admin entry
 * first so the nobody entry can use the configs fallback. See handleUndoDelete.
 */
async function createCredential(username, password, realm, app, owner, readRoles, writeRoles, sharing = 'app') {
    const resolvedOwner = encodeURIComponent(owner || 'nobody');
    const resolvedApp = encodeURIComponent(app || 'search');
    const aclPath = `/servicesNS/${resolvedOwner}/${resolvedApp}/configs/conf-passwords/credential%3A${encodeURIComponent(realm || '')}%3A${encodeURIComponent(username)}%3A/acl`;

    try {
        const created = await splunkdRequest(
            `/servicesNS/${resolvedOwner}/${resolvedApp}/storage/passwords`,
            {
                method: 'POST',
                body: { name: username, password: password, realm: realm || '' },
            }
        );
        await _setAcl(aclPath, sharing, readRoles, writeRoles, owner);
        return created.entry || null;
    } catch (error) {
        // 409 means stanza already exists — fall back to configs endpoint
        // which creates at the exact namespace level.
        if (error.status === 409) {
            try {
                const configStanza = encodeURIComponent(`credential:${(realm || '')}:${username}:`);
                await splunkdRequest(
                    `/servicesNS/${resolvedOwner}/${resolvedApp}/configs/conf-passwords/${configStanza}`,
                    { method: 'POST', body: { password: password, output_mode: 'json' } }
                );
                await _setAcl(aclPath, sharing, readRoles, writeRoles, owner);
                return null;
            } catch (configErr) {
                if (configErr.status === 409) {
                    return null;
                }
                throw configErr;
            }
        }
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
 *
 * Routes through the owner's namespace. No pre-delete ACL bump — the
 * calling user has permission to delete, and bumping can collide with
 * a duplicate at the same namespace.
 */
async function deleteCredential(name, realm, app, owner, readRoles, writeRoles, sharing = 'app') {
    const stanzaKey = `${(realm || '')}:${name}:`;
    const resolvedOwner = owner || 'nobody';
    const resolvedApp = app || getCurrentApp() || 'search';

    try {
        const encodedStanza = encodeURIComponent(stanzaKey);
        const storageUrl = `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza}`;
        await splunkdRequest(storageUrl, { method: 'DELETE' });
    } catch (error) {
        // storage/passwords may return 404 for entries whose config lives at a different
        // namespace level (e.g., app-scoped entry when user-scoped was deleted first).
        // Fall back to the caller's namespace — admin can see merged entries at all levels.
        if (error.status === 404) {
            // Try the admin namespace — can see merged entries at all levels
            try {
                const encodedStanza2 = encodeURIComponent(stanzaKey);
                const adminUrl = `/servicesNS/admin/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza2}`;
                console.warn(`[deleteCredential] 404 fallback DELETE (admin ns): ${adminUrl}`);
                await splunkdRequest(adminUrl, { method: 'DELETE' });
                console.warn(`[deleteCredential] 404 fallback succeeded (admin ns) for ${stanzaKey}`);
                return;
            } catch (adminErr) {
                if (adminErr.status === 400 || adminErr.status === 404) {
                    try {
                        const configStanza = encodeURIComponent(`credential:${stanzaKey}`);
                        const configUrl = `/servicesNS/admin/${encodeURIComponent(resolvedApp)}/configs/conf-passwords/${configStanza}`;
                        console.warn(`[deleteCredential] 404 fallback DELETE (admin config): ${configUrl}`);
                        await splunkdRequest(configUrl, { method: 'DELETE' });
                        console.warn(`[deleteCredential] 404 fallback succeeded (admin config) for ${stanzaKey}`);
                        return;
                    } catch (configErr) {
                        console.warn(`[deleteCredential] all fallbacks failed for ${stanzaKey}: admin=${adminErr.status}, config=${configErr.status}`);
                        throw configErr;
                    }
                }
                throw adminErr;
            }
        }
        throw error;
    }
}

/**
 * Get the clear-text password for a credential.
 *
 * Queries through the owner's namespace. For duplicates sharing a stanza,
 * Splunk returns the merged view — one password for both entries.
 */
async function getCredentialPassword(name, realm, app, owner, sharing) {
    const resolvedOwner = owner || 'nobody';
    const resolvedApp = app || getCurrentApp() || 'search';
    const stanzaKey = `${(realm || '')}:${name}:`;
    const encodedStanza = encodeURIComponent(stanzaKey);

    // Try storage/passwords first — returns clear_password for app/global scoped creds
    let pwd;
    let storageSucceeded = false;
    try {
        const data = await splunkdRequest(
            `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza}`
        );
        pwd = (data.entry && data.entry[0] && data.entry[0].content)
            ? data.entry[0].content.clear_password || null
            : null;
        storageSucceeded = true;
        if (pwd && sharing !== 'user') return pwd;
        // For user-scoped entries, this may be a merged (app-scoped) password.
        // Continue to detect and resolve merge below.
    } catch (e) {
        // 404 is expected for user-scoped credentials — fall through
    }

    // Fall back to configs/conf-passwords /password append for clear-text password
    if (!pwd) {
        try {
            const configStanza = encodeURIComponent(`credential:${stanzaKey}`);
            const configData = await splunkdRequest(
                `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(resolvedApp)}/configs/conf-passwords/${configStanza}/password`
            );
            pwd = (configData.entry && configData.entry[0] && configData.entry[0].content)
                ? configData.entry[0].content.clear_password || null
                : null;
            if (pwd) return pwd;
        } catch (e) {
            // fall through
        }
    }

    // User-scoped credentials need special handling.
    if (sharing === 'user') {
        const aclPath = buildAclPath(stanzaKey, resolvedOwner, resolvedApp);
        const nobodyStorageUrl = `/servicesNS/nobody/${encodeURIComponent(resolvedApp)}/storage/passwords/${encodedStanza}`;

        if (storageSucceeded && pwd) {
            // Storage returned a password, but it's likely the merged (app-scoped) one.
            // Detect merge: check if nobody namespace returns the same password.
            let appScopedPwd;
            try {
                const appData = await splunkdRequest(nobodyStorageUrl);
                appScopedPwd = (appData.entry && appData.entry[0] && appData.entry[0].content)
                    ? appData.entry[0].content.clear_password || null
                    : null;
            } catch (e) {
                // nobody returns 404 — no app-scoped entry exists, this IS the user pwd
                return pwd;
            }

            if (appScopedPwd && appScopedPwd === pwd) {
                // Merge detected — both entries return the same (app-scoped) password.
                // Break the merge to fetch the actual user-scoped password:
                // 1. Delete the nobody/app entry from storage
                // 2. Bump admin entry to app scope (no conflict now that nobody is gone)
                // 3. Fetch from nobody namespace (admin entry now visible there)
                // 4. Restore: bump back to user, then restore nobody entry
                try {
                    // Step 1: Delete nobody entry
                    await splunkdRequest(nobodyStorageUrl, { method: 'DELETE' });
                    // Step 2: Bump admin to app scope
                    await splunkdRequest(aclPath, {
                        method: 'POST',
                        body: { sharing: 'app', owner: resolvedOwner },
                    });
                    // Step 3: Fetch from nobody namespace
                    const data = await splunkdRequest(nobodyStorageUrl);
                    const userPwd = (data.entry && data.entry[0] && data.entry[0].content)
                        ? data.entry[0].content.clear_password || null
                        : null;
                    // Step 4a: Restore admin to user scope
                    await splunkdRequest(aclPath, {
                        method: 'POST',
                        body: { sharing: 'user', owner: resolvedOwner },
                    });
                    // Step 4b: Restore nobody entry
                    try {
                        await splunkdRequest(
                            `/servicesNS/nobody/${encodeURIComponent(resolvedApp)}/storage/passwords`,
                            { method: 'POST', body: { name: name, password: appScopedPwd, realm: realm || '' } }
                        );
                    } catch (restoreErr) {
                        if (restoreErr.status !== 409) throw restoreErr;
                    }
                    if (userPwd) return userPwd;
                    // If fetch returned 404, fall through to fallback below
                } catch (e) {
                    // Best-effort restore
                    try { await splunkdRequest(aclPath, { method: 'POST', body: { sharing: 'user', owner: resolvedOwner } }); } catch (_) {}
                    try {
                        await splunkdRequest(
                            `/servicesNS/nobody/${encodeURIComponent(resolvedApp)}/storage/passwords`,
                            { method: 'POST', body: { name: name, password: appScopedPwd, realm: realm || '' } }
                        );
                    } catch (_) {}
                }
                // Fallback: return the merged password
                return pwd;
            }
            // Passwords differ — storage already returned the user-scoped password
            return pwd;
        }

        // No storage result — standalone user-scoped credential.
        // Try ACL bump: temporarily promote to app scope so storage endpoint can see it.
        var bumpRestored = false;
        try {
            await splunkdRequest(aclPath, {
                method: 'POST',
                body: { sharing: 'app', owner: resolvedOwner },
            });
            const data = await splunkdRequest(nobodyStorageUrl);
            pwd = (data.entry && data.entry[0] && data.entry[0].content)
                ? data.entry[0].content.clear_password || null
                : null;
            await splunkdRequest(aclPath, {
                method: 'POST',
                body: { sharing: 'user', owner: resolvedOwner },
            });
            bumpRestored = true;
            if (pwd) return pwd;
        } catch (e) {
            if (!bumpRestored) {
                try {
                    await splunkdRequest(aclPath, {
                        method: 'POST',
                        body: { sharing: 'user', owner: resolvedOwner },
                    });
                } catch (restoreErr) {}
            }
            console.warn('getCredentialPassword ACL bump failed:', e.message);
            // Persist error for debugging (console.warn stripped in production)
            try { localStorage.setItem('cred_pwd_error', JSON.stringify({ path: aclPath, error: e.message, status: e.status, timestamp: Date.now() })); } catch(_) {}
        }
    }

    return pwd || null;
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
 * Generate a CSV export of credentials — metadata only (passwords are not stored in the list response).
 * Outputs the same 8-column format as the import template so the file can be re-imported after adding passwords.
 */
function generateExportCSV(credentials) {
    var lines = [
        '# REST storage/passwords Manager — Credential Export',
        '# Passwords are NOT included — Splunk does not return them in list responses.',
        '# Add passwords back, then re-import using "Import CSV".',
        '#',
        'username,password,realm,app,owner,sharing,read,write',
    ];
    credentials.forEach(function(c) {
        var esc = function(s) {
            s = (s || '').toString();
            if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };
        lines.push([
            esc(c.name),
            '',
            esc(c.realm),
            esc(c.app),
            esc(c.owner),
            esc(c.sharing),
            esc(c.aclRead),
            esc(c.aclWrite),
        ].join(','));
    });
    return lines.join('\n') + '\n';
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

    var auditQuery = 'search index=_audit (action=CREATE_PASSWORD OR action=EDIT_PASSWORD OR action=REMOVE_PASSWORD) | rex field=_raw "password_id=\\"(?<password_id>[^\\"]*)\\"" | sort -_time | table _time, user, action, password_id, info';

    // splunkd_ui_access captures splunkd/__raw REST API calls from the web UI
    var accessQuery = 'search index=_internal sourcetype=splunkd_ui_access "storage/passwords" | rex "\\" (?<sc_status>\\d\\d\\d) " | rex "\\"(?<cs_method>[A-Z]+) " | sort -_time | table _time, user, sc_status, cs_method';

    // ACL-only edits: POST to /acl on conf-passwords, excluding bulk operations (>5/sec)
    // and excluding windows that have a matching EDIT_PASSWORD in _audit
    var aclQuery = 'search index=_internal sourcetype=splunkd_ui_access "conf-passwords" POST "/acl" | rex "\\"POST (?<url>[^\\"]+)" | rex field=url "credential%3A(?<cred>[^/]+)" | rex field=url "(?:(?<has_move>/move))$" | eval cred=replace(cred, "%3A", ":") | eval window=strftime(_time, "%Y-%m-%dT%H:%M:%S") | stats values(cred) as credentials, min(_time) as _time, values(user) as users, count as acl_posts by window | where acl_posts <= 5 | eval credential=mvindex(credentials, 0), user=mvindex(users, 0) | sort -_time | table _time, user, credential';

    try {
        var auditResp, accessResp, aclResp;
        var auditPromise = runSearchJob(auditQuery, earliestTime, timeRangeMs);
        var accessPromise = runSearchJob(accessQuery, earliestTime, timeRangeMs);
        var aclPromise = runSearchJob(aclQuery, earliestTime, timeRangeMs);

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

        try {
            aclResp = await aclPromise;
        } catch (e) {
            console.warn('ACL search failed, ACL-only edits will not appear:', e.message);
            aclResp = { results: [] };
        }

        var auditEntries = parseAuditResults(auditResp);
        var accessEntries = parseAccessLogResults(accessResp);
        var aclEntries = parseACLEntries(aclResp);
        var correlated = correlateAuditWithAccess(auditEntries, accessEntries);
        return mergeACLEntries(correlated, aclEntries);
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
 * Parse Splunk search results JSON into ACL entry objects.
 */
function parseACLEntries(response) {
    var results = response.results || [];
    return results.map(function(entry) {
        return {
            timestamp: entry._time || '',
            user: entry.user || '',
            credential: entry.credential || '',
        };
    });
}

/**
 * Merge ACL-only edits into audit entries.
 * An ACL edit is "ACL-only" if no _audit event (EDIT_PASSWORD/CREATE_PASSWORD/REMOVE_PASSWORD)
 * exists within ±3 seconds for the same credential.
 */
function mergeACLEntries(auditEntries, aclEntries) {
    var CORRELATION_WINDOW_MS = 3000;

    // Collect all audit timestamps per credential for dedup
    var auditTimes = {};
    auditEntries.forEach(function(entry) {
        var key = entry.credential;
        if (!auditTimes[key]) auditTimes[key] = [];
        var t = new Date(entry.timestamp).getTime();
        if (!isNaN(t)) auditTimes[key].push(t);
    });

    // Find ACL-only entries
    var aclOnly = aclEntries.filter(function(acl) {
        var aclTime = new Date(acl.timestamp).getTime();
        if (isNaN(aclTime)) return false;
        var times = auditTimes[acl.credential] || [];
        // If any audit event is within window, it's not ACL-only
        for (var i = 0; i < times.length; i++) {
            if (Math.abs(times[i] - aclTime) <= CORRELATION_WINDOW_MS) {
                return false;
            }
        }
        return true;
    });

    // Convert ACL-only entries to audit format
    var aclAuditEntries = aclOnly.map(function(acl) {
        return {
            timestamp: acl.timestamp,
            user: acl.user,
            action: 'ACL_EDIT',
            credential: acl.credential,
            info: 'ACL-only edit (app scope, sharing, read/write roles)',
            status: 'Success',
            status_code: '200',
        };
    });

    // Merge and sort by timestamp descending
    var merged = auditEntries.concat(aclAuditEntries);
    merged.sort(function(a, b) {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return merged;
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

/**
 * Fetch the per-credential audit history from Splunk.
 * Queries _audit for password actions and _internal for ACL-only edits,
 * filtered by a specific credential name.
 *
 * password_id format varies by action:
 *   CREATE_PASSWORD → password_id="username" (bare name)
 *   EDIT_PASSWORD   → password_id=":username:" (stanza key)
 *   REMOVE_PASSWORD → password_id=":username:" (stanza key)
 *
 * @param {string} name - Credential username
 * @param {string} realm - Credential realm (empty string = global)
 * @param {number} timeRangeMs - Milliseconds to look back (default: 1 week)
 * @returns {Array} Sorted newest-first array of audit entry objects
 */
async function fetchCredentialHistory(name, realm, timeRangeMs) {
    timeRangeMs = timeRangeMs || 604800000; // default 7 days
    var seconds = Math.round(timeRangeMs / 1000);
    var earliestTime;
    if (seconds < 3600) {
        earliestTime = '-' + Math.round(seconds / 60) + 'm';
    } else if (seconds < 86400) {
        earliestTime = '-' + Math.round(seconds / 3600) + 'h';
    } else {
        earliestTime = '-' + Math.round(seconds / 86400) + 'd';
    }

    // Build password_id filter: match bare name (CREATE), stanza key (EDIT/REMOVE), and realm:name: format
    var escapedName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var bareName = escapedName;
    var stanzaKey = ':' + escapedName + ':';
    var realmStanzaKey = realm ? realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + ':' + escapedName + ':' : stanzaKey;

    // Audit query: match all three password_id formats
    var auditQuery = 'search index=_audit (action=CREATE_PASSWORD OR action=EDIT_PASSWORD OR action=REMOVE_PASSWORD) (password_id="' + bareName + '" OR password_id="' + stanzaKey + '" OR password_id="' + realmStanzaKey + '") | sort -_time | table _time, user, action, info';

    // ACL-only query: POST to /acl on conf-passwords, filtered by credential name
    var aclQuery = 'search index=_internal sourcetype=splunkd_ui_access "conf-passwords" POST "/acl" | rex \\"POST (?<url>[^\\"]+)\\" | rex field=url "credential%3A(?<cred>[^/]+)" | eval cred=replace(cred, "%3A", ":") | where like(cred, "%' + escapedName + '%") | sort -_time | table _time, user, credential';

    try {
        var auditResp, aclResp;

        try {
            auditResp = await runSearchJob(auditQuery, earliestTime, timeRangeMs);
        } catch (e) {
            console.warn('Credential history audit search failed:', e.message);
            throw e;
        }

        try {
            aclResp = await runSearchJob(aclQuery, earliestTime, timeRangeMs);
        } catch (e) {
            console.warn('Credential history ACL search failed, ACL-only edits will not appear:', e.message);
            aclResp = { results: [] };
        }

        var auditEntries = parseAuditResults(auditResp);
        var aclEntries = parseACLEntries(aclResp);

        // For per-credential history, we don't need the full access log correlation
        // (it's heavy and not specific to one credential). Add a simple status.
        auditEntries.forEach(function(entry) {
            if (!entry.status) {
                entry.status = getStatusCodeLabel(entry.status_code, entry.action);
            }
        });

        return mergeACLEntries(auditEntries, aclEntries);
    } catch (error) {
        if (error.status === 403 || /permission|capability|access denied/i.test(error.message || '')) {
            var permError = new Error('Insufficient permissions to query credential history. Required capability: search_filter:audit (or equivalent _audit index access).');
            permError.isPermissionError = true;
            throw permError;
        }
        throw error;
    }
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
    generateExportCSV,
    getAllCredentials,
    createCredential,
    updateCredential,
    deleteCredential,
    getCredentialPassword,
    getApps,
    getUsers,
    getRoles,
    fetchAuditLog,
    fetchCredentialHistory,
    DEFAULT_READ_ROLES,
    DEFAULT_WRITE_ROLES,
};
