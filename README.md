# ADVA Administración Server

Automated invoice and payment processing server for ADVA (Asociación de Desarrolladores de Videojuegos Argentina).

This server processes Argentine invoices and payment documents using AI, automatically extracts data to Google Sheets, matches payments to invoices, and organizes documents in Google Drive.

**For development:** See [DEVELOPMENT.md](DEVELOPMENT.md)

---

## What It Does

- Scans PDF documents in Google Drive's "Entrada" folder
- Extracts structured data using Gemini AI
- Writes data to Google Sheets (Control de Cobros, Control de Pagos, Bancos)
- Matches payments to invoices automatically
- Auto-fills bank movement descriptions
- Sorts processed documents into month folders
- Provides REST API for manual triggers and monitoring

### Supported Documents

- **Facturas**: Argentine ARCA invoices (A, B, C, E, NC, ND)
- **Pagos**: Bank payment slips (BBVA and others)
- **Recibos**: Employee salary receipts (sueldo, liquidación final)

---

## Prerequisites

1. **Railway Account** - https://railway.app (Hobby plan $5/month recommended)
2. **Google Cloud Service Account** - With Drive and Sheets API access
3. **Gemini API Key** - From https://aistudio.google.com/apikey
4. **Google Drive Folder Structure** - See [folder structure](#google-drive-folder-structure) below

---

## Deployment to Production

### 1. Create Railway Project

1. Go to https://railway.app
2. Sign up or log in
3. Click "New Project"
4. Select "Empty Project"
5. Name it `adva-administracion`

### 2. Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli@latest

# Login to Railway
railway login

# Link to your Railway project
railway link

# Set environment variables (see next section)
railway variables set NODE_ENV=production
railway variables set LOG_LEVEL=INFO
railway variables set GEMINI_API_KEY=your_key_here
railway variables set DRIVE_ROOT_FOLDER_ID=your_folder_id
railway variables set GOOGLE_SERVICE_ACCOUNT_KEY=$(cat service-account.json | base64 | tr -d '\n')

# Deploy
railway up

# Get deployment URL
railway domain
```

### 3. Verify Deployment

```bash
# Replace with your Railway URL
curl https://your-app.up.railway.app/health
# Response: {"status":"ok"}

curl https://your-app.up.railway.app/api/status
# Response: {"status":"ok","version":"2.0.0","environment":"production",...}
```

### 4. Configure Custom Domain (Optional)

1. In Railway dashboard: Settings → Domains
2. Add your custom domain
3. Configure DNS with provided CNAME record

---

## Environment Variables

Set these in Railway dashboard (Variables tab) or via CLI:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | - | Set to `production` |
| `LOG_LEVEL` | No | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `PORT` | No | `3000` | Server port (Railway sets automatically) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes | - | Base64-encoded service account JSON |
| `GEMINI_API_KEY` | Yes | - | Gemini API key |
| `DRIVE_ROOT_FOLDER_ID` | Yes | - | Google Drive root folder ID |
| `MATCH_DAYS_BEFORE` | No | `10` | Days before invoice date to match payments |
| `MATCH_DAYS_AFTER` | No | `60` | Days after invoice date to match payments |
| `USD_ARS_TOLERANCE_PERCENT` | No | `5` | Tolerance % for USD/ARS exchange matching |

### Encoding Service Account Key

```bash
# macOS/Linux
cat service-account.json | base64 | tr -d '\n'

# Windows PowerShell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content service-account.json -Raw)))
```

---

## Google Cloud Setup

### 1. Create Service Account

1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Enable APIs:
   - **Google Drive API**
   - **Google Sheets API**
4. Create Service Account:
   - Navigate to: IAM & Admin → Service Accounts → Create
   - Name: `adva-administracion`
   - Role: None needed (access via Drive sharing)
5. Create and download JSON key:
   - Click on the service account → Keys → Add Key → JSON
   - Download and save securely

### 2. Share Drive Folder

1. Open your ADVA root folder in Google Drive
2. Click "Share"
3. Add the service account email (from `client_email` in JSON key)
   - Format: `your-service@project-id.iam.gserviceaccount.com`
4. Grant **Editor** access (required for file operations)

### 3. Get Gemini API Key

1. Go to https://aistudio.google.com/apikey
2. Create API key
3. Copy to `GEMINI_API_KEY` environment variable

---

## Google Drive Folder Structure

The server expects this structure in `DRIVE_ROOT_FOLDER_ID`:

```
ADVA Root Folder/
├── Control de Cobros.gsheet       # Collections tracking spreadsheet
├── Control de Pagos.gsheet        # Payments tracking spreadsheet
├── Entrada/                        # Incoming documents (scan source)
├── Bancos/                         # Bank movement spreadsheets
│   ├── Banco BBVA.gsheet
│   └── ... (other banks)
├── Cobros/                         # Sorted matched collections
│   ├── 01 - Enero/
│   ├── 02 - Febrero/
│   └── ... (12 months)
├── Pagos/                          # Sorted matched payments
│   ├── 01 - Enero/
│   └── ... (12 months)
└── Sin Procesar/                   # Failed or unmatched documents
```

**Notes:**
- All folders and spreadsheets are created automatically if missing
- Month subfolders are created on demand
- Bank spreadsheets in `Bancos/` are auto-discovered

---

## API Endpoints

| Method | Endpoint | Description | Use Case |
|--------|----------|-------------|----------|
| GET | `/health` | Simple health check | Load balancer probes |
| GET | `/api/status` | Detailed status + queue info | Monitoring, debugging |
| POST | `/api/scan` | Trigger manual document scan | Force scan outside schedule |
| POST | `/api/rematch` | Re-run matching on unmatched docs | After correcting data |
| POST | `/api/autofill-bank` | Auto-fill bank descriptions | Monthly maintenance |
| POST | `/webhooks/drive` | Drive push notifications | Automated by Google |

### Example API Calls

```bash
# Health check
curl https://your-app.up.railway.app/health

# Full status
curl https://your-app.up.railway.app/api/status

# Trigger scan
curl -X POST https://your-app.up.railway.app/api/scan

# Rematch unmatched documents
curl -X POST https://your-app.up.railway.app/api/rematch

# Auto-fill bank movements
curl -X POST https://your-app.up.railway.app/api/autofill-bank
```

---

## Monitoring and Health Checks

### Railway Health Checks

Railway automatically monitors the `/health` endpoint. If it returns non-200 status, Railway will restart the service.

### Status Endpoint

The `/api/status` endpoint provides:
- Server status
- Version
- Environment
- Queue status (active/pending tasks)
- Timestamp

### Logs

View logs via Railway CLI:
```bash
railway logs
```

Or in Railway dashboard: Deployments → [Select deployment] → Logs

### Key Metrics to Monitor

- `/health` response time and status
- Queue depth in `/api/status`
- Error rates in logs
- Google API quota usage

---

## Maintenance Tasks

### Monthly Tasks

1. **Review unmatched documents**
   - Check `Sin Procesar/` folder in Drive
   - Manually match or correct data
   - Run rematch: `curl -X POST .../api/rematch`

2. **Auto-fill bank movements**
   - Run: `curl -X POST .../api/autofill-bank`
   - Fills descriptions for matched movements

### Quarterly Tasks

1. **Review Google API quotas**
   - Check usage in Google Cloud Console
   - Drive API: 20,000 requests/100 seconds (default)
   - Sheets API: 500 requests/100 seconds (default)

2. **Review Gemini API usage**
   - Check usage in Google AI Studio
   - Monitor costs

### Environment Updates

When environment variables change:
```bash
railway variables set VARIABLE_NAME=new_value
railway up  # Redeploy
```

### Redeployment

To redeploy current version:
```bash
railway up
```

To deploy specific commit:
```bash
git checkout <commit-hash>
railway up
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server won't start | Check Railway logs for errors. Verify all required env vars are set. |
| "Permission denied" on Drive | Verify service account email has Editor access to root folder. |
| Google API quota exceeded | Wait for quota reset or request increase in Cloud Console. |
| Documents not being processed | Check `/api/status` for queue status. Check logs for errors. |
| Gemini API errors | Verify API key is valid. Check quota in AI Studio. |
| Railway deploy fails | Check build logs. Ensure `npm run build` works locally. |
| Wrong data extracted | Review Gemini prompts in `src/gemini/prompts.ts`. May need tuning. |

### Getting Help

1. Check Railway logs: `railway logs`
2. Check `/api/status` endpoint for queue status
3. Review error messages in logs
4. Verify Google Cloud permissions
5. Check Gemini API quotas

---

## Updating the Software

### For Developers

See [DEVELOPMENT.md](DEVELOPMENT.md) for local development setup and contribution guidelines.

### For Operators

When updates are pushed to the repository:

```bash
# Pull latest changes
git pull origin main

# Redeploy to Railway
railway up
```

Railway can also be configured for automatic deployments on git push via GitHub integration.

---

## Security Notes

- **Never commit** `service-account.json` or `.env` files
- Service account key should only exist in Railway environment variables
- Rotate API keys periodically
- Limit service account permissions to only required Drive folders
- Use custom domain with HTTPS for production

---

## License

MIT License - Copyright (c) 2024-2026 ADVA - Asociación de Desarrolladores de Videojuegos Argentina

---

**ADVA - Asociación de Desarrolladores de Videojuegos Argentina**
