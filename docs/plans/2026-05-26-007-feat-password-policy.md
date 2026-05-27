---
title: "feat: Password Policy Enforcement"
type: feat
status: draft
date: 2026-05-26
origin: "feature request — org-wide password rules validated in form and enforced server-side"
---

# feat: Password Policy Enforcement

## Summary

Add configurable password policy rules (minimum/maximum length, character requirements, banned passwords) validated inline in `CredentialForm.jsx` and optionally synced to Splunk's server-side password validation via REST API.

---

## Problem Frame

Teams create weak passwords (short, no special characters, common values like "password123"). Without enforcement, password rotation is meaningless. A policy layer validates passwords at creation time and optionally syncs rules to Splunk's native password validation.

---

## Requirements

- **R1.** Policy stored in `localStorage`: enabled toggle, min/max length, character toggles, banned passwords list
- **R2.** `validatePasswordAgainstPolicy(password, policy)` — returns array of error strings (empty = valid)
- **R3.** `CredentialForm.jsx` — validate before submit, show inline errors under password field, policy banner
- **R4.** Password generator respects `minLength` from policy (never generates below policy minimum)
- **R5.** Policy settings page — toggles, sliders, banned passwords textarea, "Save & Apply to Splunk" vs "Save Locally"
- **R6.** `updateSplunkValidator()` — sync to Splunk's password-validation config endpoint
- **R7.** Default policy is **disabled** — existing credentials not affected until explicitly enabled

---

## Scope Boundaries

- Policy is advisory in `CredentialForm.jsx` — blocks submit but does NOT retroactively scan existing credentials
- No per-credential custom policies (one org-wide policy)
- No complexity scoring algorithm (length + character class checks only)
- No password history tracking (no "cannot reuse last N passwords")
- Banned passwords list is a simple string match — no regex or pattern matching
- Realm format `baseRealm;expiry_YYYY-MM-DD` is unaffected

---

## Context & Research

### Existing Infrastructure

| Component | Location | Detail |
|---|---|---|
| `CredentialForm.jsx` | `components/CredentialForm.jsx` | Password field + strength meter, generator panel, form validation via `handleSubmit()` |
| `getPasswordStrength(pw)` | `CredentialForm.jsx` ~L32 | Returns `{ label, color, width }` — 5-point scoring (length >= 8, uppercase, lowercase, digits, special) |
| `generatePassword(options)` | `api.js` ~L1330 | Generates random password with configurable length (default 16) and character set toggles |
| Form validation | `CredentialForm.jsx` ~L155 | `handleSubmit()` — validates username, password, confirm password, read/write roles |
| Strength meter | `CredentialForm.jsx` | Visual bar under password field — 4 levels (weak/fair/good/strong) |

### Splunk Server-Side Password Validation

**Endpoint:** `POST /servicesNS/admin/search/config/password-validation/simple`

Sets global password validation rules that Splunk enforces when creating/updating passwords via REST API. Parameters:

| Parameter | Type | Description |
|---|---|---|
| `min_length` | int | Minimum password length (1-128) |
| `max_length` | int | Maximum password length (8-256) |
| `min_digits` | int | Minimum digit count (0-32) |
| `min_upper` | int | Minimum uppercase count (0-32) |
| `min_lower` | int | Minimum lowercase count (0-32) |
| `min_special` | int | Minimum special char count (0-32) |
| `banned_passwords` | multi-string | Comma-separated list of banned passwords |

**Note:** Splunk's validation only triggers on REST API password creation/updates. It does NOT validate in the UI form — that's our job. The server-side config acts as a safety net for direct API callers.

---

## Implementation Plan

### Phase 1: Policy Storage & Validation (api.js)

```javascript
// Policy storage key
const POLICY_KEY = 'password-policy-config';

// Default policy — disabled by default
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
    bannedPasswords: [], // array of strings
};

function loadPolicy() {
    try {
        var stored = localStorage.getItem(POLICY_KEY);
        if (stored) {
            var parsed = JSON.parse(stored);
            // Merge with defaults — handle missing keys from older versions
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

    // Length checks
    if (len < policy.minLength) {
        errors.push('Password must be at least ' + policy.minLength + ' characters (got ' + len + ')');
    }
    if (len > policy.maxLength) {
        errors.push('Password must be at most ' + policy.maxLength + ' characters (got ' + len + ')');
    }

    // Character class checks
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

    // Banned passwords check (case-insensitive)
    if (policy.bannedPasswords && policy.bannedPasswords.length > 0) {
        var pwdLower = password.toLowerCase();
        var banned = policy.bannedPasswords.map(function(s) { return s.toLowerCase(); });
        if (banned.indexOf(pwdLower) !== -1) {
            errors.push('This password is on the banned list');
        }
    }

    return errors;
}
```

### Phase 2: CredentialForm Integration (components/CredentialForm.jsx)

**Integration points in `handleSubmit()`:**

```javascript
// In handleSubmit(), AFTER existing validation and BEFORE form submission:
function handleSubmit(e) {
    e.preventDefault();

    var newErrors = {};

    // ... existing validation (username, password required, match, roles) ...

    // Policy validation — only when policy is enabled
    if ((!credential || isCopy) || isChangingPassword) {
        var policyErrors = _API.validatePasswordAgainstPolicy(password);
        if (policyErrors.length > 0) {
            newErrors.policy = policyErrors.join('. ');
        }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    // ... proceed with save ...
}
```

**Policy banner — display above form when policy is active:**

```javascript
// At top of form render, after formField imports:
var policy = _API.loadPolicy();
var policyBanner = policy.enabled ? React.createElement(
    'div',
    { style: {
        padding: '0.5rem 0.75rem',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#856404',
        marginBottom: '0.5rem',
    }},
    'Active password policy: min ' + policy.minLength + ' chars',
    policy.requireUppercase ? ' + uppercase' : '',
    policy.requireLowercase ? ' + lowercase' : '',
    policy.requireDigits ? ' + digits' : '',
    policy.requireSpecial ? ' + special' : ''
) : null;
```

**Policy error display — under password field:**

```javascript
// In formField for Password, add errorText:
formField('Password',
    React.createElement(Text, {
        type: 'password',
        value: password,
        onChange: handlePasswordChange,
        placeholder: 'Enter password',
        error: !!(errors.password || errors.policy),
    }),
    {
        errorText: errors.password || errors.policy,
        required: true,
    }
),
```

**Generator respects policy — clamp min length:**

```javascript
// In CredentialForm.jsx, initialize genLength with policy minimum:
const policyRef = React.useMemo(function() { return _API.loadPolicy(); }, []);
const [genLength, setGenLength] = React.useState(
    policyRef.enabled ? Math.max(policyRef.minLength, 8) : 16
);

// Range input min attribute respects policy:
React.createElement('input', {
    type: 'range',
    min: policyRef.enabled ? policyRef.minLength : 8,
    max: 64,
    value: genLength,
    onChange: function(e) { setGenLength(parseInt(e.target.value)); },
    style: { width: '100%' }
}),
```

### Phase 3: Settings Page (components/PasswordPolicySettings.jsx)

**New component — modal or standalone page.** Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ Password Policy Settings                                      │
│                                                             │
│ [✓] Enforce password policy                                   │
│     When disabled, all rules below are ignored              │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Length                                                  │   │
│ │                                                         │   │
│ │ Minimum: [8  ────────────]  (range 1-32)                │   │
│ │ Maximum: [128 ────────]  (range 8-256)                  │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Character Requirements                                    │   │
│ │                                                         │   │
│ │ [✓] Require uppercase   Min: [1]                      │   │
│ │ [✓] Require lowercase   Min: [1]                      │   │
│ │ [✓] Require digits      Min: [1]                      │   │
│ │ [✓] Require special     Min: [1]                      │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ Banned Passwords (one per line)                        │   │
│ │                                                         │   │
│ │ password                                               │   │
│ │ password123                                          │   │
│ │ administrator                                        │   │
│ │ [empty lines for adding more...]                     │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                             │
│  [Save Locally]   [Save & Apply to Splunk]                │
└─────────────────────────────────────────────────────────────┘
```

**State management:**

```javascript
function PasswordPolicySettings({ onSave, onClose }) {
    const [policy, setPolicy] = React.useState(_API.loadPolicy());
    const [saving, setSaving] = React.useState(false);

    function handleSaveLocally() {
        _API.savePolicy(policy);
        if (onSave) onSave(policy);
    }

    async function handleSaveAndApply() {
        setSaving(true);
        try {
            _API.savePolicy(policy);
            await _API.updateSplunkValidator(policy);
            if (onSave) onSave(policy);
            // Show success feedback
        } catch (e) {
            // Show error
        } finally {
            setSaving(false);
        }
    }
}
```

### Phase 4: Splunk Validator Sync (api.js)

```javascript
/**
 * Sync password policy to Splunk's server-side validation.
 * Only updates if policy is enabled. If disabled, removes server-side config.
 */
async function updateSplunkValidator(policy) {
    if (!policy.enabled) {
        // Clear server-side validation when policy is disabled
        // Splunk doesn't have a "delete" for this — set to minimal defaults
        return splunkdRequest('/servicesNS/admin/search/config/password-validation/simple', {
            method: 'POST',
            body: {
                min_length: 1,
                max_length: 256,
                min_digits: 0,
                min_upper: 0,
                min_lower: 0,
                min_special: 0,
            },
        });
    }

    var body = {
        min_length: policy.minLength,
        max_length: policy.maxLength,
        min_digits: policy.requireDigits ? policy.minDigits : 0,
        min_upper: policy.requireUppercase ? policy.minUppercase : 0,
        min_lower: policy.requireLowercase ? policy.minLowercase : 0,
        min_special: policy.requireSpecial ? policy.minSpecial : 0,
    };

    // Splunk accepts banned_passwords as repeated form fields
    if (policy.bannedPasswords && policy.bannedPasswords.length > 0) {
        policy.bannedPasswords.forEach(function(pwd) {
            body['banned_passwords'] = (body['banned_passwords'] ? body['banned_passwords'] + ',' : '') + pwd;
        });
    }

    return splunkdRequest('/servicesNS/admin/search/config/password-validation/simple', {
        method: 'POST',
        body: body,
    });
}

// Load current Splunk validator config
async function getSplunkValidator() {
    try {
        return await splunkdRequest('/servicesNS/admin/search/config/password-validation/simple', {
            method: 'GET',
        });
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }
}
```

### Phase 5: Navigation Integration (bundle.jsx)

Add policy settings button to toolbar:

```javascript
// In toolbar render:
React.createElement(Button, {
    onClick: function() { setModals(prev => ({ ...prev, policySettings: true })); },
    appearance: 'subtle',
    children: 'Password Policy'
}),
```

Add to modals state:

```javascript
const [modals, setModals] = React.useState({
    // ... existing ...
    policySettings: false,
});
```

Add modal rendering:

```javascript
modals.policySettings && React.createElement(PasswordPolicySettingsModal, {
    isOpen: modals.policySettings,
    onClose: function() { setModals(prev => ({ ...prev, policySettings: false })); },
    onSave: function(policy) {
        setModals(prev => ({ ...prev, policySettings: false }));
        // Policy is auto-loaded by CredentialForm on next render
        showSuccess('Policy Updated', ['Password policy saved' + (policy.appliedToSplunk ? ' and synced to Splunk' : '')]);
    },
})
```

---

## Files to Modify

| File | Change |
|---|---|
| `api.js` | Add `loadPolicy()`, `savePolicy()`, `validatePasswordAgainstPolicy()`, `updateSplunkValidator()`, `getSplunkValidator()` |
| `api.js` | Export new functions in `module.exports` |
| `components/CredentialForm.jsx` | Policy banner, policy validation in `handleSubmit()`, policy-aware generator min length, policy error display |
| `components/PasswordPolicySettings.jsx` | **New file** — settings modal component |
| `bundle.jsx` | Import `PasswordPolicySettings`, add `policySettings` modal state, toolbar button, modal rendering |

---

## Data Model

```javascript
// Policy config (localStorage)
// Key: 'password-policy-config'
{
    enabled: true,
    minLength: 12,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireDigits: true,
    requireSpecial: true,
    minDigits: 1,
    minUppercase: 1,
    minLowercase: 1,
    minSpecial: 1,
    bannedPasswords: ['password', 'password123', 'admin', 'administrator', 'letmein', 'welcome'],
}

// Validation result
// validatePasswordAgainstPolicy(password, policy) → string[]
// Empty array = valid
// [
//   "Password must be at least 12 characters (got 8)",
//   "Password must contain at least 1 uppercase letter(s)",
// ]

// Splunk server-side config mirrors:
// min_length, max_length, min_digits, min_upper, min_lower, min_special, banned_passwords
```

---

## Testing Plan

1. **Disabled policy** — verify no validation errors when `enabled: false`
2. **Length validation** — test min/max boundary conditions (exactly at min, exactly at max, below min, above max)
3. **Character class validation** — toggle each requirement on/off, verify errors appear/disappear
4. **Banned passwords** — add/remove entries, verify case-insensitive matching
5. **Generator integration** — verify slider min clamps to policy `minLength`
6. **Policy banner** — verify appears when enabled, disappears when disabled
7. **Save Locally** — writes to localStorage only, no Splunk API call
8. **Save & Apply to Splunk** — writes to localStorage AND calls Splunk API
9. **Splunk sync** — verify POST to `config/password-validation/simple` succeeds/fails correctly
10. **Form submission blocked** — verify `handleSubmit()` returns early when policy errors exist
11. **Edit existing credential** — policy validation applies only when changing password (not just editing ACLs)
12. **Copy credential** — policy validation applies to new passwords on copied credentials

---

## Dependencies

- `CredentialForm.jsx` password field — reused, validation added
- `getPasswordStrength(pw)` in `CredentialForm.jsx` — reused (complementary to policy, not replaced)
- `generatePassword(options)` in `api.js` — updated to respect policy minLength
- Splunk admin permissions (`admin_all_objects`) for `config/password-validation/simple`
- No new npm deps — uses `localStorage` for policy storage
