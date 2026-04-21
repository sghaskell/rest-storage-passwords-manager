/**
 * CredentialTable.jsx - Table component for displaying credentials
 *
 * Displays credentials in a table with pagination, filtering, and sorting
 */

const React = require('react');

/**
 * CredentialTable - Table component for credential management
 *
 * @param {Object} props - Component props
 * @param {Array} props.credentials - Array of credential objects
 * @param {Function} props.onEdit - Callback when edit is clicked
 * @param {Function} props.onDelete - Callback when delete is clicked
 * @param {Function} props.onReveal - Callback when reveal password is clicked
 */
function CredentialTable({
    credentials = [],
    onEdit,
    onDelete,
    onReveal,
}) {
    const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });
    const [currentPage, setCurrentPage] = React.useState(1);
    const [filterText, setFilterText] = React.useState('');
    const [filterType, setFilterType] = React.useState('all');

    const itemsPerPage = 10;

    // Filter credentials
    const filteredCredentials = React.useMemo(() => {
        if (!filterText) return credentials;

        return credentials.filter((credential) => {
            const name = credential.name || '';
            const realm = credential.realm || '';
            const app = credential.app || '';
            const owner = credential.owner || '';

            if (filterType === 'all') {
                return (
                    name.toLowerCase().includes(filterText.toLowerCase()) ||
                    realm.toLowerCase().includes(filterText.toLowerCase()) ||
                    app.toLowerCase().includes(filterText.toLowerCase()) ||
                    owner.toLowerCase().includes(filterText.toLowerCase())
                );
            } else if (filterType === 'username') {
                return name.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'realm') {
                return realm.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'app') {
                return app.toLowerCase().includes(filterText.toLowerCase());
            }
            return true;
        });
    }, [credentials, filterText, filterType]);

    // Sort credentials
    const sortedCredentials = React.useMemo(() => {
        if (!sortConfig.key) return filteredCredentials;

        return [...filteredCredentials].sort((a, b) => {
            const aValue = a[sortConfig.key] || '';
            const bValue = b[sortConfig.key] || '';

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredCredentials, sortConfig.key, sortConfig.direction]);

    // Paginate credentials
    const paginatedCredentials = React.useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return sortedCredentials.slice(startIndex, startIndex + itemsPerPage);
    }, [sortedCredentials, currentPage]);

    const totalPages = Math.ceil(sortedCredentials.length / itemsPerPage);

    // Handle sort
    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Handle page change
    const handlePageChange = (page) => {
        setCurrentPage(page);
    };

    // Handle filter change
    const handleFilterChange = (value) => {
        setFilterText(value);
        setCurrentPage(1); // Reset to first page on filter
    };

    // Get sort indicator
    const getSortIndicator = (key) => {
        if (sortConfig.key !== key) return '\u2192';
        return sortConfig.direction === 'asc' ? '\u2191' : '\u2193';
    };

    // Render realm badge
    const renderRealmBadge = (realm) => {
        if (!realm || realm === 'nobody') {
            return React.createElement(
                'span',
                { style: { backgroundColor: '#e0e0e0', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' } },
                'global'
            );
        }
        return React.createElement(
            'span',
            { style: { backgroundColor: '#e3f2fd', color: '#1565c0', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' } },
            realm
        );
    };

    // Render app badge
    const renderAppBadge = (app) => {
        return React.createElement(
            'span',
            { style: { backgroundColor: '#e8f5e9', color: '#2e7d32', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' } },
            app
        );
    };

    return React.createElement(
        'div',
        { className: 'credential-table-container' },
        // Filter bar
        React.createElement(
            'div',
            { style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement('strong', null, 'Search:'),
            React.createElement('input', {
                type: 'text',
                value: filterText,
                onChange: (e) => handleFilterChange(e.target.value),
                placeholder: 'Search credentials...',
                style: {
                    padding: '0.25rem 0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    minWidth: '200px',
                },
            }),
            React.createElement('select', {
                value: filterType,
                onChange: (e) => setFilterType(e.target.value),
                style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' },
            },
                React.createElement('option', { value: 'all' }, 'All Fields'),
                React.createElement('option', { value: 'username' }, 'Username'),
                React.createElement('option', { value: 'realm' }, 'Realm'),
                React.createElement('option', { value: 'app' }, 'App')
            )
        ),

        // Credentials table
        React.createElement(
            'table',
            {
                style: {
                    width: '100%',
                    borderCollapse: 'collapse',
                    marginBottom: '1rem',
                },
            },
            React.createElement(
                'thead',
                null,
                React.createElement(
                    'tr',
                    null,
                    React.createElement(
                        'th',
                        {
                            style: {
                                textAlign: 'left',
                                padding: '0.75rem',
                                borderBottom: '2px solid #e0e0e0',
                                cursor: 'pointer',
                            },
                            onClick: () => handleSort('name'),
                        },
                        'Username ', getSortIndicator('name')
                    ),
                    React.createElement(
                        'th',
                        {
                            style: {
                                textAlign: 'left',
                                padding: '0.75rem',
                                borderBottom: '2px solid #e0e0e0',
                                cursor: 'pointer',
                            },
                            onClick: () => handleSort('realm'),
                        },
                        'Realm ', getSortIndicator('realm')
                    ),
                    React.createElement(
                        'th',
                        {
                            style: {
                                textAlign: 'left',
                                padding: '0.75rem',
                                borderBottom: '2px solid #e0e0e0',
                                cursor: 'pointer',
                            },
                            onClick: () => handleSort('app'),
                        },
                        'App ', getSortIndicator('app')
                    ),
                    React.createElement(
                        'th',
                        {
                            style: {
                                textAlign: 'left',
                                padding: '0.75rem',
                                borderBottom: '2px solid #e0e0e0',
                                cursor: 'pointer',
                            },
                            onClick: () => handleSort('owner'),
                        },
                        'Owner ', getSortIndicator('owner')
                    ),
                    React.createElement(
                        'th',
                        {
                            style: {
                                textAlign: 'left',
                                padding: '0.75rem',
                                borderBottom: '2px solid #e0e0e0',
                            },
                        },
                        'Actions'
                    )
                )
            ),
            React.createElement(
                'tbody',
                null,
                paginatedCredentials.length > 0
                    ? paginatedCredentials.map((cred) =>
                          React.createElement(
                              'tr',
                              { key: cred.name || cred.id, style: { borderBottom: '1px solid #e0e0e0' } },
                              React.createElement(
                                  'td',
                                  { style: { padding: '0.75rem' } },
                                  cred.name || cred.realm
                              ),
                              React.createElement(
                                  'td',
                                  { style: { padding: '0.75rem' } },
                                  renderRealmBadge(cred.realm || 'nobody')
                              ),
                              React.createElement(
                                  'td',
                                  { style: { padding: '0.75rem' } },
                                  renderAppBadge(cred.app || 'search')
                              ),
                              React.createElement(
                                  'td',
                                  { style: { padding: '0.75rem' } },
                                  cred.owner || 'nobody'
                              ),
                              React.createElement(
                                  'td',
                                  { style: { padding: '0.75rem' } },
                                  React.createElement(
                                      'div',
                                      { style: { display: 'flex', gap: '0.25rem' } },
                                      React.createElement(
                                          'button',
                                          {
                                              onClick: () => onEdit && onEdit(cred),
                                              style: {
                                                  padding: '0.25rem 0.5rem',
                                                  backgroundColor: '#f0f0f0',
                                                  border: 'none',
                                                  borderRadius: '4px',
                                                  cursor: 'pointer',
                                              },
                                          },
                                          'Edit'
                                      ),
                                      React.createElement(
                                          'button',
                                          {
                                              onClick: () => onReveal && onReveal(cred),
                                              style: {
                                                  padding: '0.25rem 0.5rem',
                                                  backgroundColor: '#f0f0f0',
                                                  border: 'none',
                                                  borderRadius: '4px',
                                                  cursor: 'pointer',
                                              },
                                          },
                                          'Reveal'
                                      ),
                                      React.createElement(
                                          'button',
                                          {
                                              onClick: () => onDelete && onDelete(cred),
                                              style: {
                                                  padding: '0.25rem 0.5rem',
                                                  backgroundColor: '#ffebee',
                                                  color: '#d32f2f',
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
                      )
                    : React.createElement(
                          'tr',
                          null,
                          React.createElement(
                              'td',
                              {
                                  colSpan: 5,
                                  style: {
                                      textAlign: 'center',
                                      padding: '2rem',
                                      color: '#666',
                                  },
                              },
                              'No credentials found'
                          )
                      )
            )
        ),

        // Pagination
        totalPages > 1 &&
            React.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' } },
                React.createElement(
                    'button',
                    {
                        onClick: () => handlePageChange(Math.max(1, currentPage - 1)),
                        disabled: currentPage === 1,
                        style: {
                            padding: '0.25rem 0.5rem',
                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            opacity: currentPage === 1 ? 0.5 : 1,
                        },
                    },
                    '\u2190 Previous'
                ),
                React.createElement('span', null, `Page ${currentPage} of ${totalPages}`),
                React.createElement(
                    'button',
                    {
                        onClick: () => handlePageChange(Math.min(totalPages, currentPage + 1)),
                        disabled: currentPage === totalPages,
                        style: {
                            padding: '0.25rem 0.5rem',
                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            opacity: currentPage === totalPages ? 0.5 : 1,
                        },
                    },
                    'Next \u2192'
                )
            )
    );
}

// Export component
module.exports = CredentialTable;
