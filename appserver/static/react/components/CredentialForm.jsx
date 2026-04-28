/**
 * CredentialForm.jsx - Form component for creating and updating credentials
 *
 * Uses @splunk/react-ui components: ControlGroup, Select, Multiselect, Text, Button
 * All fields wrapped in ControlGroup for labels, errors, and accessibility
 */

const React = require('react');
const ControlGroup = require('@splunk/react-ui/ControlGroup').default;
const Select = require('@splunk/react-ui/Select').default;
const Multiselect = require('@splunk/react-ui/Multiselect').default;
const Text = require('@splunk/react-ui/Text').default;
const Button = require('@splunk/react-ui/Button').default;

// Default sharing options — hoisted outside component (rerender-memo-with-default-value)
const SHARING_OPTIONS = [
  { label: 'App-scoped', value: 'app' },
  { label: 'All Apps (Shared globally)', value: 'global' },
  { label: 'User-scoped (Specific users)', value: 'user' },
];

// Container layout styles — minimal, not on individual form controls
const CONTAINER_STYLE = {
  padding: '1rem',
};

/**
 * CredentialForm - Form component for credential management
 *
 * @param {Object} props - Component props
 * @param {Object|null} props.credential - Credential to edit (null for create)
 * @param {Function} props.onSave - Callback when form is submitted
 * @param {Function} props.onCancel - Callback when form is cancelled
 * @param {Array} props.availableApps - Array of {name} objects for app dropdown
 * @param {string} props.currentUserIdentity - Current user username string
 * @param {Array} props.availableRoles - Array of role name strings
 * @param {string} props.defaultReadRoles - Comma-separated default read roles
 * @param {string} props.defaultWriteRoles - Comma-separated default write roles
 */
function CredentialForm({
  credential = null,
  onSave,
  onCancel,
  availableApps = [],
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
  React.useEffect(() => {
    if (credential) {
      setUsername(credential.name || '');
      setRealm(credential.realm || '');
      setApp(credential.app || 'search');
      setOwner(credential.owner || 'nobody');
      setSharing(credential.sharing || 'app');

      // Parse comma-separated ACL strings into arrays for Multiselect
      const aclRead = (credential.aclRead || '').split(',').map((r) => r.trim()).filter(Boolean);
      const aclWrite = (credential.aclWrite || '').split(',').map((r) => r.trim()).filter(Boolean);
      setReadRolesArray(aclRead);
      setWriteRolesArray(aclWrite);
      setPassword('');
      setConfirmPassword('');
      setIsChangingPassword(false);
    } else {
      // Reset form for new credential
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setRealm('');
      setApp('search');
      setOwner(currentUserIdentity);
      setSharing('app');

      // Parse default roles from comma-separated strings into arrays
      const defRead = (defaultReadRoles || '').split(',').map((r) => r.trim()).filter(Boolean);
      const defWrite = (defaultWriteRoles || '').split(',').map((r) => r.trim()).filter(Boolean);
      setReadRolesArray(defRead);
      setWriteRolesArray(defWrite);
    }
    setErrors({});
  }, [credential, currentUserIdentity, defaultReadRoles, defaultWriteRoles]);

  // Submit handler — validates password match before saving
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!credential || isChangingPassword) {
      if (password !== confirmPassword) {
        setErrors({ passwordMismatch: 'Passwords do not match' });
        return;
      }
    }

    if (onSave) {
      onSave({
        username: username.trim(),
        password: password || null,
        realm: realm.trim(),
        app,
        owner,
        readRoles: readRolesArray,
        writeRoles: writeRolesArray,
        sharing,
      });
    }
  };

  // Password toggle handler — clears confirm field and errors when disabled
  const handleTogglePasswordChange = () => {
    setIsChangingPassword((prev) => !prev);
    if (!isChangingPassword) {
      setPassword('');
      setConfirmPassword('');
      setErrors({});
    }
  };

  // Confirm password handler — clears error on typing (rerender-move-effect-to-event)
  const handleConfirmChange = (e, { value }) => {
    setConfirmPassword(value);
    if (errors.passwordMismatch) {
      setErrors({});
    }
  };

  // Render shared form fields to avoid duplication between create/edit modes
  const renderFormContent = () => {
    const showPasswordFields = !credential || isChangingPassword;

    return React.createElement(
      'form',
      { onSubmit: handleSubmit, style: CONTAINER_STYLE },

      // Title
      React.createElement('h3', null, credential ? 'Edit Credential' : 'Create New Credential'),

      // Username field
      React.createElement(
        ControlGroup,
        { label: 'Username', required: true },
        React.createElement(Text, {
          value: username,
          onChange: (e, props) => setUsername(props.value),
          placeholder: 'Enter username',
        })
      ),

      // Realm field
      React.createElement(
        ControlGroup,
        { label: 'Realm (optional)' },
        React.createElement(Text, {
          value: realm,
          onChange: (e, props) => setRealm(props.value),
          placeholder: 'Enter realm (or leave empty)',
        })
      ),

      // App field — Select dropdown populated from availableApps
      React.createElement(
        ControlGroup,
        { label: 'App', required: true },
        React.createElement(
          Select,
          {
            value: app,
            onChange: (e, props) => setApp(props.value),
            error: !!errors.app,
          },
          availableApps.map((a) =>
            React.createElement(Select.Option, {
              key: a.name,
              label: a.name,
              value: a.name,
            })
          )
        )
      ),

      // Sharing field — Select with predefined options
      React.createElement(
        ControlGroup,
        { label: 'Sharing', helpText: 'How this credential is shared' },
        React.createElement(
          Select,
          { value: sharing, onChange: (e, props) => setSharing(props.value) },
          SHARING_OPTIONS.map((opt) =>
            React.createElement(Select.Option, {
              key: opt.value,
              label: opt.label,
              value: opt.value,
            })
          )
        )
      ),

      // Owner field — Text input defaulting to current user
      React.createElement(
        ControlGroup,
        { label: 'Owner' },
        React.createElement(Text, {
          value: owner,
          onChange: (e, props) => setOwner(props.value),
        })
      ),

      // Read Roles — Multiselect with chips and filtering
      React.createElement(
        ControlGroup,
        { label: 'Read Roles', helpText: 'Roles that can view this credential' },
        React.createElement(
          Multiselect,
          {
            values: readRolesArray,
            onChange: (e, props) => setReadRolesArray(props.values || []),
            placeholder: 'Select read roles...',
          },
          availableRoles.map((role) =>
            React.createElement(Multiselect.Option, {
              key: role,
              label: role,
              value: role,
            })
          )
        )
      ),

      // Write Roles — Multiselect with chips and filtering
      React.createElement(
        ControlGroup,
        { label: 'Write Roles', helpText: 'Roles that can modify this credential' },
        React.createElement(
          Multiselect,
          {
            values: writeRolesArray,
            onChange: (e, props) => setWriteRolesArray(props.values || []),
            placeholder: 'Select write roles...',
          },
          availableRoles.map((role) =>
            React.createElement(Multiselect.Option, {
              key: role,
              label: role,
              value: role,
            })
          )
        )
      ),

      // Password change toggle (edit mode only)
      credential &&
        React.createElement(
          ControlGroup,
          { label: '' },
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: isChangingPassword,
              onChange: handleTogglePasswordChange,
            }),
            'Change password'
          )
        ),

      // Password field — shown on create or when changing password in edit mode
      showPasswordFields &&
        React.createElement(
          ControlGroup,
          { label: 'Password', required: true },
          React.createElement(Text, {
            type: 'password',
            passwordVisibilityToggle: true,
            value: password,
            onChange: (e, props) => setPassword(props.value),
            placeholder: 'Enter password',
          })
        ),

      // Confirm Password field — shown on create or when changing password in edit mode
      showPasswordFields &&
        React.createElement(
          ControlGroup,
          {
            label: 'Confirm Password',
            required: true,
            errorText: errors.passwordMismatch,
          },
          React.createElement(Text, {
            type: 'password',
            passwordVisibilityToggle: true,
            value: confirmPassword,
            onChange: handleConfirmChange,
            placeholder: 'Confirm password',
            error: !!errors.passwordMismatch,
          })
        ),

      // Action buttons
      React.createElement(
        'div',
        { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' } },
        React.createElement(Button, { appearance: 'subtle', onClick: onCancel, children: 'Cancel' }),
        React.createElement(
          Button,
          { appearance: 'primary', type: 'submit', children: credential ? 'Update' : 'Create' }
        )
      )
    );
  };

  return renderFormContent();
}

// Export component
module.exports = CredentialForm;
