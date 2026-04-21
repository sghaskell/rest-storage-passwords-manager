/**
 * Modal.jsx - Modal component for password reveal and imports
 *
 * Provides a reusable modal dialog component using plain React
 */

const React = require('react');

/**
 * PasswordRevealModal - Modal to securely display clear-text passwords
 */
function PasswordRevealModal({ credential, onClose, children }) {
    const [password, setPassword] = React.useState('');
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        if (credential) {
            // Fetch the actual password from the API
            // The password is stored encrypted and needs to be retrieved
            const fetchPassword = async () => {
                try {
                    // Note: This requires a separate API endpoint or method
                    // For now, we'll show a placeholder
                    setPassword('********');
                } catch (error) {
                    console.error('Error fetching password:', error);
                } finally {
                    setLoading(false);
                }
            };
            fetchPassword();
        }
    }, [credential]);

    if (!credential) return null;

    return React.createElement(
        'div',
        {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000,
            },
        },
        React.createElement(
            'div',
            {
                style: {
                    backgroundColor: '#fff',
                    borderRadius: '4px',
                    width: '400px',
                    maxWidth: '90%',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.33)',
                },
            },
            React.createElement(
                'div',
                {
                    style: {
                        padding: '1rem 1.5rem',
                        borderBottom: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    },
                },
                React.createElement('h3', { style: { margin: 0 } }, `Password for ${credential.name}`),
                React.createElement(
                    'button',
                    {
                        onClick: onClose,
                        style: {
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            color: '#666',
                        },
                    },
                    '×'
                )
            ),
            React.createElement(
                'div',
                { style: { padding: '1.5rem' } },
                // If children provided (for form), render them
                children
                    ? children
                    : React.createElement('div', { style: { marginBottom: '1rem' } },
                          React.createElement('label', { style: { display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' } }, 'Password'),
                          React.createElement('input', {
                              type: 'password',
                              value: password,
                              readOnly: true,
                              style: {
                                  width: '100%',
                                  padding: '0.5rem',
                                  border: '1px solid #ccc',
                                  borderRadius: '4px',
                                  fontFamily: 'monospace',
                              },
                          })
                      ),
                !children &&
                    React.createElement(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end' } },
                        React.createElement(
                            'button',
                            {
                                onClick: onClose,
                                style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: '#f0f0f0',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                },
                            },
                            'Close'
                        )
                    )
            )
        )
    );
}

/**
 * ImportCSVModal - Modal for CSV import with drag/drop
 */
function ImportCSVModal({ isOpen, onClose, onImport }) {
    const [dragActive, setDragActive] = React.useState(false);
    const [file, setFile] = React.useState(null);
    const [preview, setPreview] = React.useState('');
    const [loading, setLoading] = React.useState(false);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (fileObj) => {
        setFile(fileObj);

        // Read file content for preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const lines = content.split('\n').slice(0, 5);
            setPreview(lines.join('\n'));
        };
        reader.readAsText(fileObj);
    };

    const handleImport = async () => {
        if (!file) return;

        setLoading(true);
        try {
            const content = await file.text();
            await onImport(content);
            setLoading(false);
            onClose();
        } catch (error) {
            console.error('Error importing CSV:', error);
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return React.createElement(
        'div',
        {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000,
            },
        },
        React.createElement(
            'div',
            {
                style: {
                    backgroundColor: '#fff',
                    borderRadius: '4px',
                    width: '500px',
                    maxWidth: '90%',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.33)',
                },
            },
            React.createElement(
                'div',
                {
                    style: {
                        padding: '1rem 1.5rem',
                        borderBottom: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    },
                },
                React.createElement('h3', { style: { margin: 0 } }, 'Import Credentials from CSV'),
                React.createElement(
                    'button',
                    {
                        onClick: onClose,
                        style: {
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            color: '#666',
                        },
                    },
                    '×'
                )
            ),
            React.createElement(
                'div',
                { style: { padding: '1.5rem' } },
                React.createElement('p', null, 'Drag and drop your CSV file here, or click to select.'),

                React.createElement('input', {
                    type: 'file',
                    accept: '.csv',
                    onChange: handleChange,
                    style: { display: 'none' },
                    id: 'csv-file-input',
                }),
                React.createElement(
                    'div',
                    {
                        onDragEnter: handleDrag,
                        onDragLeave: handleDrag,
                        onDragOver: handleDrag,
                        onDrop: handleDrop,
                        onClick: () => document.getElementById('csv-file-input').click(),
                        style: {
                            border: '2px dashed #ccc',
                            borderRadius: '4px',
                            padding: '2rem',
                            textAlign: 'center',
                            backgroundColor: dragActive ? '#f0f0f0' : '#fff',
                            marginTop: '1rem',
                            cursor: 'pointer',
                        },
                    },
                    React.createElement('p', null, file ? file.name : 'Click to select or drag file')
                ),

                file &&
                    React.createElement(
                        'div',
                        { style: { marginTop: '1rem' } },
                        React.createElement('h4', null, 'Preview (first 5 lines):'),
                        React.createElement('textarea', {
                            value: preview,
                            readOnly: true,
                            rows: 5,
                            style: {
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                fontFamily: 'monospace',
                                resize: 'vertical',
                            },
                        })
                    ),

                React.createElement(
                    'div',
                    { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' } },
                    React.createElement(
                        'button',
                        { onClick: onClose, style: { padding: '0.5rem 1rem' } },
                        'Cancel'
                    ),
                    React.createElement(
                        'button',
                        {
                            onClick: handleImport,
                            style: {
                                padding: '0.5rem 1rem',
                                backgroundColor: '#1565c0',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            },
                            disabled: !file || loading,
                        },
                        loading ? 'Importing...' : 'Import'
                    )
                )
            )
        )
    );
}

/**
 * ConfirmDeleteModal - Modal for confirming credential deletion
 */
function ConfirmDeleteModal({ credential, isOpen, onClose, onDelete, children }) {
    if (!isOpen) return null;

    return React.createElement(
        'div',
        {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000,
            },
        },
        React.createElement(
            'div',
            {
                style: {
                    backgroundColor: '#fff',
                    borderRadius: '4px',
                    width: credential ? '400px' : '600px',
                    maxWidth: '90%',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.33)',
                },
            },
            React.createElement(
                'div',
                {
                    style: {
                        padding: '1rem 1.5rem',
                        borderBottom: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    },
                },
                React.createElement('h3', { style: { margin: 0 } }, credential ? 'Delete Credential' : (children ? 'Create/Edit Credential' : '')),
                React.createElement(
                    'button',
                    {
                        onClick: onClose,
                        style: {
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            color: '#666',
                        },
                    },
                    '×'
                )
            ),
            React.createElement(
                'div',
                { style: { padding: '1.5rem' } },
                // If children provided (for form), render them
                children
                    ? children
                    : React.createElement(
                          'p',
                          null,
                          'Are you sure you want to delete the credential ',
                          React.createElement('strong', null, credential ? credential.name : ''),
                          '? This action cannot be undone.'
                      ),
                !children &&
                    React.createElement(
                        'div',
                        { style: { marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' } },
                        React.createElement(
                            'button',
                            { onClick: onClose, style: { padding: '0.5rem 1rem' } },
                            'Cancel'
                        ),
                        React.createElement(
                            'button',
                            {
                                onClick: onDelete,
                                style: {
                                    padding: '0.5rem 1rem',
                                    backgroundColor: '#d32f2f',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                },
                            },
                            'Delete'
                        )
                    )
            )
        )
    );
}

/**
 * Export all modal components
 */
module.exports = {
    PasswordRevealModal,
    ImportCSVModal,
    ConfirmDeleteModal,
};
