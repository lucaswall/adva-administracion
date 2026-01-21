/**
 * ADVA Menu Library
 * Shared library for Control spreadsheets.
 * Menu callbacks use ADVALib prefix so they resolve to this library.
 */

/**
 * Creates the ADVA menu.
 * Called from bound script's onOpen() trigger.
 */
function createMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ADVA')
    .addItem('🔄 Trigger Scan', 'ADVALib.triggerScan')
    .addItem('🔗 Trigger Re-match', 'ADVALib.triggerRematch')
    .addItem('🏦 Auto-fill Bank Data', 'ADVALib.triggerAutofillBank')
    .addSeparator()
    .addItem('⚙️ Configure API URL', 'ADVALib.showConfigDialog')
    .addItem('ℹ️ About', 'ADVALib.showAbout')
    .addToUi();
}

/**
 * Triggers a manual scan of the Entrada folder
 */
function triggerScan() {
  const url = getApiUrl() + '/api/scan';
  makeApiCall(url, 'POST', null, 'Scan triggered successfully!');
}

/**
 * Triggers re-matching of unmatched documents
 */
function triggerRematch() {
  const url = getApiUrl() + '/api/rematch';
  makeApiCall(url, 'POST', null, 'Re-match triggered successfully!');
}

/**
 * Triggers automatic bank data filling
 */
function triggerAutofillBank() {
  const url = getApiUrl() + '/api/autofill-bank';
  makeApiCall(url, 'POST', null, 'Bank auto-fill triggered successfully!');
}

/**
 * Gets the API URL from Script Properties
 * @returns {string} The API URL
 */
function getApiUrl() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL');

  if (!apiUrl) {
    SpreadsheetApp.getUi().alert(
      '⚠️ Configuration Required',
      'Please configure the API URL using:\nADVA → Configure API URL',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    throw new Error('API_URL not configured');
  }

  return apiUrl;
}

/**
 * Makes an API call to the ADVA server
 * @param {string} url - The full URL to call
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object|null} payload - Request payload (for POST/PUT)
 * @param {string} successMessage - Message to show on success
 */
function makeApiCall(url, method, payload, successMessage) {
  const ui = SpreadsheetApp.getUi();

  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ADVA-Spreadsheet/2.0'
      },
      muteHttpExceptions: true
    };

    if (payload) {
      options.payload = JSON.stringify(payload);
    }

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      let message = successMessage;
      try {
        const data = JSON.parse(responseText);
        if (data.message) {
          message = successMessage + '\n\n' + data.message;
        }
      } catch (e) {
        // Response is not JSON, use default message
      }
      ui.alert('✅ Success', message, ui.ButtonSet.OK);
    } else {
      let errorMsg = 'Server returned status ' + statusCode;
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error) {
          errorMsg += '\n\n' + errorData.error;
        }
      } catch (e) {
        // Response is not JSON
      }
      ui.alert('⚠️ Error', errorMsg, ui.ButtonSet.OK);
    }
  } catch (err) {
    ui.alert('❌ Error', 'Failed to call API:\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * Shows the configuration dialog for setting API URL
 */
function showConfigDialog() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const currentUrl = props.getProperty('API_URL') || 'Not configured';

  const result = ui.prompt(
    'Configure API URL',
    'Current URL: ' + currentUrl + '\n\nEnter the ADVA API URL (e.g., https://your-app.railway.app):',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() === ui.Button.OK) {
    const newUrl = result.getResponseText().trim();
    if (newUrl) {
      // Remove trailing slash if present
      const cleanUrl = newUrl.replace(/\/$/, '');
      props.setProperty('API_URL', cleanUrl);
      ui.alert('✅ Configuration Saved', 'API URL updated to:\n' + cleanUrl, ui.ButtonSet.OK);
    } else {
      ui.alert('⚠️ Invalid Input', 'Please enter a valid URL', ui.ButtonSet.OK);
    }
  }
}

/**
 * Shows information about the ADVA menu
 */
function showAbout() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL') || 'Not configured';

  const message =
    'ADVA Administration Menu v2.0\n\n' +
    'This menu allows you to trigger server operations:\n\n' +
    '• Trigger Scan: Processes new documents in Entrada folder\n' +
    '• Trigger Re-match: Re-matches unmatched documents\n' +
    '• Auto-fill Bank: Fills bank data automatically\n\n' +
    'Current API URL: ' + apiUrl + '\n\n' +
    'To change the API URL, use:\nADVA → Configure API URL';

  ui.alert('About ADVA Menu', message, ui.ButtonSet.OK);
}
