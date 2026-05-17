#!/usr/bin/env node
/**
 * REST API validation — credential CRUD via Splunk management port (8089/HTTPS).
 */

require('dotenv').config();
const assert = require('assert').strict;
const { execSync } = require('child_process');
const fs = require('fs');

const SPLUNK_HOST = process.env.SPLUNK_HOST || '127.0.0.1';
const SPLUNK_PORT = process.env.SPLUNK_MGMT_PORT || 8089;
const SPLUNK_USER = process.env.SPLUNK_ADMIN_USER || 'admin';
const SPLUNK_PASS = process.env.SPLUNK_ADMIN_PASSWORD || '';
const BASE = `https://${SPLUNK_HOST}:${SPLUNK_PORT}`;

const TS = Date.now().toString(36);
const TEST_APP = `test_react_app_${TS}`;
const C1 = `cred1_${TS}`, C2 = `cred2_${TS}`, RM = `realm_${TS}`;

let sk = ''; // session key
const errs = [];

function addJ(path) {
    return path.includes('output_mode') ? path : `${path}${path.includes('?') ? '&' : '?'}output_mode=json`;
}

function curl(args) {
    const tmp = `/tmp/sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cmd = `curl -sk -o '${tmp}' -w '%{http_code}' ${args.map(a => `"${a}"`).join(' ')} 2>/dev/null`;
    let st = ''; try { st = execSync(cmd, { encoding: 'utf8' }).trim(); } catch (e) {}
    const code = parseInt(st, 10);
    let body = ''; try { body = fs.readFileSync(tmp, 'utf8').trim(); } catch (e) {}
    try { fs.unlinkSync(tmp); } catch (e) {}
    if (!body || isNaN(code)) throw new Error(`curl fail: status=${st}`);
    let parsed; try { parsed = JSON.parse(body); } catch (e) {
        const x = new Error(`not json (${code}): ${body.substring(0, 300)}`); x.httpCode = code; throw x;
    }
    if (code >= 400) { const x = new Error(`${code}: ${JSON.stringify(parsed).substring(0, 400)}`); x.httpCode = code; throw x; }
    return parsed;
}

function post(path, form = {}) {
    const p = addJ(path), b = typeof form === 'string' ? form : new URLSearchParams(form).toString();
    return curl(['-X', 'POST', `${BASE}${p}`, '-H', `Authorization: Splunk ${sk}`, '-d', b]);
}

function get(path) {
    return curl([`${BASE}${addJ(path)}`, '-H', `Authorization: Splunk ${sk}`]);
}

function del(path) {
    return curl(['-X', 'DELETE', `${BASE}${addJ(path)}`, '-H', `Authorization: Splunk ${sk}`]);
}

// ─── Test steps ──────────────────────────────────────────────────────
async function main() {
    console.log('='.repeat(60));
    console.log(`REST API VALIDATION  TS=${TS}`);
    console.log(`Target: ${SPLUNK_HOST}:${SPLUNK_PORT}`);
    console.log('='.repeat(60));

    // 1. Auth
    try {
        const d = `username=${encodeURIComponent(SPLUNK_USER)}&password=${encodeURIComponent(SPLUNK_PASS)}`;
        const r = curl(['-X', 'POST', `${BASE}/services/auth/login?output_mode=json`, '-d', d]);
        sk = r.sessionKey || '';
        assert(sk); console.log(`\n[1/12] Auth OK (${sk.slice(0, 20)}...)`);
    } catch (e) { console.error(`\n[1/12] Auth FAIL: ${e.message.split('\n')[0]}`); process.exit(1); }

    // 2. Create test app
    try { await post('/services/apps/local', { name: TEST_APP }); console.log(`[2/12] App created`); }
    catch (e) { if (e.message.includes('409')) console.log(`[2/12] App exists`); else { errs.push(e.message.split('\n')[0]); console.error(`[2/12] FAIL: ${errs[errs.length-1]}`); } }

    // 3. GET users
    try { const u = get('/services/authentication/users?output_mode=json'); assert(Array.isArray(u.entry) && u.entry.length >= 1); console.log(`[3/12] Users OK (${u.entry.map(e=>e.name).join(', ')})`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[3/12] Users FAIL: ${errs[errs.length-1]}`); }

    // 4. CREATE cred with realm
    try { await post(`/servicesNS/nobody/${TEST_APP}/storage/passwords`, { name: C1, password: 'initial', realm: RM }); console.log(`[4/12] Created ${RM}:${C1}`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[4/12] Create cred FAIL: ${errs[errs.length-1]}`); }

    // 5. CREATE cred without realm
    try { await post(`/servicesNS/nobody/${TEST_APP}/storage/passwords`, { name: C2, password: 'another', realm: '' }); console.log(`[5/12] Created ${C2} (no realm)`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[5/12] Create no-realm FAIL: ${errs[errs.length-1]}`); }

    // propagation delay
    await new Promise(r => setTimeout(r, 1500));

    // 6. GET all credentials + data shape check
    try {
        const c = get('/servicesNS/-/-/storage/passwords?output_mode=json&count=0');
        const entries = c.entry || [];
        if (entries.length) console.log(`[6/12] content keys: ${JSON.stringify(Object.keys(entries[0].content||{}))}`);
        assert(entries.some(e => e.content?.username === C1 && e.content?.realm === RM), `${C1} not found`);
        assert(entries.some(e => e.content?.username === C2), `${C2} not found`);
        const c1e = entries.find(e => e.content?.username === C1);
        console.log(`[6/12] GET creds OK (${entries.length}). ${C1}: owner='${c1e?.acl?.owner}' app='${c1e?.acl?.app}'`);
    } catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[6/12] GET creds FAIL: ${errs[errs.length-1]}`); }

    // 7. GET single cred with clear_password (URI path)
    try {
        const c = get(`/servicesNS/-/-/storage/passwords/${RM}:${encodeURIComponent(C1)}?output_mode=json`);
        const pw = c.entry?.[0]?.content?.clear_password;
        assert(pw === 'initial', `clear_password is "${pw}" not "initial"`);
        console.log(`[7/12] Clear password via URI OK ("${pw}")`);
    } catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[7/12] GET clear pwd FAIL: ${errs[errs.length-1]}`); }

    // 8. UPDATE via /storage/passwords/realm:name
    try { await post(`/servicesNS/nobody/${TEST_APP}/storage/passwords/${RM}:${encodeURIComponent(C1)}`, { password: 'updated' }); console.log(`[8/12] Update (storage) OK`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[8/12] Update storage FAIL: ${errs[errs.length-1]}`); }

    // 9. UPDATE via /configs/conf-passwords/credential:...
    try { const id = encodeURIComponent(`credential:${RM}:${C1}:`); await post(`/servicesNS/nobody/${TEST_APP}/configs/conf-passwords/${id}`, { password: 'updated2' }); console.log(`[9/12] Update (configs) OK`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[9/12] Update configs FAIL: ${errs[errs.length-1]}`); }

    // 10. GET apps & roles
    try {
        const a = get('/servicesNS/-/-/apps/local?output_mode=json&count=0'), r = get('/servicesNS/-/-/authorization/roles?output_mode=json&count=0');
        assert(a.entry?.some(e => e.name === TEST_APP)); assert(r.entry?.some(e => e.name === 'admin'));
        console.log(`[10/12] Apps: ${a.entry.length}, Roles: ${r.entry.length} OK`);
    } catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[10/12] Apps/Roles FAIL: ${errs[errs.length-1]}`); }

    // 11. DELETE credential
    try { await del(`/servicesNS/nobody/${TEST_APP}/storage/passwords/${RM}:${encodeURIComponent(C1)}`); console.log(`[11/12] Delete OK (${RM}:${C1})`); }
    catch (e) { errs.push(e.message.split('\n')[0]); console.error(`[11/12] Delete FAIL: ${errs[errs.length-1]}`); }

    // 12. Cleanup
    try { await del(`/servicesNS/nobody/${TEST_APP}/storage/passwords/null%3A${encodeURIComponent(C2)}`); } catch(e) {}
    try { await del(`/services/apps/local/${encodeURIComponent(TEST_APP)}`); console.log(`[12/12] App cleaned`); }
    catch (e) { console.log(`[12/12] Cleanup: ${e.message.split('\n')[0].substring(0, 80)}`); }

    // ─── Summary ──────────────────────────────────────────────────────
    console.log('='.repeat(60));
    if (errs.length === 0) {
        console.log('ALL CHECKS PASSED');
    } else {
        console.log(`${errs.length} FAILED:`); errs.forEach((e, i) => console.log(`  ${i+1}. ${e}`)); process.exit(1);
    }
    console.log('='.repeat(60));
}

main().catch(e => { console.error('Fatal:', e.message.split('\n')[0]); process.exit(1); });
