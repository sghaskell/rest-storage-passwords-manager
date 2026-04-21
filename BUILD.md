# Building the React Application

This document describes how to build and deploy the React-based Credential Manager.

## Prerequisites

- Node.js 18+ (with npm or pnpm)
- Splunk Enterprise or Splunk Cloud access

## Development Setup

```bash
# Install dependencies
npm install
# or
pnpm install

# Start development server
npm run dev
# or
pnpm dev
```

The development server runs at `http://localhost:5173`.

## Production Build

```bash
# Build for production
npm run build
# or
pnpm build
```

This creates `appserver/static/react/bundle.js` which is ready for deployment.

## Deployment

1. Ensure the app is packaged correctly:
   ```bash
   # The build output should be at:
   appserver/static/react/bundle.js
   ```

2. Install the app to Splunk:
   - Copy the entire `rest-storage-passwords-manager` directory to `$SPLUNK_HOME/etc/apps/`
   - Or upload via Splunk Web -> Manage Apps -> Install app from file

3. Restart Splunk:
   ```bash
   $SPLUNK_HOME/bin/splunk restart
   ```

4. Access the app at:
   ```
   http://<splunk-host>:<port>/en-US/app/rest-storage-passwords-manager/credential_management
   ```

## Project Structure

```
rest-storage-passwords-manager/
├── appserver/static/react/
│   ├── main.jsx              # Entry point (RequireJS wrapper)
│   └── components/
│       ├── CredentialManager.jsx   # Main app component
│       ├── CredentialTable.jsx     # Table component
│       ├── CredentialForm.jsx      # Form component
│       └── Modal.jsx               # Modal dialog
├── default/data/ui/
│   ├── pages/credentials.jsx   # Splunk custom page entry
│   └── views/credential_management.xml  # XML dashboard
├── package.json
└── vite.config.js
```

## Development Workflow

1. **Make changes** to React components in `appserver/static/react/components/`
2. **Run dev server** to see changes in real-time
3. **Build** when ready to test in Splunk
4. **Deploy** by copying to Splunk or using Splunk's app install

## Troubleshooting

### React not loading
- Check browser console for JavaScript errors
- Ensure `bundle.js` exists in `appserver/static/react/`
- Verify Splunk can serve static files

### API calls failing
- Check Splunk session key is included (`credentials: 'include'`)
- Verify CSRF token is sent (`X-Splunk-Form-Key`)
- Ensure proper permissions (`admin_all_objects` for write, `list_storage_passwords` for read)

### CSS styling issues
- Splunk CSS classes are used for consistency
- Custom styles are in `credential_management.xml`
- Inspect element to debug styling
