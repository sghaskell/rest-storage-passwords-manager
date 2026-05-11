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

    // Initialize form when credential changes
    React.useEffect(function() {
        if (credential) {
            setUsername(credential.name || '');
            setRealm(credential.realm || '');
            setApp(credential.app || 'search');
            setOwner(credential.owner || 'nobody');
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
    }, [credential, currentUserIdentity, defaultReadRoles, defaultWriteRoles]);

    // Submit handler
    function handleSubmit(e) {
        e.preventDefault();

        var newErrors = {};

        if (!username.trim()) {
            newErrors.username = 'Username is required';
        }
        if (!credential && !password) {
            newErrors.password = 'Password is required';
        }
        if (isChangingPassword && !password) {
            newErrors.password = 'Password is required';
        }
        if ((!credential || isChangingPassword) && password !== confirmPassword) {
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

    var showPasswordFields = !credential || isChangingPassword;

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

    return React.createElement(
        'form',
        { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },

        // Username field
        formField('Username',
            React.createElement(Text, {
                value: username,
                onChange: function(e, data) { var val = data && typeof data.value === 'string' ? data.value : ''; setUsername(val); clearError('username'); },
                placeholder: 'Enter username',
                error: !!errors.username,
            }),
            { errorText: errors.username, required: true }
        ),

        // Realm field — disabled in edit mode per REST API limitation (realm immutable after creation)
        formField('Realm',
            React.createElement(Text, {
                value: realm,
                onChange: function(e, data) { var val = data && typeof data.value === 'string' ? data.value : ''; setRealm(val); },
                placeholder: credential ? '(set at create time)' : 'Enter realm (or leave empty)',
                disabled: !!credential,
            }),
            { helpText: credential ? undefined : 'Cannot be changed after creation' }
        ),

        // App field (controlled single-select with declarative options)
        formField('App',
            React.createElement(Selector, {
                value: app,
                onChange: function(e, data) { var val = (data && Array.isArray(data.values)) ? data.values[0] : app; setApp(val); },
            }, appData.map(function(a) {
                return React.createElement(SelectOption, { key: 'app-' + a.value, label: a.label, value: a.value });
            })),
            { required: true }
        ),

        // Sharing field (single-select with declarative options)
        formField('Sharing',
            React.createElement(Selector, {
                value: sharing,
                onChange: function(e, data) { var val = (data && Array.isArray(data.values)) ? data.values[0] : sharing; setSharing(val); },
            }, sharingData.map(function(s) {
                return React.createElement(SelectOption, { key: 'sharing-' + s.value, label: s.label, value: s.value });
            })),
            { helpText: 'How this credential is shared' }
        ),

        // Owner field (single-select with declarative options)
        formField('Owner',
            React.createElement(Selector, {
                value: owner,
                onChange: function(e, data) { var val = (data && Array.isArray(data.values)) ? data.values[0] : owner; setOwner(val); },
            }, ownerData.map(function(u) {
                return React.createElement(SelectOption, { key: 'owner-' + u.value, label: u.label, value: u.value });
            })),
            { helpText: 'User who owns this credential' }
        ),

        // Read Roles (multi-select with declarative options)
        formField('Read Roles',
            React.createElement(MultiSelector, {
                placeholder: 'Select roles...',
                values: readRolesArray,
                onChange: function(e, data) {
                    var selected = data.values ? data.values.slice() : [];
                    if (selected.length > 1 && selected.includes('* (all)')) selected = ['* (all)'];
                    setReadRolesArray(selected);
                    clearError('readRoles');
                },
            }, rolesData.map(function(r) {
                return React.createElement(MultiSelectOption, { key: 'role-rd-' + r.value, label: r.label, value: r.value });
            })),
            { helpText: 'Roles that can view this credential', errorText: errors.readRoles, required: true }
        ),

        // Write Roles (multi-select with declarative options)
        formField('Write Roles',
            React.createElement(MultiSelector, {
                placeholder: 'Select roles...',
                values: writeRolesArray,
                onChange: function(e, data) {
                    var selected = data.values ? data.values.slice() : [];
                    if (selected.length > 1 && selected.includes('* (all)')) selected = ['* (all)'];
                    setWriteRolesArray(selected);
                    clearError('writeRoles');
                },
            }, rolesData.map(function(r) {
                return React.createElement(MultiSelectOption, { key: 'role-wr-' + r.value, label: r.label, value: r.value });
            })),
            { helpText: 'Roles that can modify this credential', errorText: errors.writeRoles, required: true }
        ),

    // Password change toggle (edit mode only)
        credential && React.createElement(ControlGroup, {
            key: 'toggle-password',
            label: 'Change password',
        }, React.createElement(Switch, {
            selected: isChangingPassword,
            onClick: handleTogglePasswordChange,
        })),

        // Password field
       showPasswordFields && formField('Password',
            React.createElement(Text, {
                type: 'password',
                value: password,
                onChange: handlePasswordChange,
                placeholder: 'Enter password',
                error: !!errors.password,
            }),
            { errorText: errors.password, required: true }
        ),

        // Confirm Password field
      showPasswordFields && formField('Confirm Password',
            React.createElement(Text, {
                type: 'password',
                value: confirmPassword,
                onChange: handleConfirmChange,
                placeholder: 'Confirm password',
                error: !!errors.passwordMismatch,
            }),
            { errorText: errors.passwordMismatch, required: true }
        ),

        // Action buttons
        React.createElement(
      'div',
            { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center' } },
            React.createElement(Button, { onClick: onCancel, appearance: 'subtle', children: 'Cancel' }),
            React.createElement(Button, { onClick: handleSubmit, appearance: 'primary', children: credential ? 'Update' : 'Create' })
        )
    );
}

module.exports = CredentialForm;
