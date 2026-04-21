/**
 * CredentialForm.jsx - Form component for creating and updating credentials
 *
 * Provides a form for creating new credentials and updating existing ones
 */

const React = require('react');

/**
 * CredentialForm - Form component for credential management
 *
 * @param {Object} props - Component props
 * @param {Object} props.credential - Credential to edit (null for create)
 * @param {Function} props.onSave - Callback when form is submitted
 * @param {Function} props.onCancel - Callback when form is cancelled
 */
function CredentialForm({ credential = null, onSave, onCancel }) {
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [realm, setRealm] = React.useState('');
    const [app, setApp] = React.useState('search');
    const [owner, setOwner] = React.useState('nobody');
    const [readRoles, setReadRoles] = React.useState('');
    const [writeRoles, setWriteRoles] = React.useState('');
    const [isChangingPassword, setIsChangingPassword] = React.useState(false);

    // Initialize form when credential changes
    React.useEffect(() => {
        if (credential) {
            setUsername(credential.name || '');
            setRealm(credential.realm || '');
            setApp(credential.app || 'search');
            setOwner(credential.owner || 'nobody');

            // Parse roles from ACL
            if (credential.acl) {
                setReadRoles((credential.acl.read || []).join(', '));
                setWriteRoles((credential.acl.write || []).join(', '));
            }
        } else {
            // Reset form for new credential
            setUsername('');
            setPassword('');
            setRealm('');
            setApp('search');
            setOwner('nobody');
            setReadRoles('');
            setWriteRoles('');
            setIsChangingPassword(false);
        }
    }, [credential]);

    const handleSubmit = (e) => {
        e.preventDefault();

        if (onSave) {
            onSave({
                username: username.trim(),
                password: password || null,
                realm: realm.trim(),
                app: app.trim(),
                owner: owner.trim(),
                readRoles: readRoles.split(',').map((r) => r.trim()).filter(Boolean),
                writeRoles: writeRoles.split(',').map((r) => r.trim()).filter(Boolean),
            });
        }
    };

    const handleTogglePasswordChange = () => {
        setIsChangingPassword(!isChangingPassword);
        if (!isChangingPassword) {
            setPassword('');
        }
    };

    return React.createElement(
        'form',
        { onSubmit: handleSubmit, style: { padding: '1rem' } },
        React.createElement(
            'h3',
            { style: { marginBottom: '1rem', display: 'block' } },
            credential ? 'Edit Credential' : 'Create New Credential'
        ),

        // Username field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Username'),
            React.createElement('input', {
                type: 'text',
                value: username,
                onChange: (e) => setUsername(e.target.value),
                placeholder: 'Enter username',
                required: true,
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Realm field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Realm (optional)'),
            React.createElement('input', {
                type: 'text',
                value: realm,
                onChange: (e) => setRealm(e.target.value),
                placeholder: 'Enter realm (or leave empty)',
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Password field (conditional)
        credential &&
            React.createElement(
                'div',
                { key: 'password-toggle', style: { marginBottom: '1rem' } },
                React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: isChangingPassword,
                        onChange: handleTogglePasswordChange,
                    }),
                    'Change password'
                )
            ),

        ((credential && isChangingPassword) || !credential) &&
            React.createElement(
                'div',
                { style: { marginBottom: '1rem' } },
                React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Password'),
                React.createElement('input', {
                    type: 'password',
                    value: password,
                    onChange: (e) => setPassword(e.target.value),
                    placeholder: 'Enter password',
                    required: !credential || isChangingPassword,
                    style: {
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        boxSizing: 'border-box',
                    },
                })
            ),

        // App field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'App'),
            React.createElement('input', {
                type: 'text',
                value: app,
                onChange: (e) => setApp(e.target.value),
                placeholder: 'Enter app name',
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Owner field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Owner'),
            React.createElement('input', {
                type: 'text',
                value: owner,
                onChange: (e) => setOwner(e.target.value),
                placeholder: 'Enter owner',
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Read roles field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Read Roles (comma-separated)'),
            React.createElement('textarea', {
                value: readRoles,
                onChange: (e) => setReadRoles(e.target.value),
                placeholder: 'Enter roles separated by commas',
                rows: 2,
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Write roles field
        React.createElement(
            'div',
            { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' } }, 'Write Roles (comma-separated)'),
            React.createElement('textarea', {
                value: writeRoles,
                onChange: (e) => setWriteRoles(e.target.value),
                placeholder: 'Enter roles separated by commas',
                rows: 2,
                style: {
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                },
            })
        ),

        // Action buttons
        React.createElement(
            'div',
            { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' } },
            React.createElement(
                'button',
                {
                    type: 'button',
                    onClick: onCancel,
                    style: {
                        padding: '0.5rem 1rem',
                        backgroundColor: '#f0f0f0',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    },
                },
                'Cancel'
            ),
            React.createElement(
                'button',
                {
                    type: 'submit',
                    style: {
                        padding: '0.5rem 1rem',
                        backgroundColor: '#1565c0',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    },
                },
                credential ? 'Update' : 'Create'
            )
        )
    );
}

// Export component
module.exports = CredentialForm;
