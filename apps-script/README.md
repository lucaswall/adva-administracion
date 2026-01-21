# ADVA Apps Script Library

Shared library providing the ADVA menu for Control spreadsheets.

## Architecture

- **This folder**: Contains the shared library code
- **Template spreadsheet**: Has minimal bound script + library reference
- **New spreadsheets**: Inherit library reference when copied from template

## Setup (One-Time)

### 1. Create Library Project in Google

**Option A - Using clasp:**
```bash
cd apps-script
clasp create --title "ADVA Menu Library" --type standalone
# This creates .clasp.json with the new Script ID
```

**Option B - Manually:**
1. Go to https://script.google.com → New Project
2. Name it "ADVA Menu Library"
3. Copy Script ID from URL
4. Create `.clasp.json`:
   ```json
   {
     "scriptId": "YOUR_SCRIPT_ID_HERE",
     "rootDir": "."
   }
   ```

### 2. Deploy Library Code

```bash
npm run deploy:library
```

### 3. Create Template Spreadsheet

1. Create a new empty spreadsheet in Google Drive
2. Note the spreadsheet ID from URL
3. Open Apps Script: **Extensions → Apps Script**

### 4. Add Library Reference to Template

In the template's Apps Script editor:
1. Click **+** next to "Libraries" in left sidebar
2. Enter the library Script ID (from step 1)
3. Set identifier: **ADVALib** (must be exact)
4. Select version: **HEAD** (Development mode)
5. Click **Add**

### 5. Add Bound Script to Template

In the template's Apps Script editor, replace the default code with:

```javascript
/**
 * Trigger that runs when spreadsheet opens.
 * Delegates to shared ADVALib library for menu creation.
 */
function onOpen() {
  ADVALib.createMenu();
}
```

Save the script.

### 6. Configure Server Environment

Add to your `.env`:
```bash
CONTROL_TEMPLATE_ID=your_template_spreadsheet_id
```

## Deployment

After modifying library code:
```bash
npm run deploy:library
```

Changes are immediately available to all spreadsheets (HEAD mode).

## File Structure

```
apps-script/
├── Code.js               # Library code (all menu logic)
├── appsscript.json       # Library manifest
├── .clasp.json           # Library Script ID (gitignored)
├── .clasp.json.example   # Template for clasp config
└── README.md             # This file
```

## Menu Functions

| Menu Item | API Endpoint |
|-----------|--------------|
| 🔄 Trigger Scan | POST /api/scan |
| 🔗 Trigger Re-match | POST /api/rematch |
| 🏦 Auto-fill Bank Data | POST /api/autofill-bank |
| ⚙️ Configure API URL | (Script Properties) |
| ℹ️ About | (Info dialog) |

## Adding New Menu Items

1. Edit `Code.js` - add function and menu item
2. Menu callback must use `ADVALib.` prefix: `'ADVALib.newFunction'`
3. Run `npm run deploy:library`
4. All spreadsheets get the new item automatically

## Troubleshooting

### Menu doesn't appear
- Refresh the spreadsheet
- Check Extensions → Apps Script for errors
- Verify library is added with identifier `ADVALib`

### "ADVALib is not defined"
- Library not added to template
- Wrong identifier (must be exactly `ADVALib`)
- Library not deployed

### API calls fail
- Configure URL: ADVA → Configure API URL
- Check server is running and accessible
