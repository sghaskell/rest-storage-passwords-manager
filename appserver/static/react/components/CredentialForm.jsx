/**
 * CredentialForm.jsx - Form component for creating and updating credentials
 *
 * Uses @splunk/react-ui Text / Select / Switch / ControlGroup components.
 * Matches legacy password-crud.js field-group/input-text/build-select pattern exactly.
 */

const React = require('react');

// Splunk design system imports
var TextMod = require('@splunk/react-ui/Text');
var Text = TextMod.default;
var SelectMod = require('@splunk/react-ui/Select');
var Selector = SelectMod.default;
var SelectOption = SelectMod.Option;
var MultiSelectMod = require('@splunk/react-ui/Multiselect');
var MultiSelector = MultiSelectMod.default;
var MultiSelectOption = MultiSelectMod.Option;
var SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
var ControlGroup = require('@splunk/react-ui/ControlGroup').default;
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

// Default sharing options
const SHARING_OPTIONS_LABELS = [
  { label: 'App-scoped', value: 'app' },
  { label: 'All Apps (Shared globally)', value: 'global' },
  { label: 'User-scoped (Specific users)', value: 'user' },
];

// Password strength scoring: 0-5 → weak/fair/good/strong
function getPasswordStrength(pw) {
    if (!pw) return null;
    var score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { label: 'Weak', color: '#d32f2f', width: '20%' };
    if (score === 2) return { label: 'Fair', color: '#f57c00', width: '40%' };
    if (score === 3) return { label: 'Good', color: '#f9a825', width: '60%' };
    return { label: 'Strong', color: '#2e7d32', width: '100%' };
}

// Password generator
function generatePassword(length, options) {
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

/** Helper — convert role array to Splunk data format [{ label, value }] */
function toSelectData(roles) {
    var allItem = { label: '* (all)', value: '* (all)' };
    // Ensure '* (all)' is always present if not already
    if (!roles.some(function(r) { return r === '* (all)'; })) {
        roles = ['* (all)', ...roles];
    }
    var data = roles.map(function(r) { return { label: r, value: r }; });
    return data;
}

/**
 * CredentialForm - Form component for credential management
 */
function CredentialForm({
  credential = null,
  onSave,
  onCancel,
  isCopy = false,
  availableApps = [],
  availableUsers = [],
  currentUserIdentity = 'nobody',
  availableRoles = [],
  defaultReadRoles = '',
  defaultWriteRoles = '',
}) {
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [realm, setRealm] = React.useState('');
    const [app, setApp] = React.useState('search');
    const [owner, setOwner] = React.useState('nobody');
    const [readRolesArray, setReadRolesArray] = React.useState([]);
    const [writeRolesArray, setWriteRolesArray] = React.useState([]);
    const [sharing, setSharing] = React.useState('app');
    const [isChangingPassword, setIsChangingPassword] = React.useState(false);
    const [errors, setErrors] = React.useState({});
    const [showGenerator, setShowGenerator] = React.useState(false);
    const [copiedPassword, setCopiedPassword] = React.useState(false);
    const [genLength, setGenLength] = React.useState(16);
    const [genOptions, setGenOptions] = React.useState({
        uppercase: true,
        lowercase: true,
        numbers: true,
        symbols: true,
    });
    const prevReadRolesRef = React.useRef(readRolesArray);
    const prevWriteRolesRef = React.useRef(writeRolesArray);

    // Keep refs in sync with state
    React.useEffect(function() { prevReadRolesRef.current = readRolesArray; }, [readRolesArray]);
    React.useEffect(function() { prevWriteRolesRef.current = writeRolesArray; }, [writeRolesArray]);

    // Initialize form when credential changes
    React.useEffect(function() {
        if (credential) {
            var today = new Date();
            var dateSuffix = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

            if (isCopy) {
                setUsername((credential.name || '') + '-' + dateSuffix);
            } else {
                setUsername(credential.name || '');
            }
            setRealm(credential.realm || '');
            setApp(credential.app || 'search');
            setOwner(credential.namespaceOwner || credential.owner || 'nobody');
            setSharing(credential.sharing || 'app');

            var normalize = function(arr) { return arr.map(function(r) { return r === '*' ? '* (all)' : r; }); };
            var aclRead = normalize((credential.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean));
            var aclWrite = normalize((credential.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean));
            setReadRolesArray(aclRead);
            setWriteRolesArray(aclWrite);
            setPassword('');
            setConfirmPassword('');
            setIsChangingPassword(false);
        } else {
            setUsername('');
            setPassword('');
            setConfirmPassword('');
            setRealm('');
            setApp('search');
            setOwner(currentUserIdentity);
            setSharing('app');

            var defRead = (defaultReadRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
            var defWrite = (defaultWriteRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
            setReadRolesArray(defRead);
            setWriteRolesArray(defWrite);
        }
        setErrors({});
    }, [credential, isCopy, currentUserIdentity, defaultReadRoles, defaultWriteRoles]);

    // Submit handler
    function handleSubmit(e) {
        e.preventDefault();

        var newErrors = {};

        if (!username.trim()) {
            newErrors.username = 'Username is required';
        }
        if ((!credential || isCopy) && !password) {
            newErrors.password = 'Password is required';
        }
        if (isChangingPassword && !password) {
            newErrors.password = 'Password is required';
        }
        if ((!credential || isCopy || isChangingPassword) && password !== confirmPassword) {
            newErrors.passwordMismatch = 'Passwords do not match';
        }
        if (!readRolesArray.length) {
            newErrors.readRoles = 'Select at least one Read role (or * for all)';
        }
        if (!writeRolesArray.length) {
            newErrors.writeRoles = 'Select at least one Write role (or * for all)';
        }

        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

        if (onSave) {
            onSave({
                username: username.trim(),
                password: password || null,
                realm: realm.trim(),
                app: app,
                owner: owner,
                readRoles: resolveRoles(readRolesArray),
                writeRoles: resolveRoles(writeRolesArray),
                sharing: sharing,
            });
        }
    }

    function handleTogglePasswordChange(e) {
        var newState = !isChangingPassword;
        setIsChangingPassword(newState);
        if (!isChangingPassword) {
            setPassword('');
            setConfirmPassword('');
            setErrors({});
        }
    }

    function handlePasswordChange(e, data) {
        var val = data && typeof data.value === 'string' ? data.value : '';
        setPassword(val);
        clearError('password');
        clearError('passwordMismatch');
    }

    function handleConfirmChange(e, data) {
        var val = data && typeof data.value === 'string' ? data.value : '';
        setConfirmPassword(val);
        clearError('passwordMismatch');
    }

    function clearError(key) {
        setErrors(function(prev) {
            var next = Object.assign({}, prev);
            delete next[key];
            return Object.keys(next).length ? next : {};
        });
    }

    // Generator handlers
    function handleGenerate() {
        var pw = generatePassword(genLength, genOptions);
        setPassword(pw);
        setConfirmPassword(pw);
        setErrors({});
    }

    function handleCopyPassword() {
        if (!password) return;
        navigator.clipboard.writeText(password).then(function() {
            setCopiedPassword(true);
            setTimeout(function() { setCopiedPassword(false); }, 1500);
        }).catch(function() {});
    }

    function toggleGenerator() {
        setShowGenerator(function(p) { return !p; });
    }

    function handleOptionChange(key) {
        setGenOptions(function(prev) { return Object.assign({}, prev, { [key]: !prev[key] }); });
    }

    // Resolve role list for API: map '* (all)' → '*' (wildcard), or pass through normal roles
    function resolveRoles(roles) {
        if (!roles || roles.length === 0) return [];
        if (roles.includes('* (all)')) return ['*'];
        return roles;
    }

    // Build Select data arrays
    var appData = availableApps.map(function(a) { return { label: a.name, value: a.name }; });
    var ownerData = [
        { label: 'Nobody (shared)', value: 'nobody' }
    ].concat(availableUsers.map(function(u) {
        return { label: (u.fullName ? u.fullName + ' (' + u.name + ')' : u.name), value: u.name };
    }));
    var sharingData = SHARING_OPTIONS_LABELS.map(function(opt) { return { label: opt.label, value: opt.value }; });

    // Build roles data — ensure '* (all)' is present
    var rolesList = availableRoles.slice();
    if (!rolesList.includes('* (all)')) {
        rolesList.unshift('* (all)');
    }
    var rolesData = toSelectData(rolesList);

    var showPasswordFields = !credential || isChangingPassword || isCopy;

    // Form field wrapper helper — uses ControlGroup for proper accessibility, layout, error/help text, required indicators
    function formField(label, inputEl, opts) {
        opts = opts || {};
        var err = opts.errorText;
        var help = !err && opts.helpText ? opts.helpText : undefined;
        return React.createElement(ControlGroup, {
            key: label,
            label: label + (opts.required ? ' *' : ''),
            error: err,
            additionalInfo: help,
            accessibilityLabel: err ? label + '. ' + err : undefined,
        }, inputEl);
    }

    // Grid row helper — renders two fields side by side
    function gridRow(left, right) {
        return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 1.5rem' } }, left, right);
    }

    return React.createElement(
        'form',
        { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },

        // Row 1: Username + Realm
        gridRow(
            formField('Username',
                React.createElement(Text, {
                    value: username,
                    onChange: function(e, data) { var val = data && typeof data.value === 'string' ? data.value : ''; setUsername(val); clearError('username'); },
                    placeholder: 'Enter username',
                    disabled: !!(credential && !isCopy),
                    error: !!errors.username,
                }),
                { errorText: errors.username, required: true }
            ),
            formField('Realm',
                React.createElement(Text, {
                    value: realm,
                    onChange: function(e, data) { var val = data && typeof data.value === 'string' ? data.value : ''; setRealm(val); },
                    placeholder: credential && !isCopy ? '(set at create time)' : 'Enter realm (or leave empty)',
                    disabled: !!(credential && !isCopy),
                }),
                { helpText: (credential && !isCopy) ? undefined : 'Cannot be changed after creation' }
            )
        ),

        // Row 2: App + Sharing
        gridRow(
            formField('App',
                React.createElement(Selector, {
                    value: app,
                    onChange: function(e, data) { var val = data && data.value != null ? data.value : app; setApp(val); },
                }, appData.map(function(a) {
                    return React.createElement(SelectOption, { key: 'app-' + a.value, label: a.label, value: a.value });
                })),
                { required: true }
            ),
            formField('Sharing',
                React.createElement(Selector, {
                    value: sharing,
                    onChange: function(e, data) { var val = data && data.value != null ? data.value : sharing; setSharing(val); },
                }, sharingData.map(function(s) {
                    return React.createElement(SelectOption, { key: 'sharing-' + s.value, label: s.label, value: s.value });
                })),
                { helpText: 'How this credential is shared' }
            )
        ),

        // Row 3: Owner (single column, full width)
        React.createElement('div', { style: { width: '100%' } },
            formField('Owner',
                React.createElement(Selector, {
                    value: owner,
                    onChange: function(e, data) { var val = data && data.value != null ? data.value : owner; setOwner(val); },
                    style: { width: '100%' }
                }, ownerData.map(function(u) {
                    return React.createElement(SelectOption, { key: 'owner-' + u.value, label: u.label, value: u.value });
                })),
                { helpText: 'User who owns this credential' }
            )
        ),

        // Row 4: Read Roles + Write Roles (side by side)
        gridRow(
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
                React.createElement('label', { style: { fontSize: '14px', fontWeight: '500' } }, 'Read Roles *'),
                React.createElement(MultiSelector, {
                    placeholder: 'Select roles...',
                    values: readRolesArray,
                    onChange: function(e, data) {
                        var newVals = data.values ? data.values.slice() : [];
                        var prevVals = prevReadRolesRef.current;
                        var added = newVals.filter(function(v) { return prevVals.indexOf(v) === -1; });
                        if (added.includes('* (all)')) { newVals = ['* (all)']; }
                        else if (added.length > 0 && !added.includes('* (all)') && prevVals.includes('* (all)')) { newVals = newVals.filter(function(v) { return v !== '* (all)'; }); }
                        prevReadRolesRef.current = newVals;
                        setReadRolesArray(newVals);
                        clearError('readRoles');
                    },
                }, rolesData.map(function(r) {
                    return React.createElement(MultiSelectOption, { key: 'role-rd-' + r.value, label: r.label, value: r.value });
                })),
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                    React.createElement(Button, { type: 'button', appearance: 'subtle', onClick: function() { var arr = rolesData.map(function(r) { return r.value !== '* (all)' ? r.value : null; }).filter(Boolean); prevReadRolesRef.current = arr; setReadRolesArray(arr); clearError('readRoles'); } }, 'Select All'),
                    React.createElement(Button, { type: 'button', appearance: 'subtle', onClick: function() { var arr = (defaultReadRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean); prevReadRolesRef.current = arr; setReadRolesArray(arr); clearError('readRoles'); } }, 'Reset')
                ),
                errors.readRoles && React.createElement('span', { style: { fontSize: '12px', color: '#d32f2f' } }, errors.readRoles),
                React.createElement('span', { style: { fontSize: '12px', color: '#999' } }, '* (all) is mutually exclusive')
            ),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
                React.createElement('label', { style: { fontSize: '14px', fontWeight: '500' } }, 'Write Roles *'),
                React.createElement(MultiSelector, {
                    placeholder: 'Select roles...',
                    values: writeRolesArray,
                    onChange: function(e, data) {
                        var newVals = data.values ? data.values.slice() : [];
                        var prevVals = prevWriteRolesRef.current;
                        var added = newVals.filter(function(v) { return prevVals.indexOf(v) === -1; });
                        if (added.includes('* (all)')) { newVals = ['* (all)']; }
                        else if (added.length > 0 && !added.includes('* (all)') && prevVals.includes('* (all)')) { newVals = newVals.filter(function(v) { return v !== '* (all)'; }); }
                        prevWriteRolesRef.current = newVals;
                        setWriteRolesArray(newVals);
                        clearError('writeRoles');
                    },
                }, rolesData.map(function(r) {
                    return React.createElement(MultiSelectOption, { key: 'role-wr-' + r.value, label: r.label, value: r.value });
                })),
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                    React.createElement(Button, { type: 'button', appearance: 'subtle', onClick: function() { var arr = rolesData.map(function(r) { return r.value !== '* (all)' ? r.value : null; }).filter(Boolean); prevWriteRolesRef.current = arr; setWriteRolesArray(arr); clearError('writeRoles'); } }, 'Select All'),
                    React.createElement(Button, { type: 'button', appearance: 'subtle', onClick: function() { var arr = (defaultWriteRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean); prevWriteRolesRef.current = arr; setWriteRolesArray(arr); clearError('writeRoles'); } }, 'Reset')
                ),
                errors.writeRoles && React.createElement('span', { style: { fontSize: '12px', color: '#d32f2f' } }, errors.writeRoles),
                React.createElement('span', { style: { fontSize: '12px', color: '#999' } }, '* (all) is mutually exclusive')
            )
        ),

        // Password change toggle (edit mode only)
        credential && React.createElement(ControlGroup, {
            key: 'toggle-password',
            label: 'Change password',
        }, React.createElement(Switch, {
            selected: isChangingPassword,
            onClick: handleTogglePasswordChange,
        })),

        // Password + Confirm Password (side by side)
        showPasswordFields && gridRow(
            formField('Password',
                React.createElement(Text, {
                    type: 'password',
                    value: password,
                    onChange: handlePasswordChange,
                    placeholder: 'Enter password',
                    error: !!errors.password,
                }),
                { errorText: errors.password, required: true }
            ),
            formField('Confirm Password',
                React.createElement(Text, {
                    type: 'password',
                    value: confirmPassword,
                    onChange: handleConfirmChange,
                    placeholder: 'Confirm password',
                    error: !!errors.passwordMismatch,
                }),
                { errorText: errors.passwordMismatch, required: true }
            )
        ),

        // Generator toggle button
        showPasswordFields && React.createElement('div', { style: { textAlign: 'center', width: '100%' } },
            React.createElement(Button, {
                type: 'button',
                appearance: 'subtle',
                onClick: toggleGenerator,
            }, showGenerator ? 'Hide Password Generator' : 'Generate Password')
        ),

        // Generator panel (expandable)
        showPasswordFields && showGenerator && React.createElement('div', {
            className: 'credential-form-generator-panel',
            style: {
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '1rem',
                backgroundColor: '#f9f9f9',
            }
        },
            React.createElement('div', {
                className: 'credential-form-generator-header',
                style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }
            },
                // Left column: length slider + generate/copy buttons
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } },
                    React.createElement('label', { style: { fontSize: '13px', fontWeight: '500' } }, 'Length: ' + genLength),
                    React.createElement('input', {
                        type: 'range',
                        min: 8,
                        max: 64,
                        value: genLength,
                        onChange: function(e) { setGenLength(parseInt(e.target.value)); },
                        style: { width: '100%' }
                    }),
                    React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                        React.createElement(Button, {
                            type: 'button',
                            appearance: 'primary',
                            onClick: handleGenerate,
                        }, 'Generate'),
                        React.createElement(Button, {
                            type: 'button',
                            appearance: 'subtle',
                            onClick: handleCopyPassword,
                        }, copiedPassword ? 'Copied!' : 'Copy')
                    )
                ),
                // Right column: character set checkboxes
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
                    React.createElement('label', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '0.25rem' } }, 'Character Set'),
                    React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: genOptions.uppercase,
                            onChange: function() { handleOptionChange('uppercase'); },
                        }),
                        ' Uppercase (A-Z)'
                    ),
                    React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: genOptions.lowercase,
                            onChange: function() { handleOptionChange('lowercase'); },
                        }),
                        ' Lowercase (a-z)'
                    ),
                    React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: genOptions.numbers,
                            onChange: function() { handleOptionChange('numbers'); },
                        }),
                        ' Numbers (0-9)'
                    ),
                    React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: genOptions.symbols,
                            onChange: function() { handleOptionChange('symbols'); },
                        }),
                        ' Symbols (!@#$%^&*...)'
                    )
                )
            )
        ),

        // Password strength indicator
        showPasswordFields && password.length > 0 && React.createElement('div', { style: { width: '100%' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '4px' } },
                React.createElement('span', { style: { fontSize: '12px', color: getPasswordStrength(password).color, fontWeight: '600' } },
                    getPasswordStrength(password).label
                )
            ),
            React.createElement('div', { className: 'credential-form-password-strength-track', style: { height: '4px', backgroundColor: '#e0e0e0', borderRadius: '2px', overflow: 'hidden' } },
                React.createElement('div', { style: { height: '100%', width: getPasswordStrength(password).width, backgroundColor: getPasswordStrength(password).color, borderRadius: '2px', transition: 'width 0.2s, background-color 0.2s' } })
            )
        ),

        // Action buttons
        React.createElement(
      'div',
            { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center' } },
            React.createElement(Button, { onClick: onCancel, appearance: 'subtle', children: 'Cancel' }),
            React.createElement(Button, { onClick: handleSubmit, appearance: 'primary', children: isCopy ? 'Create Copy' : (credential ? 'Update' : 'Create') })
        )
    );
}

module.exports = CredentialForm;
