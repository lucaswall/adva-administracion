# ADVA Apps Script Deployment

This folder contains the Google Apps Script code that adds a custom "ADVA" menu to the Control spreadsheets.

## Setup

### 1. Create Template Spreadsheet (One-Time)

1. Create a new empty spreadsheet in your Google Drive
2. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
3. Open Apps Script editor: **Extensions → Apps Script**
4. Note the Script ID from the URL:
   ```
   https://script.google.com/home/projects/SCRIPT_ID_HERE/edit
   ```

### 2. Configure Environment Variables

Add these to your `.env` file:

```bash
# Template spreadsheet ID (the empty spreadsheet with the script)
CONTROL_TEMPLATE_ID=your_spreadsheet_id_here
```

The script ID is used locally for deployment only (not needed in production).

### 3. Configure clasp

Copy the example file and add your script ID:

```bash
cd apps-script
cp .clasp.json.example .clasp.json
```

Edit `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your actual script ID.

**Note:** `.clasp.json` is gitignored and will not be committed to the repository.

### 4. Install clasp

Install clasp globally (one-time):

```bash
npm install -g @google/clasp
```

Login to your Google Account (one-time):

```bash
clasp login
```

## Deployment

### Deploy Script to Template Spreadsheet

From the **project root directory**, run:

```bash
npm run deploy:script
```

This pushes the code from `apps-script/` to your template spreadsheet.

### Manual Deployment

```bash
cd apps-script
clasp push
```

## What the Script Does

Adds a custom **ADVA** menu with the following options:

1. **🔄 Trigger Scan** - Calls `POST /api/scan` to process new documents
2. **🔗 Trigger Re-match** - Calls `POST /api/rematch` to re-match unmatched documents
3. **🏦 Auto-fill Bank Data** - Calls `POST /api/autofill-bank` to fill bank information
4. **⚙️ Configure API URL** - Sets the server URL (stored in Script Properties)
5. **ℹ️ About** - Shows information about the menu

## Testing the Menu

1. Open your template spreadsheet
2. Refresh the page (the `onOpen()` trigger runs on page load)
3. You should see an "ADVA" menu in the menu bar
4. Click "ADVA → Configure API URL" and set your server URL
5. Test the menu items

## How It Works with the Server

When the server creates "Control de Creditos" or "Control de Debitos" spreadsheets:

1. It **copies** the template spreadsheet (using `CONTROL_TEMPLATE_ID`)
2. The Apps Script is automatically included in the copy
3. Users opening the spreadsheet see the ADVA menu automatically

This approach works with service account authentication (no OAuth required).

## File Structure

```
apps-script/
├── Code.js                    # Main script with menu functions
├── appsscript.json            # Apps Script manifest
├── .clasp.json                # clasp config (gitignored, contains script ID)
├── .clasp.json.example        # Template for clasp config
└── README.md                  # This file
```

## Troubleshooting

### "Script not found" error
- Make sure you're logged in: `clasp login`
- Verify the script ID in `.clasp.json` matches your project
- Check that you have edit permissions on the script

### Menu doesn't appear
- Refresh the spreadsheet page
- Check browser console for errors
- Verify the script is deployed: Extensions → Apps Script

### API calls fail
- Configure the API URL: ADVA → Configure API URL
- Make sure your server is running and accessible
- Check server logs for errors

### clasp push fails
- Ensure `.clasp.json` exists in `apps-script/` directory
- Verify you're logged in with the correct Google account
- Try `clasp login --creds <file>` if using service account

## Security Notes

- The script only requires minimal permissions (current spreadsheet only)
- API URL is stored in Script Properties (not visible to spreadsheet viewers)
- No sensitive data is stored in the script
- All API calls should use HTTPS in production
- Script ID and Spreadsheet ID are kept out of version control
