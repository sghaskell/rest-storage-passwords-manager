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
        // KVStore data endpoints require JSON body (application/json).
        // All other endpoints use form-urlencoded (default for Splunk REST API).
        if (options.jsonBody) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.body);
        } else {
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

    // mtime (epoch seconds) may not be present — fall back to `updated` (ISO 8601)
    var mtime = entry.mtime || '';
    if (!mtime && entry.updated) {
        mtime = (Math.floor(new Date(entry.updated).getTime() / 1000)).toString();
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
        mtime: mtime,
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
    // Split on last colon to get realm:username — handles realms that contain colons
    var colonIdx = str.lastIndexOf(':');
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
    // This is reliable because the id reflects the actual config file location
    // whereas acl.owner / eai:acl.owner may reflect the merged ACL metadata.
    var namespaceOwner = 'nobody';
    var id = entry.id || '';
    if (id) {
        var idParts = id.split('/servicesNS/');
        if (idParts[1]) {
            namespaceOwner = idParts[1].split('/')[0];
        }
    }

    // mtime (epoch seconds) may not be present — fall back to `updated` (ISO 8601)
    var mtime = entry.mtime || '';
    if (!mtime && entry.updated) {
        mtime = (Math.floor(new Date(entry.updated).getTime() / 1000)).toString();
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
        mtime: mtime,
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
    const resolvedApp = encodeURIComponent(app || getCurrentApp() || 'search');
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
        // Flatten the created entry so callers get the actual namespaceOwner from entry.id
        // (not the form's owner value, which may differ from where Splunk actually stores it)
        var createdEntry = (created && created.entry) || null;
        if (createdEntry) {
            return flattenConfigEntry(createdEntry);
        }
        return null;
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
        const resolvedOwner = owner || 'nobody';
        const isUserScoped = sharing === 'user' && resolvedOwner !== 'nobody';

        if (isUserScoped) {
            // User-scoped credentials: update directly at the owner's namespace.
            // The ACL bump to app scope collides with any same-name app-scoped
            // credential ("Cannot overwrite existing app object").
            // configs/conf-passwords updates at the exact namespace level without
            // requiring a bump.
            const configStanza = encodeURIComponent(`credential:${stanzaKey}`);
            const ownerUrl = `/servicesNS/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(actualSourceApp)}/configs/conf-passwords/${configStanza}`;

            if (password) {
                await splunkdRequest(ownerUrl, {
                    method: 'POST',
                    body: { password, output_mode: 'json' },
                });
            }

            // Set final ACL at the owner's namespace
            const finalAclPath = buildAclPath(stanzaKey, resolvedOwner, targetApp);
            await splunkdRequest(finalAclPath, {
                method: 'POST',
                body: {
                    'perms.read': readRoles ? readRoles.join(',') : '',
                    'perms.write': writeRoles ? writeRoles.join(',') : resolvedOwner,
                    sharing: sharing,
                    owner: resolvedOwner,
                },
            });
        } else {
            // App-scoped or global: use the bump-to-app flow (legacy L522-554)

            // Step 1: ACL bump to app scope first
            const sourceAclPath = buildAclPath(stanzaKey, resolvedOwner, actualSourceApp);
            await splunkdRequest(sourceAclPath, {
                method: 'POST',
                body: {
                    'perms.read': readRoles ? readRoles.join(',') : '',
                    'perms.write': writeRoles ? writeRoles.join(',') : resolvedOwner,
                    sharing: 'app',
                    owner: resolvedOwner,
                },
            });

            // Step 2: Update password only
            // After the ACL bump (Step 1), the entry is visible at nobody regardless of
            // actual namespace. POSTing to the owner's namespace fails with "Cannot overwrite
            // existing app object" because the entry is now app-scoped and Splunk resolves
            // it at nobody. Always update at nobody — the ACL bump ensures visibility.
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
            const finalAclPath = buildAclPath(stanzaKey, resolvedOwner, targetApp);
            await splunkdRequest(finalAclPath, {
                method: 'POST',
                body: {
                    'perms.read': readRoles ? readRoles.join(',') : '',
                    'perms.write': writeRoles ? writeRoles.join(',') : resolvedOwner,
                    sharing: sharing,
                    owner: resolvedOwner,
                },
            });
        }
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

// ─── Password generator (extracted from CredentialForm) ───

/**
 * Generate a random password based on options.
 * @param {Object} options - { length, uppercase, lowercase, numbers, symbols }
 * @returns {string} generated password
 */
function generatePassword(options) {
    options = options || {};
    var length = options.length || 16;
    var chars = '';
    if (options.lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (options.uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (options.numbers) chars += '0123456789';
    if (options.symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!chars) chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var result = [];
    for (var i = 0; i < length; i++) {
        result.push(chars.charAt(Math.floor(Math.random() * chars.length)));
    }
    return result.join('');
}

// ─── Bulk password rotation ───

/**
 * Rotate passwords for a batch of credentials.
 * Sequential execution to avoid race conditions with ACL bump.
 * Expiry is persisted in KV Store — no realm rename dance.
 *
 * @param {Array} selectedRows - Array of credential objects
 * @param {Object} options - { mode: 'individual' | 'shared', generatorOptions: {...}, expiryStrategy, customExpiryDate }
 * @returns {Array} Per-credential results with status, oldPassword, newPassword, error
 */
async function rotatePasswords(selectedRows, options) {
    options = options || {};
    var mode = options.mode || 'individual';
    var genOpts = options.generatorOptions || {};
    var expiryStrategy = options.expiryStrategy || 'extend-original';
    var customExpiryDate = options.customExpiryDate || null;
    var results = [];

    // Generate shared password upfront if in shared mode
    var sharedPassword = null;
    if (mode === 'shared') {
        sharedPassword = generatePassword(genOpts);
    }

    // Ensure KVStore collection exists
    try { await ensureExpiryCollection(); } catch(e) { console.warn('[rotatePasswords] expiry KV unavailable:', e.message); }

    for (var i = 0; i < selectedRows.length; i++) {
        var cred = selectedRows[i];
        var nsOwner = cred.namespaceOwner || cred.owner || 'nobody';
        var credApp = cred.app || getCurrentApp() || 'search';
        var credSharing = cred.sharing || 'app';
        var credRealm = cred.realm || '';
        var credName = cred.name;

        // Compute new expiry if strategy changes it
        var newExpiryDate = null;
        var credExpiryDate = cred.expiryDate || null;

        if (expiryStrategy === 'extend-original' && credExpiryDate) {
            // Compute original period: expiryDate - mtime
            // Splunk mtime is epoch seconds (e.g. "1717427890.123456")
            var mtime = cred.mtime || '';
            var expiryDateParsed = new Date(credExpiryDate + 'T00:00:00');
            var mtimeParsed = null;
            if (mtime) {
                var mtimeNum = parseFloat(mtime);
                if (!isNaN(mtimeNum) && mtimeNum > 946684800) {
                    // Epoch seconds — convert to milliseconds
                    mtimeParsed = new Date(mtimeNum * 1000);
                } else {
                    // Try as-is (ISO format or milliseconds)
                    mtimeParsed = new Date(mtime);
                    if (isNaN(mtimeParsed.getTime())) {
                        mtimeParsed = null;
                    }
                }
            }
            if (!isNaN(expiryDateParsed.getTime()) && mtimeParsed && !isNaN(mtimeParsed.getTime())) {
                var originalMs = expiryDateParsed.getTime() - mtimeParsed.getTime();
                var originalDays = Math.max(1, Math.round(originalMs / 86400000));
                var today = new Date();
                today.setHours(0, 0, 0, 0);
                var newExpiry = new Date(today.getTime() + originalDays * 86400000);
                newExpiryDate = newExpiry.toISOString().split('T')[0];
            } else {
                // Fallback: mtime unavailable — default to 90 days from now
                var todayFallback = new Date();
                todayFallback.setHours(0, 0, 0, 0);
                var newExpiryFallback = new Date(todayFallback.getTime() + 90 * 86400000);
                newExpiryDate = newExpiryFallback.toISOString().split('T')[0];
            }
        } else if (expiryStrategy === 'custom' && customExpiryDate) {
            newExpiryDate = customExpiryDate;
        } else if (expiryStrategy !== 'keep-current') {
            // Numeric presets: "30", "60", "90", "180"
            var days = parseInt(expiryStrategy, 10);
            if (!isNaN(days) && days > 0) {
                var today2 = new Date();
                today2.setHours(0, 0, 0, 0);
                var newExpiry2 = new Date(today2.getTime() + days * 86400000);
                newExpiryDate = newExpiry2.toISOString().split('T')[0];
            }
        }

        // Step 1: Fetch old password
        var oldPassword = null;
        try {
            oldPassword = await getCredentialPassword(
                credName, credRealm, credApp, nsOwner, credSharing
            );
        } catch (e) {
            results.push({
                name: credName,
                realm: credRealm,
                app: credApp,
                oldPassword: null,
                newPassword: null,
                status: 'failed',
                error: 'Could not retrieve current password: ' + (e.message || 'unknown error')
            });
            continue;
        }

        if (!oldPassword) {
            results.push({
                name: credName,
                realm: credRealm,
                app: credApp,
                oldPassword: null,
                newPassword: null,
                status: 'failed',
                error: 'Could not retrieve current password'
            });
            continue;
        }

        // Step 2: Generate new password
        var newPassword;
        if (mode === 'shared') {
            newPassword = sharedPassword;
        } else {
            newPassword = generatePassword(genOpts);
        }

        // Validate non-empty (defensive)
        if (!newPassword || newPassword.length === 0) {
            // Retry once
            newPassword = generatePassword(genOpts);
        }

        // Step 3: Update password (always uses updateCredential — no realm rename)
        var aclReadArr = cred.aclRead ? cred.aclRead.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
        var aclWriteArr = cred.aclWrite ? cred.aclWrite.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

        try {
            await updateCredential(
                credName, credRealm, newPassword,
                aclReadArr, aclWriteArr,
                nsOwner, credApp, credSharing, credApp
            );

            // Update expiry in KV Store if strategy changed it
            if (newExpiryDate !== null) {
                try {
                    await setExpiryForCredential(cred, newExpiryDate);
                } catch (expErr) {
                    console.warn('[rotatePasswords] expiry update failed (non-fatal):', expErr.message);
                }
            }

            results.push({
                name: credName,
                realm: credRealm,
                app: credApp,
                oldPassword: oldPassword,
                newPassword: newPassword,
                newExpiryDate: newExpiryDate,
                status: 'success',
                error: null
            });
        } catch (e) {
            var errMsg = e.message || 'unknown error';
            results.push({
                name: credName,
                realm: credRealm,
                app: credApp,
                oldPassword: oldPassword,
                newPassword: null,
                status: 'failed',
                error: 'Rotation failed: ' + errMsg
            });
        }
    }

    return results;
}

/**
 * Scan credentials for duplicate (shared) passwords.
 *
 * Sequentially fetches each credential's clear-text password, groups by value,
 * and returns groups with 2+ entries. Results cached so repeated calls return
 * the cached scan without re-fetching.
 *
 * @param {Array} credentials - Array of credential objects from getAllCredentials()
 * @param {Function} [onProgress] - Optional callback(progress, total) for UI feedback
 * @returns {Object} { duplicateGroups, totalScanned, totalDuplicates, scanTime, warning }
 */
var _duplicateCache = null;

async function findDuplicatePasswords(credentials, onProgress) {
    // Use cached results if available — avoid re-scanning on every filter/sort
    if (_duplicateCache) {
        return _duplicateCache;
    }

    var MAX_SCAN = 200;
    var toScan = credentials.length > MAX_SCAN ? credentials.slice(0, MAX_SCAN) : credentials;
    var warning = credentials.length > MAX_SCAN
        ? 'Scanned ' + MAX_SCAN + ' of ' + credentials.length + ' credentials — increase limit or filter first'
        : null;

    var passwordMap = {};
    var total = toScan.length;

    for (var i = 0; i < total; i++) {
        var cred = toScan[i];
        try {
            var pwd = await getCredentialPassword(
                cred.name, cred.realm, cred.app,
                cred.namespaceOwner || cred.owner || 'nobody',
                cred.sharing || 'app'
            );
            // Skip empty/unretrievable passwords
            if (pwd && pwd !== '(unable to retrieve)' && pwd.trim() !== '') {
                var normalized = pwd.trim().toLowerCase();
                if (!passwordMap[normalized]) {
                    passwordMap[normalized] = [];
                }
                passwordMap[normalized].push({
                    name: cred.name,
                    realm: cred.realm || '',
                    app: cred.app || 'search',
                    owner: cred.namespaceOwner || cred.owner || 'nobody',
                    sharing: cred.sharing || 'app',
                    obfuscated: pwd.substring(0, 4) + '****'
                });
            }
        } catch (e) {
            // Skip credentials where password fetch fails
        }
        if (onProgress) onProgress(i + 1, total);
    }

    var duplicateGroups = [];
    var totalDuplicates = 0;
    Object.keys(passwordMap).forEach(function(normalized) {
        var group = passwordMap[normalized];
        if (group.length >= 2) {
            duplicateGroups.push({
                obfuscated: group[0].obfuscated,
                credentials: group,
                count: group.length
            });
            totalDuplicates += group.length;
        }
    });

    _duplicateCache = {
        duplicateGroups: duplicateGroups,
        totalScanned: total,
        totalDuplicates: totalDuplicates,
        scanTime: Date.now(),
        warning: warning,
        // Map of credential identifiers to their duplicate group info
        duplicateCredentialSet: new Set(duplicateGroups.flatMap(function(g) {
            return g.credentials.map(function(c) {
                return c.name + ':' + (c.realm || '') + ':' + (c.app || 'search') + ':' + (c.owner || 'nobody') + ':' + (c.sharing || 'app');
            });
        })),
        duplicateCredentialMap: Object.fromEntries(
            duplicateGroups.flatMap(function(g) {
                return g.credentials.map(function(c) {
                    var key = c.name + ':' + (c.realm || '') + ':' + (c.app || 'search') + ':' + (c.owner || 'nobody') + ':' + (c.sharing || 'app');
                    return [key, { obfuscated: g.obfuscated, count: g.count - 1 }];
                });
            })
        )
    };

    return _duplicateCache;
}

/**
 * Clear the duplicate cache — call after credentials change (create/delete/update/rotate).
 */
function clearDuplicateCache() {
    _duplicateCache = null;
}

/**
 * Check if a specific credential has a duplicate password.
 *
 * @param {Object} cred - Credential object
 * @param {Object} duplicateInfo - Result from findDuplicatePasswords()
 * @returns {Object|null} { obfuscated, sharedWith, label } or null
 */
function isDuplicateCredential(cred, duplicateInfo) {
    if (!duplicateInfo || !duplicateInfo.duplicateCredentialMap) return null;
    var key = (cred.name || '') + ':' + (cred.realm || '') + ':' + (cred.app || 'search') + ':' + (cred.namespaceOwner || cred.owner || 'nobody') + ':' + (cred.sharing || 'app');
    return duplicateInfo.duplicateCredentialMap[key] || null;
}

// ─── Column layout presets ───

/**
 * Column layout preset storage — localStorage only, per-browser.
 * Presets allow saving column visibility configurations as named layouts.
 */
var PRESETS_KEY = 'credential-manager-column-presets';

// Built-in presets created when localStorage is empty
var BUILTIN_PRESETS = [
    { name: 'Default', columns: ['name', 'realm', 'app', 'owner', 'rotation', 'aclRead', 'aclWrite', 'actions'] },
    { name: 'Minimal', columns: ['name', 'actions'] },
    { name: 'Security', columns: ['name', 'app', 'owner', 'rotation', 'aclRead', 'aclWrite', 'actions'] }
];

/**
 * Load all saved presets from localStorage.
 * Returns array of { name, columns: [...] }.
 * If no presets exist, returns built-in presets.
 */
function loadPresets() {
    try {
        var stored = localStorage.getItem(PRESETS_KEY);
        if (stored) {
            var parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.filter(function(p) {
                    return p && p.name && Array.isArray(p.columns) && p.columns.length > 0;
                });
            }
        }
    } catch (e) {
        console.warn('Failed to load column presets:', e);
    }
    // Return built-in presets
    return BUILTIN_PRESETS.slice();
}

/**
 * Save a preset to localStorage.
 * Replaces existing preset with same name (rename in place).
 * Enforces minimum of 1 visible column (always keeps "name").
 */
function savePreset(name, columns) {
    try {
        var presets = loadPresets();
        var filtered = columns.filter(function(c) { return c; });
        // Enforce minimum: always keep "name" if user tries to hide everything
        if (!filtered.some(function(c) { return c === 'name'; })) {
            filtered = ['name'].concat(filtered);
        }
        if (presets.some(function(p) { return p.name === name; })) {
            presets = presets.map(function(p) {
                return p.name === name ? { name: name, columns: filtered } : p;
            });
        } else {
            presets.push({ name: name, columns: filtered });
        }
        localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
        return true;
    } catch (e) {
        console.warn('Failed to save column preset:', e);
        return false;
    }
}

/**
 * Delete a preset from localStorage.
 * Does not delete built-in presets unless user-created overrides exist.
 */
function deletePreset(name) {
    try {
        var presets = loadPresets();
        var filtered = presets.filter(function(p) { return p.name !== name; });
        localStorage.setItem(PRESETS_KEY, JSON.stringify(filtered));
        return true;
    } catch (e) {
        console.warn('Failed to delete column preset:', e);
        return false;
    }
}

/**
 * Get the columns array for a named preset.
 * Returns null if preset does not exist.
 */
function applyPreset(name) {
    try {
        var presets = loadPresets();
        var found = presets.find(function(p) { return p.name === name; });
        return found ? found.columns.slice() : null;
    } catch (e) {
        return null;
    }
}

/**
 * Rename a preset.
 */
function renamePreset(oldName, newName) {
    try {
        var presets = loadPresets();
        if (presets.some(function(p) { return p.name === newName; })) {
            return false; // name conflict
        }
        var updated = presets.map(function(p) {
            return p.name === oldName ? Object.assign({}, p, { name: newName }) : p;
        });
        localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
        return true;
    } catch (e) {
        console.warn('Failed to rename column preset:', e);
        return false;
    }
}

// ─── Expiry threshold configuration ──────────────────────────────────────────

const DEFAULT_DUE_SOON_DAYS = 7;
const STORAGE_KEY = 'expiry-threshold-days';

function getDueSoonThreshold() {
    try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            var days = parseInt(stored, 10);
            if (days >= 1 && days <= 30) return days;
        }
    } catch (e) {
        console.warn('[expiry] Failed to read threshold:', e);
    }
    return DEFAULT_DUE_SOON_DAYS;
}

function setDueSoonThreshold(days) {
    var clamped = Math.max(1, Math.min(30, Math.round(days)));
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch (e) {}
    return clamped;
}

/**
 * Get rotation status for a credential.
 * Returns 'ok' | 'due-soon' | 'overdue' | 'none'
 * Optional thresholdDays overrides the localStorage default.
 */
function getRotationStatus(expiryDate, thresholdDays) {
    if (!expiryDate) return 'none';
    var effectiveThreshold = thresholdDays !== undefined ? thresholdDays : getDueSoonThreshold();
    var expiryTime = new Date(expiryDate + 'T00:00:00').getTime();
    var now = Date.now();
    var msUntilExpiry = expiryTime - now;
    var daysUntilExpiry = msUntilExpiry / (1000 * 60 * 60 * 24);
    if (msUntilExpiry < 0) return 'overdue';
    if (daysUntilExpiry <= effectiveThreshold) return 'due-soon';
    return 'ok';
}

// ─── Email alert CRUD (Splunk saved searches) ──────────────────────────────────

/**
 * Reload the saved search scheduler so changes take effect immediately
 * (no Splunk restart required).
 */
async function reloadSavedSearches() {
    await splunkdRequest(
        '/servicesNS/nobody/rest-storage-passwords-manager/saved/searches/_reload',
        { method: 'POST', body: { output_mode: 'json' } }
    );
}

async function createOrUpdateExpiryAlert(config) {
    var body = {
        search: '| inputlookup credential_expiry | ' +
            'where expiry_date != "" | ' +
            'rex field=credential_key "(?<realm>[^|]*)\\|(?<username>[^|]*)\\|(?<app>[^|]*)\\|(?<owner>[^|]*)\\|(?<sharing>[^|]*)" | ' +
            'eval days_remaining=round((strptime(expiry_date, "%Y-%m-%d") + 86400 - now()) / 86400, 0) | ' +
            'where days_remaining <= ' + config.thresholdDays + ' | ' +
            'sort days_remaining | ' +
            'table username realm app owner sharing expiry_date days_remaining',
        disabled: config.enabled ? '0' : '1',
        is_scheduled: '1',
        cron_schedule: config.cronMinute + ' ' + config.cronHour + ' * * *',
        actions: 'email',
        'action.email': '1',
        'action.email.to': config.recipients,
        'action.email.cc': config.ccRecipients || '',
        'action.email.subject': config.emailSubject || 'Credential Expiry Alert',
        'action.email.send_if_no_results': config.sendIfNoResults ? '1' : '0',
        'action.email.inline': config.includeResultsInline ? '1' : '0',
        'action.email.results_type': 'csv',
        description: 'Alert when stored credentials approach or past their expiry date',
    };
    var endpoint = '/servicesNS/nobody/rest-storage-passwords-manager/saved/searches';
    var updateEndpoint = endpoint + '/credential-expiry-alert';
    var needsCreate = true;
    try {
        var existing = await splunkdRequest(updateEndpoint, { method: 'GET' });
        if (existing) {
            needsCreate = false;
            await splunkdRequest(updateEndpoint, { method: 'POST', body: body });
        }
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    if (needsCreate) {
        await splunkdRequest(endpoint, {
            method: 'POST',
            body: Object.assign({}, body, { name: 'credential-expiry-alert' }),
        });
    }
    await reloadSavedSearches();
}

// Dispatch a saved search for immediate execution (test send)
async function dispatchSavedSearch(name) {
    await splunkdRequest(
        '/servicesNS/nobody/rest-storage-passwords-manager/saved/searches/' + encodeURIComponent(name) + '/dispatch',
        { method: 'POST' }
    );
}

async function getExpiryAlert() {
    try {
        return await splunkdRequest('/servicesNS/nobody/rest-storage-passwords-manager/saved/searches/credential-expiry-alert', {
            method: 'GET',
        });
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }
}

async function deleteExpiryAlert() {
    await splunkdRequest('/servicesNS/nobody/rest-storage-passwords-manager/saved/searches/credential-expiry-alert', {
        method: 'DELETE',
    });
    await reloadSavedSearches();
}

// ─── Password Policy (localStorage + Splunk sync) ───────────────────────────

const POLICY_KEY = 'password-policy-config';
const POLICY_COLLECTION = 'password_policy';

const DEFAULT_POLICY = {
    enabled: false,
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireDigits: true,
    requireSpecial: true,
    minDigits: 1,
    minUppercase: 1,
    minLowercase: 1,
    minSpecial: 1,
    bannedPasswords: [],
};

function loadPolicy() {
    // Load from localStorage only — it's synced by savePolicy.
    // For async KV Store load, use loadPolicyFromKVStore() instead.
    try {
        var stored = localStorage.getItem(POLICY_KEY);
        if (stored) {
            var parsed = JSON.parse(stored);
            return Object.assign({}, DEFAULT_POLICY, parsed);
        }
    } catch (e) {
        console.warn('Failed to load password policy:', e);
    }
    return Object.assign({}, DEFAULT_POLICY);
}

function savePolicy(policy) {
    try {
        localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
    } catch (e) {
        console.warn('Failed to save password policy:', e);
    }
}

/**
 * Ensure the password policy KVStore collection exists.
 */
async function ensurePolicyCollection() {
    return ensureCollection(POLICY_COLLECTION);
}

/**
 * Load password policy from KVStore.
 * Falls back to localStorage if KVStore is unavailable.
 */
async function loadPolicyFromKVStore() {
    try {
        await ensurePolicyCollection();
        var response = await splunkdRequest(KVSTORE_DATA + '/' + POLICY_COLLECTION, {
            method: 'GET',
        });
        var entries = response.results || response;
        if (Array.isArray(entries) && entries.length > 0) {
            var stored = entries[0];
            var policy = {
                enabled: stored.enabled,
                minLength: stored.minLength || stored.min_length,
                maxLength: stored.maxLength || stored.max_length,
                requireUppercase: stored.requireUppercase,
                requireLowercase: stored.requireLowercase,
                requireDigits: stored.requireDigits,
                requireSpecial: stored.requireSpecial,
                minUppercase: stored.minUppercase,
                minLowercase: stored.minLowercase,
                minDigits: stored.minDigits,
                minSpecial: stored.minSpecial,
                bannedPasswords: stored.bannedPasswords ? stored.bannedPasswords.split(',') : [],
            };
            // Save to localStorage cache
            savePolicy(policy);
            return policy;
        }
    } catch (e) {
        console.warn('[POLICY] KVStore load failed, using localStorage:', e.message);
    }
    // Fallback: migrate from localStorage if available, otherwise defaults
    var local = loadPolicy();
    if (local && Object.keys(local).length > 0) {
        try {
            await savePolicyToKVStore(local);
            console.log('[POLICY] Migrated localStorage policy to KVStore');
        } catch (saveErr) {
            console.warn('[POLICY] Migration failed:', saveErr.message);
        }
        return local;
    }
    return Object.assign({}, DEFAULT_POLICY);
}

/**
 * Save password policy to KVStore (and sync to localStorage cache).
 */
async function savePolicyToKVStore(policy) {
    await ensurePolicyCollection();
    var body = {
        _key: 'default',
        policy_key: 'default',
        enabled: policy.enabled,
        min_length: policy.minLength,
        max_length: policy.maxLength,
        requireUppercase: policy.requireUppercase,
        requireLowercase: policy.requireLowercase,
        requireDigits: policy.requireDigits,
        requireSpecial: policy.requireSpecial,
        minUppercase: policy.minUppercase,
        minLowercase: policy.minLowercase,
        minDigits: policy.minDigits,
        minSpecial: policy.minSpecial,
        bannedPasswords: (policy.bannedPasswords || []).join(','),
    };
    try {
        await splunkdRequest(KVSTORE_DATA + '/' + POLICY_COLLECTION, {
            method: 'POST',
            body: body,
            jsonBody: true,
        });
    } catch (e) {
        // 409 means the document exists — update it instead
        if (e.status === 409) {
            await splunkdRequest(KVSTORE_DATA + '/' + POLICY_COLLECTION + '/default', {
                method: 'POST',
                body: body,
                jsonBody: true,
            });
        } else {
            throw e;
        }
    }
    // Sync to localStorage cache
    savePolicy(policy);
}

/**
 * Validate a password against the current policy.
 * @param {string} password - The password to validate
 * @param {Object} policy - Policy config (or null to use stored)
 * @returns {string[]} Array of error strings (empty = valid)
 */
function validatePasswordAgainstPolicy(password, policy) {
    policy = policy || loadPolicy();
    if (!policy.enabled || !password) return [];

    var errors = [];
    var len = password.length;

    if (len < policy.minLength) {
        errors.push('Password must be at least ' + policy.minLength + ' characters (got ' + len + ')');
    }
    if (len > policy.maxLength) {
        errors.push('Password must be at most ' + policy.maxLength + ' characters (got ' + len + ')');
    }

    if (policy.requireUppercase) {
        var upperCount = (password.match(/[A-Z]/g) || []).length;
        if (upperCount < policy.minUppercase) {
            errors.push('Password must contain at least ' + policy.minUppercase + ' uppercase letter(s)');
        }
    }
    if (policy.requireLowercase) {
        var lowerCount = (password.match(/[a-z]/g) || []).length;
        if (lowerCount < policy.minLowercase) {
            errors.push('Password must contain at least ' + policy.minLowercase + ' lowercase letter(s)');
        }
    }
    if (policy.requireDigits) {
        var digitCount = (password.match(/[0-9]/g) || []).length;
        if (digitCount < policy.minDigits) {
            errors.push('Password must contain at least ' + policy.minDigits + ' digit(s)');
        }
    }
    if (policy.requireSpecial) {
        var specialCount = (password.match(/[^A-Za-z0-9]/g) || []).length;
        if (specialCount < policy.minSpecial) {
            errors.push('Password must contain at least ' + policy.minSpecial + ' special character(s)');
        }
    }

    if (policy.bannedPasswords && policy.bannedPasswords.length > 0) {
        var pwdLower = password.toLowerCase();
        var banned = policy.bannedPasswords.map(function(s) { return s.toLowerCase(); });
        if (banned.indexOf(pwdLower) !== -1) {
            errors.push('This password is on the banned list');
        }
    }

    return errors;
}

// ─── Credential Expiry (KVStore) ──────────────────────────────────────────
// Expiry dates are stored in a KVStore collection instead of embedding in the realm.
// This avoids the destructive rename dance (create new + delete old) when updating expiry.

const EXPIRY_COLLECTION = 'credential_expiry';

/**
 * Ensure the expiry KVStore collection exists.
 */
async function ensureExpiryCollection() {
    return ensureCollection(EXPIRY_COLLECTION);
}

/**
 * Set expiry date for a credential in KVStore.
 * Pass empty string or null to clear expiry.
 * Retries on transient errors (500/503) with exponential backoff.
 */
async function setExpiryForCredential(credential, expiryDate) {
    await ensureExpiryCollection();
    var key = tagCredKey(credential);
    var body = {
        _key: key,
        credential_key: key,
        expiry_date: expiryDate || '',
    };
    await kvStoreSetDocument(EXPIRY_COLLECTION, key, body);
    // Verify: read back what we just wrote
    try {
        var verifyData = await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key), { method: 'GET' });
        if (!verifyData || !verifyData.expiry_date) {
            throw new Error('Expiry write verification failed — data not persisted');
        }
    } catch (vErr) {
        console.error('[EXPIRY][VERIFY] FAILED:', vErr.message);
    }
}

/**
 * Get expiry date for a credential from KVStore.
 * Returns string (ISO date) or null.
 */
async function getExpiryForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        var data = await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'GET',
        });
        var doc = data;
        if (doc && doc.expiry_date) {
            return doc.expiry_date;
        }
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    return null;
}

/**
 * Batch fetch all expiry data for enrichment.
 * Returns Object: cred_key → expiry_date string.
 */
async function getAllExpiryData() {
    try {
        var data = await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION, {
            method: 'GET',
        });
        var docs = Array.isArray(data) ? data : (data.entries || []);
        var result = {};
        docs.forEach(function(doc) {
            if (doc.credential_key && doc.expiry_date) {
                result[doc.credential_key] = doc.expiry_date;
            }
        });
        return result;
    } catch (e) {
        if (e.status === 404) return {};
        throw e;
    }
}

/**
 * Delete expiry entry for a credential (cleanup on credential delete).
 * Retries on transient errors (500/503) with exponential backoff.
 */
async function deleteExpiryForCredential(credential) {
    var key = tagCredKey(credential);
    var url = KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key);

    for (var attempt = 0; attempt < 3; attempt++) {
        try {
            await splunkdRequest(url, { method: 'DELETE' });
            return; // Success
        } catch (e) {
            if (e.status === 404 || e.status === 400) {
                return; // Not found or bad key — not an error
            }
            if (attempt < 2 && (e.status === 500 || e.status === 503)) {
                await new Promise(function(resolve) { setTimeout(resolve, 200 * Math.pow(2, attempt)); });
                continue;
            }
            throw e;
        }
    }
}

/**
 * Resolve expiry date for a credential from KVStore.
 * @param {Object} cred - Credential object
 * @param {Object} [expiryMap] - Pre-fetched expiry map from getAllExpiryData() (optional)
 * @returns {string|null} ISO date string or null
 */
function resolveExpiryDate(cred, expiryMap) {
    if (expiryMap) {
        var key = tagCredKey(cred);
        if (expiryMap[key]) return expiryMap[key];
    }
    return null;
}

// ─── Credential Tagging (KVStore) ─────────────────────────────────────────

const TAGS_COLLECTION = 'credential_tags';
const TAG_DEFS_COLLECTION = 'tag_definitions';

// KVStore collections live at nobody/rest-storage-passwords-manager namespace.
// Splunk requires 'nobody' user context for collection config operations.
// Data operations work at any namespace.
/**
 * Splunk 10.2 KV Store endpoints (replaces deprecated /data/collections).
 * - Collection management: /servicesNS/nobody/rest-storage-passwords-manager/storage/collections/config
 * - Data operations: /servicesNS/nobody/rest-storage-passwords-manager/storage/collections/data/<collection>
 * - Documents: /servicesNS/nobody/rest-storage-passwords-manager/storage/collections/data/<collection>/<key>
 */
const KVSTORE_CONFIG = '/servicesNS/nobody/rest-storage-passwords-manager/storage/collections/config';
const KVSTORE_DATA = '/servicesNS/nobody/rest-storage-passwords-manager/storage/collections/data';

/**
 * Hash tag name to consistent color from fixed palette.
 */
function hashToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var palette = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
        '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
    ];
    return palette[Math.abs(hash) % palette.length];
}

/**
 * Poll the KVStore config endpoint until the collection reports "created" state.
 * Splunk 10.2: after POST to /storage/collections/config, the collection needs
 * a moment to initialize its internal index. During this window, data POSTs fail with 500.
 * Falls back to testing the data endpoint directly if state polling doesn't work.
 */
async function waitForCollectionReady(name, maxAttempts, intervalMs) {
    maxAttempts = maxAttempts || 15;   // Up to 3 seconds
    intervalMs = intervalMs || 200;
    var configUrl = KVSTORE_CONFIG + '/' + name;
    var dataUrl = KVSTORE_DATA + '/' + name;

    for (var i = 0; i < maxAttempts; i++) {
        try {
            // Check config state
            var config = await splunkdRequest(configUrl, { method: 'GET' });
            var state = null;
            // Handle both { entry: [...] } and { entry: {...} } response shapes
            var entry = config && config.entry;
            if (Array.isArray(entry) && entry[0]) {
                state = entry[0].content && entry[0].content.state;
            } else if (entry && entry.content) {
                state = entry.content.state;
            }
            if (state === 'created') {
                return true;
            }
            // Also try the data endpoint — if it responds without error, collection is ready
            try {
                await splunkdRequest(dataUrl, { method: 'GET' });
                // Data endpoint responded — collection is ready
                return true;
            } catch (dataErr) {
                // 404 means collection doesn't exist yet (shouldn't happen here)
                // 500 means collection is still initializing
                if (dataErr.status !== 500) throw dataErr;
            }
        } catch (e) {
            // Collection still initializing — GET may 500 or 404 briefly
        }
        await new Promise(function(resolve) { setTimeout(resolve, intervalMs); });
    }
    // Last resort: collection exists but state unknown — assume it's ready
    // The retry loop in kvStoreSetDocument will catch any remaining issues
    return true;
}

/**
 * POST or update a document in a KVStore collection with retry logic.
 * Handles: 409 (duplicate → switch to key path), 404 (collection missing → ensure + retry),
 * 500/503 (transient → retry with backoff).
 */
async function kvStoreSetDocument(collectionName, key, body) {
    var maxAttempts = 3;
    var baseUrl = KVSTORE_DATA + '/' + collectionName;
    var useKeyPath = false;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (useKeyPath) {
                await splunkdRequest(baseUrl + '/' + encodeURIComponent(key), {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            } else {
                await splunkdRequest(baseUrl, {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            }
            return; // Success
        } catch (e) {
            if (e.status === 409) {
                // Document already exists — switch to update path
                useKeyPath = true;
                continue; // Retry immediately with the key path
            }
            if (e.status === 404 && !useKeyPath) {
                // Collection might not exist — ensure it exists and retry
                await ensureCollection(collectionName);
                continue; // Retry after ensuring collection
            }
            if (attempt < maxAttempts - 1 && (e.status === 500 || e.status === 503 || e.status === 400)) {
                // Transient error (collection not ready, etc.) — retry with backoff
                await new Promise(function(resolve) { setTimeout(resolve, backoff); });
                continue;
            }
            // Max attempts reached or non-retryable error
            throw e;
        }
    }
}

// Deduplicate in-flight collection creation requests
var collectionCreationPromises = {};

/**
 * Ensure a KVStore collection exists. Create if missing.
 * Collections are pre-defined in default/data/lookup/collections.conf.
 * The ensureCollection fallback handles cases where the collection hasn't been deployed yet.
 * @param {string} name - Collection name
 * @param {object} [options] - Optional { fields: { fieldName: 'string' } }
 */
async function ensureCollection(name, options) {
    var fields = (options && options.fields) || {};
    var configUrl = KVSTORE_CONFIG + '/' + name;
    var collectionExists = false;
    try {
        var config = await splunkdRequest(configUrl, { method: 'GET' });
        // Only consider it "exists" if we get a valid response with entry data
        if (config && config.entry) {
            collectionExists = true;
        }
    } catch (e) {
        // GET failed — collection likely doesn't exist (404, 400, or other)
    }

    if (collectionExists) {
        return true;
    }

    // If another request is already creating this collection, wait for it
    if (collectionCreationPromises[name]) {
        try {
            await collectionCreationPromises[name];
            return true;
        } catch (waitErr) {
            // Creation failed, fall through to try ourselves
        }
        delete collectionCreationPromises[name];
    }

    var createPromise = (async function() {
        try {
            await splunkdRequest(KVSTORE_CONFIG, {
                method: 'POST',
                body: Object.assign({ name: name }, fields),
            });
            // Wait for the collection to finish initializing
            await waitForCollectionReady(name);
        } catch (createErr) {
            if (createErr.status === 409) {
                // Someone else created it — wait for it to be ready too
                await waitForCollectionReady(name);
                return;
            }
            throw createErr;
        }
    })();

    collectionCreationPromises[name] = createPromise;
    try {
        await createPromise;
    } finally {
        delete collectionCreationPromises[name];
    }
    return true;
}

/**
 * Initialize tag collections lazily.
 * Splunk 10.2: fields auto-inferred from first document, no schema.
 */
async function ensureTagCollections() {
    await ensureCollection(TAGS_COLLECTION);
    await ensureCollection(TAG_DEFS_COLLECTION, { fields: { tag_name: 'string', color: 'string', description: 'string' } });
}

/**
 * Build unique key from credential object.
 * Format: realm|name|app|owner|sharing
 * URL-safe — uses | delimiter (NOT :) to avoid collision with realm strings
 * like "prod".
 */
function tagCredKey(cred) {
    return (cred.realm || '') + '|' + (cred.name || '') + '|'+
           (cred.app || 'search') + '|'+
           (cred.namespaceOwner || cred.owner || 'nobody') + '|'+
           (cred.sharing || 'app');
}

/**
 * Set tags for a credential (replace all existing tags).
 */
async function setTagsForCredential(credential, tags) {
    await ensureTagCollections();
    var key = tagCredKey(credential);
    var cleanTags = tags
        .map(function(t) { return t.trim().toLowerCase(); })
        .filter(Boolean)
        .slice(0, 5);
    for (var i = 0; i < cleanTags.length; i++) {
        var tag = cleanTags[i];
        if (!/^[a-z0-9_-]{1,50}$/.test(tag)) {
            throw new Error('Invalid tag name: ' + tag + ' — use only lowercase letters, numbers, hyphens, underscores (max 50 chars)');
        }
    }

    var existingDefs = await getAllTagDefinitions();
    for (var j = 0; j < cleanTags.length; j++) {
        var tag = cleanTags[j];
        if (!existingDefs.some(function(d) { return d.tag_name === tag; })) {
            await kvStoreSetDocument(TAG_DEFS_COLLECTION, tag, {
                _key: tag,
                tag_name: tag,
                color: hashToColor(tag),
            });
        }
    }

    await kvStoreSetDocument(TAGS_COLLECTION, key, {
        _key: key,
        credential_key: key,
        tags: JSON.stringify(cleanTags),
    });

    // Verify: read back what we just wrote
    try {
        var verifyUrl = KVSTORE_DATA + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key);
        var verifyData = await splunkdRequest(verifyUrl, { method: 'GET' });
    } catch (vErr) {
        console.error('[TAGS][SAVE] verify FAILED:', vErr.message);
    }
    return cleanTags;
}

/**
 * Get tags for a credential.
 */
async function getTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        var url = KVSTORE_DATA + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key);
        var data = await splunkdRequest(url, {
            method: 'GET',
        });
        // Splunk 10.2 KVStore returns flat object for single doc (not {items: [...]}):
        // { _key: "...", tags: "[\"t1\"]", ... }
        var doc = data;
        if (doc && doc.tags) {
            var parsed = JSON.parse(doc.tags);
            return parsed;
        }
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    return [];
}

/**
 * Remove a specific tag from a credential.
 */
async function removeTagFromCredential(credential, tagToRemove) {
    var existing = await getTagsForCredential(credential);
    var updated = existing.filter(function(t) {
        return t !== tagToRemove.toLowerCase();
    });
    if (updated.length === existing.length) return existing;
    return setTagsForCredential(credential, updated);
}

/**
 * Bulk add tags to multiple credentials (preserves existing tags).
 * @param {Array} credentials - Array of credential objects
 * @param {Array} tagNames - Array of tag names to add
 * @param {Function} onProgress - Optional progress callback(index, total)
 * @returns {Array} Results array
 */
async function bulkAddTags(credentials, tagNames, onProgress) {
    var results = [];
    var cleanNewTags = tagNames
        .map(function(t) { return t.trim().toLowerCase(); })
        .filter(Boolean)
        .slice(0, 5);

    // Ensure all new tag definitions exist
    var existingDefs = await getAllTagDefinitions();
    for (var i = 0; i < cleanNewTags.length; i++) {
        var tag = cleanNewTags[i];
        if (!existingDefs.some(function(d) { return d.tag_name === tag; })) {
            await kvStoreSetDocument(TAG_DEFS_COLLECTION, tag, {
                _key: tag,
                tag_name: tag,
                color: hashToColor(tag),
            });
        }
    }

    for (var j = 0; j < credentials.length; j++) {
        var cred = credentials[j];
        try {
            var existing = await getTagsForCredential(cred);
            var merged = existing.concat(cleanNewTags);
            // Deduplicate
            merged = merged.filter(function(tag, idx) {
                return merged.indexOf(tag) === idx;
            }).slice(0, 5);
            await setTagsForCredential(cred, merged);
            results.push({ credential: cred, success: true, tags: merged });
        } catch (e) {
            results.push({ credential: cred, success: false, error: e.message });
        }
        if (onProgress) onProgress(j + 1, credentials.length);
    }
    return results;
}

/**
 * Bulk remove tags from multiple credentials.
 * @param {Array} credentials - Array of credential objects
 * @param {Array} tagNames - Array of tag names to remove
 * @param {Function} onProgress - Optional progress callback(index, total)
 * @returns {Array} Results array
 */
async function bulkRemoveTags(credentials, tagNames, onProgress) {
    var results = [];
    var tagsToRemove = tagNames
        .map(function(t) { return t.trim().toLowerCase(); })
        .filter(Boolean);

    for (var j = 0; j < credentials.length; j++) {
        var cred = credentials[j];
        try {
            var existing = await getTagsForCredential(cred);
            var updated = existing.filter(function(t) {
                return tagsToRemove.indexOf(t) === -1;
            });
            await setTagsForCredential(cred, updated);
            results.push({ credential: cred, success: true, tags: updated });
        } catch (e) {
            results.push({ credential: cred, success: false, error: e.message });
        }
        if (onProgress) onProgress(j + 1, credentials.length);
    }
    return results;
}

/**
 * Get all tag definitions (tag name → color mapping).
 */
async function getAllTagDefinitions() {
    try {
        var data = await splunkdRequest(KVSTORE_DATA + '/' + TAG_DEFS_COLLECTION, {
            method: 'GET',
        });
        // Splunk 10.2 KVStore returns plain array (not {items: [...]})
        var docs = Array.isArray(data) ? data : (data.entries || []);
        return docs.map(function(doc) {
            return { tag_name: doc.tag_name, color: doc.color, description: doc.description || '' };
        });
    } catch (e) {
        if (e.status === 404) return [];
        throw e;
    }
}

/**
 * Get all tag-to-credential mappings (batch fetch for enrichment).
 * Returns Object: cred_key → [tag strings]
 */
async function getAllTagsData() {
    try {
        var data = await splunkdRequest(KVSTORE_DATA + '/' + TAGS_COLLECTION, {
            method: 'GET',
        });
        // Splunk 10.2 KVStore returns plain array (not {items: [...]})
        var docs = Array.isArray(data) ? data : (data.entries || []);
        var result = {};
        docs.forEach(function(doc) {
            if (doc.credential_key && doc.tags) {
                result[doc.credential_key] = JSON.parse(doc.tags);
            }
        });
        return result;
    } catch (e) {
        if (e.status === 404) return {};
        throw e;
    }
}

/**
 * Delete tags for a credential (cleanup on credential delete).
 */
async function deleteTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        await splunkdRequest(KVSTORE_DATA + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
    }
}

/**
 * Create a tag definition (name + color + optional description).
 */
async function createTagDefinition(tagName, color, description) {
    await ensureTagCollections();
    var cleanName = tagName.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,50}$/.test(cleanName)) {
        throw new Error('Invalid tag name: ' + cleanName);
    }
    var finalColor = color || hashToColor(cleanName);
    var doc = {
        _key: cleanName,
        tag_name: cleanName,
        color: finalColor
    };
    if (description !== undefined && description !== null && description !== '') {
        doc.description = String(description).substring(0, 200);
    }
    await kvStoreSetDocument(TAG_DEFS_COLLECTION, cleanName, doc);
    return { tag_name: cleanName, color: finalColor, description: doc.description || '' };
}

/**
 * Rename a tag definition (preserves color and description).
 */
async function renameTagDefinition(oldName, newName) {
    await ensureTagCollections();
    var cleanNew = newName.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,50}$/.test(cleanNew)) {
        throw new Error('Invalid tag name: ' + cleanNew);
    }
    var oldClean = oldName.trim().toLowerCase();
    if (oldClean === cleanNew) return;
    var oldData = await getAllTagDefinitions();
    var oldDef = oldData.find(function(d) { return d.tag_name === oldClean; });
    if (!oldDef) throw new Error('Tag definition not found: ' + oldName);
    var exists = oldData.find(function(d) { return d.tag_name === cleanNew; });
    if (exists) throw new Error('Tag already exists: ' + cleanNew);
    var color = (oldDef && oldDef.color) ? oldDef.color : hashToColor(cleanNew);
    var doc = {
        _key: cleanNew,
        tag_name: cleanNew,
        color: color
    };
    if (oldDef && oldDef.description) {
        doc.description = oldDef.description;
    }
    await kvStoreSetDocument(TAG_DEFS_COLLECTION, cleanNew, doc);
    await deleteTagDefinition(oldClean);
    var allTagsData = await getAllTagsData();
    for (var credKey in allTagsData) {
        if (!allTagsData.hasOwnProperty(credKey)) continue;
        var tags = allTagsData[credKey] || [];
        var idx = tags.indexOf(oldClean);
        if (idx !== -1) {
            tags[idx] = cleanNew;
            await setTagsForCredential({ id: credKey }, tags);
        }
    }
}

/**
 * Update tag color (preserves description).
 */
async function updateTagColor(tagName, newColor) {
    var defs = await getAllTagDefinitions();
    var existing = defs.find(function(d) { return d.tag_name === tagName.toLowerCase(); });
    if (!existing) throw new Error('Tag definition not found: ' + tagName);
    var doc = {
        _key: tagName.toLowerCase(),
        tag_name: tagName.toLowerCase(),
        color: newColor
    };
    if (existing.description) {
        doc.description = existing.description;
    }
    await kvStoreSetDocument(TAG_DEFS_COLLECTION, tagName.toLowerCase(), doc);
    return { tag_name: tagName, color: newColor };
}

/**
 * Update tag description (preserves color).
 */
async function updateTagDescription(tagName, newDescription) {
    var defs = await getAllTagDefinitions();
    var existing = defs.find(function(d) { return d.tag_name === tagName.toLowerCase(); });
    if (!existing) throw new Error('Tag definition not found: ' + tagName);
    var color = (existing && existing.color) ? existing.color : hashToColor(tagName.toLowerCase());
    var doc = {
        _key: tagName.toLowerCase(),
        tag_name: tagName.toLowerCase(),
        color: color
    };
    if (newDescription !== undefined && newDescription !== null) {
        doc.description = String(newDescription).substring(0, 200);
    }
    await kvStoreSetDocument(TAG_DEFS_COLLECTION, tagName.toLowerCase(), doc);
    return { tag_name: tagName, description: doc.description || '' };
}

/**
 * Delete a tag definition and cascade: remove from all credential tag assignments.
 */
async function deleteTagDefinitionWithCascade(tagName) {
    var cleanName = tagName.trim().toLowerCase();
    var allTagsData = await getAllTagsData();
    for (var credKey in allTagsData) {
        if (!allTagsData.hasOwnProperty(credKey)) continue;
        var tags = allTagsData[credKey] || [];
        var filtered = tags.filter(function(t) { return t !== cleanName; });
        if (filtered.length !== tags.length) {
            await setTagsForCredential({ id: credKey }, filtered);
        }
    }
    await deleteTagDefinition(cleanName);
}

/**
 * Delete a tag definition.
 */
async function deleteTagDefinition(tagName) {
    try {
        await splunkdRequest(KVSTORE_DATA + '/' + TAG_DEFS_COLLECTION + '/' + encodeURIComponent(tagName), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
    }
}

// ─── Role-Based Access (cached capabilities + audit helpers) ───────────────

var _rolesCapabilitiesCache = null;
var _rolesCapabilitiesCacheTime = 0;
var ROLES_CACHE_TTL = 300000; // 5 minutes

/**
 * Fetch all roles with their capabilities.
 * Returns array of { name, capabilities: [], isAdmin: bool }
 * Cached for 5 minutes.
 */
async function getRolesWithCapabilities() {
    if (_rolesCapabilitiesCache && (Date.now() - _rolesCapabilitiesCacheTime < ROLES_CACHE_TTL)) {
        return _rolesCapabilitiesCache;
    }

    try {
        var data = await splunkdRequest('/servicesNS/-/-/authorization/roles', { method: 'GET' });
        var roles = (data.entry || []).map(function(e) {
            var caps = e.content?.capabilities || [];
            var isAdmin = caps.indexOf('admin_all_objects') !== -1;
            return {
                name: e.name,
                capabilities: caps,
                isAdmin: isAdmin,
            };
        });
        _rolesCapabilitiesCache = roles;
        _rolesCapabilitiesCacheTime = Date.now();
        return roles;
    } catch (err) {
        console.warn('Failed to fetch roles with capabilities:', err.message);
        return [];
    }
}

/**
 * Clear the roles capabilities cache (call after role changes).
 */
function clearRolesCapabilitiesCache() {
    _rolesCapabilitiesCache = null;
    _rolesCapabilitiesCacheTime = 0;
}

/**
 * Aggregate credentials by role — builds role → credentials map.
 * @param {Array} credentials - Enriched credentials array
 * @param {Array} roleNames - Array of role names to check
 * @returns {Object} { roleMap, openAccessCount, adminWritableCount }
 */
function aggregateByRole(credentials, roleNames) {
    var roleMap = {};
    var openAccessCount = 0;
    var adminWritableCount = 0;

    roleNames.forEach(function(r) {
        roleMap[r] = { read: [], write: [] };
    });

    credentials.forEach(function(cred) {
        var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
        var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

        if (readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1) {
            openAccessCount++;
        }
        if (writeRoles.indexOf('admin') !== -1) {
            adminWritableCount++;
        }

        readRoles.forEach(function(r) {
            var normalized = r === '*' ? '* (all)' : r;
            if (roleMap[normalized]) {
                roleMap[normalized].read.push(cred);
            }
        });
        writeRoles.forEach(function(r) {
            var normalized = r === '*' ? '* (all)' : r;
            if (roleMap[normalized]) {
                roleMap[normalized].write.push(cred);
            }
        });
    });

    return {
        roleMap: roleMap,
        openAccessCount: openAccessCount,
        adminWritableCount: adminWritableCount,
    };
}

/**
 * Set roles for a credential (read and write).
 */
async function setCredentialRoles(credential, readRoles, writeRoles) {
    var stanzaKey = credential.stanzaKey ||
        ((credential.realm || '') + ':' + (credential.name || '') + ':');
    // Normalize: strip leading "credential:" if present — buildAclPath adds it
    if (stanzaKey.indexOf('credential:') === 0) {
        stanzaKey = stanzaKey.slice('credential:'.length);
    }
    var aclPath = buildAclPath(
        stanzaKey,
        credential.namespaceOwner || credential.owner || 'nobody',
        credential.app || 'search'
    );
    var sharing = credential.sharing || 'app';
    var owner = credential.namespaceOwner || credential.owner || 'nobody';
    return _setAcl(aclPath, sharing, readRoles, writeRoles, owner);
}

/**
 * Bulk assign roles to multiple credentials.
 * @param {Array} credentials - Array of credential objects
 * @param {string[]} readRoles - Read roles to assign
 * @param {string[]} writeRoles - Write roles to assign
 * @param {string} mode - 'replace' or 'add'
 * @param {Function} onProgress - Optional progress callback(index, total)
 * @returns {Array} Results array
 */
async function bulkAssignRoles(credentials, readRoles, writeRoles, mode, onProgress) {
    var results = [];
    for (var i = 0; i < credentials.length; i++) {
        var cred = credentials[i];
        if (onProgress) onProgress(i, credentials.length);

        try {
            var finalRead = readRoles;
            var finalWrite = writeRoles;

            if (mode === 'add') {
                var existingRead = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                var existingWrite = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                finalRead = Array.from(new Set(existingRead.concat(readRoles)));
                finalWrite = Array.from(new Set(existingWrite.concat(writeRoles)));
            }

            await setCredentialRoles(cred, finalRead, finalWrite);
            results.push({ credential: cred, success: true, error: null });
        } catch (err) {
            results.push({ credential: cred, success: false, error: err });
        }
    }
    return results;
}

/**
 * Get admin-writable credentials.
 * @param {Array} credentials - Enriched credentials
 * @param {Array} adminRoles - Array of role names that have admin_all_objects
 * @returns {Array} Credentials writable by admin roles
 */
function getAdminWritableCredentials(credentials, adminRoles) {
    return credentials.filter(function(cred) {
        var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); });
        if (writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1) return true;
        return adminRoles.some(function(ar) { return writeRoles.indexOf(ar) !== -1; });
    });
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
    generatePassword,
    rotatePasswords,
    findDuplicatePasswords,
    clearDuplicateCache,
    isDuplicateCredential,
    loadPresets,
    savePreset,
    deletePreset,
    applyPreset,
    renamePreset,
    DEFAULT_READ_ROLES,
    DEFAULT_WRITE_ROLES,
    // Credential Tagging
    ensureTagCollections,
    tagCredKey,
    setTagsForCredential,
    getTagsForCredential,
    removeTagFromCredential,
    getAllTagDefinitions,
    getAllTagsData,
    deleteTagsForCredential,
    deleteTagDefinition,
    createTagDefinition,
    renameTagDefinition,
    updateTagColor,
    updateTagDescription,
    deleteTagDefinitionWithCascade,
    hashToColor,
    bulkAddTags,
    bulkRemoveTags,
    // Credential Expiry (KVStore)
    ensureExpiryCollection,
    setExpiryForCredential,
    getExpiryForCredential,
    getAllExpiryData,
    deleteExpiryForCredential,
    resolveExpiryDate,
    // Expiry / Rotation
    getRotationStatus,
    getDueSoonThreshold,
    setDueSoonThreshold,
    createOrUpdateExpiryAlert,
    dispatchSavedSearch,
    getExpiryAlert,
    deleteExpiryAlert,
    // Password Policy
    loadPolicy,
    savePolicy,
    loadPolicyFromKVStore,
    savePolicyToKVStore,
    ensurePolicyCollection,
    validatePasswordAgainstPolicy,
    // Role-Based Access
    getRolesWithCapabilities,
    clearRolesCapabilitiesCache,
    aggregateByRole,
    setCredentialRoles,
    bulkAssignRoles,
    getAdminWritableCredentials,
};
