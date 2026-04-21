/**
 * bundle.jsx - Self-contained React application for Credential Manager
 * 
 * This file contains all components in a single file for easier deployment.
 * It uses Splunk's RequireJS pattern for loading.
 */

define([
    'react',
    'react-dom',
    'underscore'
], function(React, ReactDOM, _) {
    'use strict';

    // ─── Utility Functions ──────────────────────────────────────────────────────

    function currentUser() {
        return Splunk.util.getConfigValue('USERNAME');
    }

    async function splunkdFetch(method, path, data) {
        const url = `/en-US/splunkd/__raw${path}`;
        
        const csrfToken = document.cookie.split('; ')
            .find(row => row.startsWith('splunkweb_csrf_token'))
            ?.split('=')[1];

        const opts = {
            method,
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        };

        if (csrfToken) {
            opts.headers['X-Splunk-Form-Key'] = csrfToken;
        }

        if (data) {
            opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            opts.body = data;
        }

        const response = await fetch(url, opts);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.messages?.[0]?.text || response.statusText);
        }

        return await response.json();
    }

    function el(tag, props, ...children) {
        const element = React.createElement(tag, props);
        if (children && children.length > 0) {
            element.props.children = children;
        }
        return element;
    }

    // ─── Modal Component ────────────────────────────────────────────────────────

    function Modal({ title, body, type = 'info', showClose = true, onClose }) {
        if (!title) return null;

        const containerStyle = {
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        };

        const contentStyle = {
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '20px',
            minWidth: '300px',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto'
        };

        const headerStyle = {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
        };

        const bodyStyle = {
            marginBottom: '16px'
        };

        const bodyContentStyle = {
            backgroundColor: '#f5f5f5',
            padding: '12px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
        };

        const footerStyle = {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px'
        };

        return el('div', { className: 'modal', onClick: (e) => {
            if (e.target === e.currentTarget && onClose) onClose();
        } },
            el('div', { className: 'modal-content', style: contentStyle },
                el('div', { className: 'modal-header', style: headerStyle },
                    el('h3', {}, title),
                    showClose && el('button', {
                        className: 'modal-close',
                        onClick: onClose,
                        style: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666' }
                    }, '×')
                ),
                el('div', { className: 'modal-body', style: bodyStyle },
                    el('pre', { className: 'modal-body-content', style: bodyContentStyle }, body)
                ),
                showClose && el('div', { className: 'modal-footer', style: footerStyle },
                    el('button', {
                        className: 'btn btn-primary',
                        onClick: onClose,
                        style: { padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', backgroundColor: '#0070d2', color: 'white' }
                    }, 'Close')
                )
            )
        );
    }

    // ─── Credential Form Component ──────────────────────────────────────────────

    function CredentialForm({ mode = 'create', onSubmit, onCancel, credential }) {
        const [formData, setFormData] = React.useState({
            username: credential?.username || '',
            password: '',
            realm: credential?.realm || '',
            owner: credential?.owner || currentUser() || 'nobody',
            app: credential?.app || 'rest-storage-passwords-manager',
            sharing: credential?.sharing || 'app',
            acl_read: credential?.acl_read || 'admin,power',
            acl_write: credential?.acl_write || 'admin,power',
            errors: {}
        });

        function handleChange(field, value) {
            setFormData(prev => ({
                ...prev,
                [field]: value,
                errors: { ...prev.errors, [field]: '' }
            }));
        }

        function buildStanza() {
            const realm = formData.realm ? formData.realm + ':' : '';
            return realm + formData.username + ':';
        }

        function validate() {
            const errors = {};
            if (!formData.username.trim()) errors.username = 'Username is required';
            if (!formData.password && mode !== 'update') errors.password = 'Password is required';
            if (formData.sharing === 'user' && !formData.owner) errors.owner = 'Owner is required when sharing is "user"';
            return errors;
        }

        function handleSubmit(e) {
            e.preventDefault();
            const errors = validate();
            if (Object.keys(errors).length > 0) {
                setFormData(prev => ({ ...prev, errors }));
                return;
            }

            onSubmit({
                username: formData.username.trim(),
                password: formData.password,
                realm: formData.realm.trim(),
                owner: formData.owner,
                app: formData.app,
                sharing: formData.sharing,
                acl_read: formData.acl_read,
                acl_write: formData.acl_write,
                stanza: buildStanza()
            });
        }

        const inputStyle = { width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' };
        const errorInputStyle = { ...inputStyle, borderColor: '#ff4444' };
        const labelStyle = { display: 'block', marginBottom: '4px', fontWeight: 500 };
        const formStyle = { marginBottom: '20px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px' };
        const rowStyle = { marginBottom: '16px' };
        const actionsStyle = { display: 'flex', gap: '8px', marginTop: '20px' };

        return el('div', { className: 'credential-form', style: formStyle },
            el('h2', {}, mode === 'create' ? 'New Credential' : 'Update Credential'),
            el('form', { onSubmit: handleSubmit },
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'username', style: labelStyle }, 'Username:'),
                    el('input', {
                        type: 'text',
                        id: 'username',
                        value: formData.username,
                        onChange: e => handleChange('username', e.target.value),
                        style: formData.errors.username ? errorInputStyle : inputStyle,
                        placeholder: 'e.g., api-user'
                    }),
                    formData.errors.username && el('span', { style: { color: '#ff4444', fontSize: '12px', marginTop: '4px', display: 'block' } }, formData.errors.username)
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'password', style: labelStyle }, 'Password:'),
                    el('input', {
                        type: 'password',
                        id: 'password',
                        value: formData.password,
                        onChange: e => handleChange('password', e.target.value),
                        style: formData.errors.password ? errorInputStyle : inputStyle,
                        placeholder: 'Enter password'
                    }),
                    formData.errors.password && el('span', { style: { color: '#ff4444', fontSize: '12px', marginTop: '4px', display: 'block' } }, formData.errors.password)
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'realm', style: labelStyle }, 'Realm (optional):'),
                    el('input', {
                        type: 'text',
                        id: 'realm',
                        value: formData.realm,
                        onChange: e => handleChange('realm', e.target.value),
                        style: inputStyle,
                        placeholder: 'e.g., prod, dev'
                    })
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'owner', style: labelStyle }, 'Owner:'),
                    el('input', {
                        type: 'text',
                        id: 'owner',
                        value: formData.owner,
                        onChange: e => handleChange('owner', e.target.value),
                        style: inputStyle,
                        placeholder: 'e.g., admin'
                    }),
                    formData.errors.owner && el('span', { style: { color: '#ff4444', fontSize: '12px', marginTop: '4px', display: 'block' } }, formData.errors.owner)
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'app', style: labelStyle }, 'App:'),
                    el('input', {
                        type: 'text',
                        id: 'app',
                        value: formData.app,
                        onChange: e => handleChange('app', e.target.value),
                        style: inputStyle
                    })
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'sharing', style: labelStyle }, 'Sharing:'),
                    el('select', {
                        id: 'sharing',
                        value: formData.sharing,
                        onChange: e => handleChange('sharing', e.target.value),
                        style: inputStyle
                    },
                        el('option', { value: 'global' }, 'Global'),
                        el('option', { value: 'app' }, 'App'),
                        el('option', { value: 'user' }, 'User')
                    )
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'acl_read', style: labelStyle }, 'Read Users:'),
                    el('input', {
                        type: 'text',
                        id: 'acl_read',
                        value: formData.acl_read,
                        onChange: e => handleChange('acl_read', e.target.value),
                        style: inputStyle,
                        placeholder: 'e.g., admin,power'
                    })
                ),
                el('div', { style: rowStyle },
                    el('label', { htmlFor: 'acl_write', style: labelStyle }, 'Write Users:'),
                    el('input', {
                        type: 'text',
                        id: 'acl_write',
                        value: formData.acl_write,
                        onChange: e => handleChange('acl_write', e.target.value),
                        style: inputStyle,
                        placeholder: 'e.g., admin,power'
                    })
                ),
                el('div', { style: actionsStyle },
                    el('button', { type: 'submit', style: { padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', backgroundColor: '#0070d2', color: 'white' } },
                        mode === 'create' ? 'Create' : 'Update'
                    ),
                    el('button', {
                        type: 'button',
                        style: { padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', backgroundColor: '#666', color: 'white' },
                        onClick: onCancel
                    }, 'Cancel')
                )
            )
        );
    }

    // ─── Credential Table Component ─────────────────────────────────────────────

    function CredentialTable({ credentials, loading, filterText, currentPage, totalPages, selectedCredentials, onFilterChange, onPageChange, onSelectCredential, onSelectAll, onShowPassword, onUpdateCredential, onDeleteCredentials }) {
        const [showForm, setShowForm] = React.useState(false);
        const [editCredential, setEditCredential] = React.useState(null);
        const [deleteConfirm, setDeleteConfirm] = React.useState(null);

        const filteredCredentials = credentials.filter(cred => {
            const search = filterText.toLowerCase();
            return (
                cred.name.toLowerCase().includes(search) ||
                (cred.content?.realm && cred.content.realm.toLowerCase().includes(search)) ||
                (cred.content?.app && cred.content.app.toLowerCase().includes(search))
            );
        });

        const paginatedCredentials = filteredCredentials.slice((currentPage - 1) * 10, currentPage * 10);
        const totalPagesCalculated = Math.ceil(filteredCredentials.length / 10);

        function handleCreateSubmit(formData) {
            splunkdFetch('POST', '/servicesNS/-/rest-storage-passwords-manager/storage/passwords',
                `name=${encodeURIComponent(formData.stanza)}&username=${encodeURIComponent(formData.username)}&password=${encodeURIComponent(formData.password)}`
            ).then(() => {
                return splunkdFetch('POST', `/servicesNS/-/rest-storage-passwords-manager/configs/conf-passwords/credential%3A${encodeURIComponent(formData.stanza)}%3A/acl`,
                    `perms.read=${encodeURIComponent(formData.acl_read)}&perms.write=${encodeURIComponent(formData.acl_write)}&sharing=${encodeURIComponent(formData.sharing)}&owner=${encodeURIComponent(formData.owner)}`
                );
            }).then(() => {
                window.location.reload();
            }).catch(err => alert('Error: ' + err.message));
        }

        function handleUpdateSubmit(stanza, formData) {
            splunkdFetch('POST', `/servicesNS/-/rest-storage-passwords-manager/storage/passwords/${encodeURIComponent(stanza)}`,
                `password=${encodeURIComponent(formData.password)}`
            ).then(() => {
                window.location.reload();
            }).catch(err => alert('Error: ' + err.message));
        }

        function handleDeleteConfirm() {
            if (deleteConfirm) {
                onDeleteCredentials(deleteConfirm);
                setDeleteConfirm(null);
            }
        }

        const containerStyle = { flex: 1, display: 'flex', flexDirection: 'column' };
        const tableStyle = { width: '100%', borderCollapse: 'collapse', marginBottom: '20px' };
        const thStyle = { padding: '8px 12px', borderBottom: '1px solid #e0e0e0', textAlign: 'left', backgroundColor: '#f5f5f5', fontWeight: 600 };
        const tdStyle = { padding: '8px 12px', borderBottom: '1px solid #e0e0e0' };
        const checkboxStyle = { width: '40px', textAlign: 'center' };
        const filterStyle = { width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', marginBottom: '16px', boxSizing: 'border-box' };
        const paginationStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
        const btnStyle = { padding: '6px 12px', backgroundColor: '#0070d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
        const btnIconStyle = { background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' };
        const btnDangerStyle = { ...btnStyle, backgroundColor: '#ff4444' };

        return el('div', { style: containerStyle },
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } },
                el('button', {
                    style: { padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', backgroundColor: '#0070d2', color: 'white' },
                    onClick: () => { setShowForm(true); setEditCredential(null); }
                }, '+ New Credential'),
                el('button', {
                    style: { ...btnDangerStyle, visibility: selectedCredentials.length > 0 ? 'visible' : 'hidden' },
                    onClick: () => setDeleteConfirm(selectedCredentials)
                }, 'Delete (' + selectedCredentials.length + ')')
            ),
            el('input', {
                type: 'text',
                placeholder: 'Filter by username, realm, or app...',
                value: filterText,
                onChange: e => onFilterChange(e.target.value),
                style: filterStyle
            }),
            loading ? el('div', { style: { textAlign: 'center', padding: '40px', color: '#666' } },
                el('div', { style: { border: '3px solid #f3f3f3', border-top: '3px solid #0070d2', borderRadius: '50%', width: '30px', height: '30px', animation: 'spin 1s linear infinite', margin: '0 auto' } }),
                'Loading credentials...'
            ) : filteredCredentials.length === 0 ? el('div', { style: { textAlign: 'center', padding: '40px', color: '#666' } },
                filterText ? 'No credentials match your filter.' : 'No credentials found. Click "+ New Credential" to add one.'
            ) : el('table', { style: tableStyle },
                el('thead', {},
                    el('tr', {},
                        el('th', { style: checkboxStyle },
                            el('input', {
                                type: 'checkbox',
                                checked: selectedCredentials.length === filteredCredentials.length && filteredCredentials.length > 0,
                                indeterminate: selectedCredentials.length > 0 && selectedCredentials.length < filteredCredentials.length,
                                onChange: e => onSelectAll(e.target.checked)
                            })
                        ),
                        el('th', { style: thStyle }, 'Username'),
                        el('th', { style: thStyle }, 'Realm'),
                        el('th', { style: thStyle }, 'App'),
                        el('th', { style: thStyle }, 'Owner'),
                        el('th', { style: thStyle }, 'Actions')
                    )
                ),
                el('tbody', {},
                    paginatedCredentials.map(cred => {
                        const username = cred.content?.username || cred.name;
                        const realm = cred.content?.realm || '';
                        const app = cred.content?.app || '';
                        const owner = cred.content?.owner || '';
                        const isSelected = selectedCredentials.includes(cred.name);

                        return el('tr', {
                            key: cred.name,
                            style: { cursor: 'pointer' },
                            onClick: () => { setEditCredential(cred); setShowForm(true); }
                        },
                            el('td', { style: tdStyle },
                                el('input', {
                                    type: 'checkbox',
                                    checked: isSelected,
                                    onClick: e => e.stopPropagation(),
                                    onChange: () => onSelectCredential(cred.name)
                                })
                            ),
                            el('td', { style: tdStyle }, username),
                            el('td', { style: tdStyle }, realm),
                            el('td', { style: tdStyle }, app),
                            el('td', { style: tdStyle }, owner),
                            el('td', { style: tdStyle },
                                el('button', {
                                    style: btnIconStyle,
                                    onClick: e => { e.stopPropagation(); onShowPassword(cred.name); }
                                }, '👁️'),
                                el('button', {
                                    style: { ...btnIconStyle, color: '#0070d2' },
                                    onClick: e => { e.stopPropagation(); setEditCredential(cred); setShowForm(true); }
                                }, '✏️')
                            )
                        );
                    })
                )
            ),
            el('div', { style: paginationStyle },
                currentPage > 1 && el('button', { style: btnStyle, onClick: () => onPageChange(currentPage - 1) }, 'Previous'),
                el('span', {}, 'Page ' + currentPage + ' of ' + (totalPagesCalculated || 1)),
                currentPage < totalPagesCalculated && el('button', { style: btnStyle, onClick: () => onPageChange(currentPage + 1) }, 'Next')
            ),
            showForm && el('div', { style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999 } },
                el('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } },
                    el(CredentialForm, {
                        mode: editCredential ? 'update' : 'create',
                        credential: editCredential?.content,
                        onSubmit: formData => editCredential ? handleUpdateSubmit(editCredential.name, formData) : handleCreateSubmit(formData),
                        onCancel: () => { setShowForm(false); setEditCredential(null); }
                    })
                )
            ),
            deleteConfirm && el('div', { style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 } },
                el('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', padding: '20px', borderRadius: '8px', minWidth: '300px' } },
                    el('h3', {}, 'Delete Credentials'),
                    el('p', {}, 'Are you sure you want to delete ' + deleteConfirm.length + ' credential(s)?'),
                    el('div', { style: { display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' } },
                        el('button', { style: { ...btnDangerStyle, padding: '8px 16px' }, onClick: handleDeleteConfirm }, 'Yes, Delete'),
                        el('button', { style: { ...btnStyle, backgroundColor: '#666', padding: '8px 16px' }, onClick: () => setDeleteConfirm(null) }, 'Cancel')
                    )
                )
            )
        );
    }

    // ─── Main Credential Manager Component ──────────────────────────────────────

    function CredentialManager() {
        const [credentials, setCredentials] = React.useState([]);
        const [loading, setLoading] = React.useState(true);
        const [filterText, setFilterText] = React.useState('');
        const [currentPage, setCurrentPage] = React.useState(1);
        const [selectedCredentials, setSelectedCredentials] = React.useState([]);
        const [modal, setModal] = React.useState(null);

        React.useEffect(() => {
            fetchCredentials();
        }, []);

        async function fetchCredentials() {
            setLoading(true);
            try {
                const data = await splunkdFetch('GET', '/servicesNS/-/rest-storage-passwords-manager/storage/passwords');
                setCredentials(data.entry || []);
                setLoading(false);
            } catch (error) {
                setModal({ title: 'Error', body: 'Failed to load credentials: ' + error.message, type: 'error' });
                setLoading(false);
            }
        }

        async function handleShowPassword(stanza) {
            try {
                const data = await splunkdFetch('GET', `/servicesNS/-/rest-storage-passwords-manager/storage/passwords/${encodeURIComponent(stanza)}?output_mode=json`);
                const password = data.entry?.[0]?.content?.clear_password;
                setModal({ title: 'Password', body: password || 'Password not found', type: 'info' });
            } catch (error) {
                setModal({ title: 'Error', body: 'Failed to retrieve password', type: 'error' });
            }
        }

        function handleCloseModal() {
            setModal(null);
        }

        return el(CredentialTable, {
            credentials: credentials,
            loading: loading,
            filterText: filterText,
            currentPage: currentPage,
            totalPages: Math.ceil(credentials.length / 10),
            selectedCredentials: selectedCredentials,
            onFilterChange: setFilterText,
            onPageChange: setCurrentPage,
            onSelectCredential: (name) => {
                setSelectedCredentials(prev => {
                    const idx = prev.indexOf(name);
                    if (idx === -1) return [...prev, name];
                    return prev.filter(n => n !== name);
                });
            },
            onSelectAll: (checked) => {
                setSelectedCredentials(checked ? credentials.map(c => c.name) : []);
            },
            onShowPassword: handleShowPassword,
            onUpdateCredential: (stanza, formData) => {
                splunkdFetch('POST', `/servicesNS/-/rest-storage-passwords-manager/storage/passwords/${encodeURIComponent(stanza)}`,
                    `password=${encodeURIComponent(formData.password)}`
                ).then(() => window.location.reload());
            },
            onDeleteCredentials: (credentialsToDelete) => {
                const promises = credentialsToDelete.map(name =>
                    splunkdFetch('DELETE', `/servicesNS/-/rest-storage-passwords-manager/storage/passwords/${encodeURIComponent(name)}`)
                );
                Promise.all(promises).then(() => window.location.reload());
            }
        });
    }

    // ─── Initialization ─────────────────────────────────────────────────────────

    function init() {
        const container = document.getElementById('credential-manager-app');
        if (!container) {
            console.error('Credential Manager: Container element not found');
            return;
        }

        // Check if React is available
        if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
            console.error('Credential Manager: React not loaded');
            container.innerHTML = '<p style="color:red">Error: React not loaded. Please refresh the page.</p>';
            return;
        }

        const root = ReactDOM.createRoot(container);
        root.render(el(CredentialManager));
    }

    // Load Splunk's ready! trigger
    require(['splunkjs/mvc/simplexml/ready!'], function() {
        init();
    });

    return { init: init };
});
