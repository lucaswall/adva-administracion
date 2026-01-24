# ADVA Administración Server

Automated invoice and payment processing server for ADVA (Asociación de Desarrolladores de Videojuegos Argentina).

This server processes Argentine invoices and payment documents using AI, automatically extracts data to Google Sheets, matches payments to invoices, and organizes documents in Google Drive.

**For development:** See [DEVELOPMENT.md](DEVELOPMENT.md)

---

## What It Does

- Scans PDF documents in Google Drive's "Entrada" folder
- **Real-time monitoring** with Drive push notifications (automatic processing when files are added)
- Extracts structured data using Gemini AI with **direction-aware classification**
- Writes data to Google Sheets (Control de Ingresos, Control de Egresos)
- Matches payments to invoices automatically
- Auto-fills bank movement descriptions
- Sorts processed documents into month folders (Ingresos/, Egresos/, Bancos/)
- Provides REST API for manual triggers and monitoring

### Supported Documents (Direction-Aware)

- **Facturas Emitidas**: Invoices FROM ADVA (ADVA is emisor) → Ingresos
- **Facturas Recibidas**: Invoices TO ADVA (ADVA is receptor) → Egresos
- **Pagos Enviados**: Payments BY ADVA (ADVA is ordenante) → Egresos
- **Pagos Recibidos**: Payments TO ADVA (ADVA is beneficiario) → Ingresos
- **Certificados de Retención**: Tax withholding certificates (ADVA is sujeto retenido) → Ingresos
- **Resumenes Bancarios**: Bank account statements → Bancos
- **Resumenes de Tarjeta**: Credit card statements → Bancos
- **Resumenes de Broker**: Investment/broker statements → Bancos
- **Recibos**: Employee salary receipts → Egresos

---

## Prerequisites

1. **Railway Account** - https://railway.app (Hobby plan $5/month recommended)
2. **Google Cloud Service Account** - With Drive and Sheets API access
3. **Gemini API Key** - From https://aistudio.google.com/apikey
4. **Google Drive Folder Structure** - See [folder structure](#google-drive-folder-structure) below

---

## Deployment to Production

There are two deployment methods:

1. **GitHub Integration (Recommended)** - Auto-deploys on every push to `main`. Requires dashboard setup.
2. **CLI-only Deployment** - Deploy manually via `railway up`. No GitHub integration.

> **Understanding Railway's Dashboard:**
>
> Railway has two levels of settings - this is a common source of confusion:
> - **Project** - Contains one or more services. Has its own settings (environments, members, tokens).
> - **Service** - Your actual app. Has deployment source, domains, and variables.
>
> To access **Service Settings**: Click on the service box on the canvas (not the sidebar).
> To access **Project Settings**: Click "Settings" in the sidebar or project dropdown.
>
> Most deployment configuration (GitHub repo, domains, env vars) is in **Service Settings**.

---

### Option A: GitHub Integration (Recommended)

This method auto-deploys when you push to the `main` branch. GitHub integration **must be configured via the Railway dashboard** (CLI cannot set up GitHub OAuth).

#### 1. Create Project from GitHub Repository

1. **Go to Railway Dashboard**
   - Visit https://railway.app/new
   - Sign up or log in
   - Click "New Project"

2. **Select "Deploy from GitHub repo"**
   - If prompted, authorize Railway to access your GitHub account
   - Search for `adva-administracion` repository
   - Select the repository

3. **Choose "Add variables"** (don't deploy yet)
   - This allows you to configure environment variables before first deployment

#### 2. Configure Environment Variables

In the Railway dashboard, add these variables (see [Environment Variables](#environment-variables) section for details):

```
NODE_ENV=production
LOG_LEVEL=INFO
GEMINI_API_KEY=your_key_here
DRIVE_ROOT_FOLDER_ID=your_folder_id
API_SECRET=your_secret_token_here
API_BASE_URL=https://your-app.up.railway.app
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-service-account-json>
```

**Note:** Set `API_BASE_URL` after generating your Railway domain in step 6. Use your actual Railway URL with protocol (e.g., `https://your-app.up.railway.app`). The webhook URL is automatically derived by appending `/webhooks/drive`.

To encode your service account key:
```bash
cat service-account.json | base64 | tr -d '\n'
```

Copy the output and paste it as the value for `GOOGLE_SERVICE_ACCOUNT_KEY`.

#### 3. Deploy

After setting all environment variables, click **"Deploy"** in the Railway dashboard. Railway will:
- Build the application
- Run it automatically
- Generate a deployment URL

#### 4. Configure Auto-Deployment Settings

In Railway dashboard:
1. Click on the **service** (the box on the canvas representing your app)
   - **Important:** This is different from "Project Settings" in the sidebar
2. Go to the **Settings** tab for that service
3. Under **Source**, verify:
   - **Branch**: `main` (or your preferred branch)
   - **Auto-deploy**: Enabled (default)

Now, every push to `main` will automatically trigger a new deployment.

#### 5. Optional: Link CLI for Management

To manage your GitHub-linked project via CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli@latest

# Login to Railway
railway login

# Link to your existing GitHub-connected project
railway link

# Now you can use CLI commands:
railway logs                      # View logs
railway status                    # Show project status
railway open                      # Open dashboard in browser
railway variables --set KEY=VALUE # Update environment variables
```

**Important:** With GitHub integration, deployments happen automatically via git push. Use CLI only for management (logs, variables, etc.), not `railway up`.

#### 6. Generate Public Domain

Railway deployments need a public domain to be accessible:

1. In Railway dashboard, click on the **service** (the box on the canvas)
2. Go to the **Settings** tab for that service
3. Scroll to **Networking** section
4. Under **Public Networking**, click **Generate Domain**
5. Railway will create a URL like `https://your-app.up.railway.app`

#### 7. Verify Deployment

```bash
# Replace with your Railway URL from step 6
curl https://your-app.up.railway.app/health
# Response: {"status":"ok"}

curl https://your-app.up.railway.app/api/status
# Response: {"status":"ok","version":"1.0.0","environment":"production",...}
```

#### 8. Configure Custom Domain (Optional)

For a custom domain (e.g., `api.adva.org`):

1. Click on the **service** in the Railway dashboard
2. Go to **Settings** → **Networking**
3. Click **Custom Domain**
4. Enter your domain name
5. Configure DNS with the provided CNAME record

---

### Option B: CLI-only Deployment

Use this method if you prefer deploying via CLI without GitHub integration. You'll need to run `railway up` manually for each deployment.

#### 1. Install and Login

```bash
# Install Railway CLI
npm install -g @railway/cli@latest

# Login (opens browser for authentication)
railway login
```

#### 2. Create Project and Service

```bash
# Create a new Railway project
railway init

# Follow prompts to name your project and select team
```

#### 3. Configure Environment Variables

```bash
# Set required environment variables
railway variables --set NODE_ENV=production
railway variables --set LOG_LEVEL=INFO
railway variables --set GEMINI_API_KEY=your_key_here
railway variables --set DRIVE_ROOT_FOLDER_ID=your_folder_id
railway variables --set API_SECRET=your_secret_token_here
railway variables --set GOOGLE_SERVICE_ACCOUNT_KEY=$(cat service-account.json | base64 | tr -d '\n')

# Set after generating domain in step 5 (enables webhooks and Apps Script)
railway variables --set API_BASE_URL=https://your-app.up.railway.app
```

#### 4. Deploy

```bash
# Deploy current directory
railway up

# Or deploy in detached mode (returns immediately)
railway up --detach
```

#### 5. Generate Domain and Verify

```bash
# Open dashboard to configure domain
railway open

# Or add domain via CLI
railway domain

# View deployment logs
railway logs
```

**Note:** With CLI-only deployment, you must run `railway up` each time you want to deploy changes. There's no automatic deployment on git push.

**Upgrade to GitHub Integration:** You can add GitHub auto-deploy to an existing CLI project later:

1. Open your project in the Railway dashboard
2. Click on the **service** (the box on the canvas representing your app)
   - **Important:** Click the service itself, not "Project Settings" in the sidebar
3. Go to the **Settings** tab for that service
4. Under **Source**, click **"Connect Repo"**
5. Select your GitHub repository and branch

> **Note:** Railway has two settings levels:
> - **Project Settings** (sidebar) - environments, members, tokens, integrations
> - **Service Settings** (click on service box) - deployment source, domains, variables
>
> GitHub repo connection is in **Service Settings**, not Project Settings.

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
| `API_SECRET` | Yes | - | Secret token for API authentication. Used by server to validate requests and injected into Apps Script at build time. Keep secure and rotate periodically. |
| `API_BASE_URL` | No | - | Full URL with protocol (e.g., `https://adva-admin.railway.app`). Enables webhooks (appends `/webhooks/drive`) and Apps Script (domain extracted at build time). |
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
├── Control de Ingresos.gsheet     # Money IN tracking (at root)
├── Control de Egresos.gsheet      # Money OUT tracking (at root)
├── Entrada/                        # Incoming documents (scan source, at root)
├── Sin Procesar/                   # Failed/unmatched documents (at root)
├── 2024/                           # Year folders (created on-demand)
│   ├── Ingresos/                   # Money IN documents for 2024
│   │   ├── 01 - Enero/
│   │   ├── 02 - Febrero/
│   │   └── ... (12 months, auto-created as needed)
│   ├── Egresos/                    # Money OUT documents for 2024
│   │   ├── 01 - Enero/
│   │   └── ... (12 months, auto-created as needed)
│   └── Bancos/                     # Bank/financial statements (no month subfolders)
│       ├── BBVA 1234567890 ARS/    # Bank account folder (resumen_bancario)
│       ├── BBVA Visa 4563/         # Credit card folder (resumen_tarjeta)
│       └── BALANZ 123456/          # Broker folder (resumen_broker)
├── 2025/                           # Next year (created when first document arrives)
│   ├── Ingresos/
│   ├── Egresos/
│   └── Bancos/
└── ... (more years as needed)
```

**Notes:**
- Year folders are created dynamically when the first document for that year is processed
- Classification folders (Ingresos, Egresos, Bancos) are auto-created inside each year folder
- Month subfolders are created inside Ingresos and Egresos as documents arrive
- Bancos has no month subfolders - statements go into account-specific subfolders
- Entrada and Sin Procesar remain at the root level for easy access
- Direction-aware classification routes documents based on ADVA's role (emisor/receptor/ordenante/beneficiario)

### Bancos Folder Organization

The Bancos folder contains three types of financial statements, each with its own folder naming convention:

| Document Type | Folder Format | Example |
|---------------|---------------|---------|
| **resumen_bancario** (Bank statements) | `{Bank} {Account Number} {Currency}` | `BBVA 1234567890 ARS` |
| **resumen_tarjeta** (Credit cards) | `{Bank} {Card Type} {Last Digits}` | `BBVA Visa 4563` |
| **resumen_broker** (Investment) | `{Broker} {Comitente Number}` | `BALANZ CAPITAL VALORES SAU 123456` |

**Credit card types:** Visa, Mastercard, Amex, Naranja, Cabal

---

## Apps Script Menu Setup

The **Dashboard Operativo Contable** spreadsheet includes a custom **ADVA** menu that provides quick access to server operations. This menu is delivered via a bound Apps Script attached directly to the Dashboard.

### Architecture

- **Bound script** (`apps-script/` folder): TypeScript-based script attached to Dashboard Operativo Contable
- **Build process**: Injects `API_BASE_URL` and `API_SECRET` from environment → compiles TypeScript → outputs to `dist/`
- **Deployment**: One-time manual deployment to Dashboard spreadsheet after server creates it
- **Control spreadsheets**: Created fresh by server (no script, no template)

### One-Time Setup

#### 1. Configure API Settings

Add your Railway domain and API secret to `.env` (full URL with protocol):

```bash
API_BASE_URL=https://your-app.up.railway.app
API_SECRET=your_secret_token_here
```

**Important:** The build process requires both variables and will fail if not set. The domain will be automatically extracted for Apps Script.

#### 2. Create Dashboard Script Project

The server will create the Dashboard Operativo Contable spreadsheet automatically. After it's created:

**Option A - Using clasp:**
```bash
cd apps-script
clasp create --title "ADVA Dashboard Menu" --parentId YOUR_DASHBOARD_SPREADSHEET_ID
# This creates .clasp.json with the new Script ID
```

**Option B - Manually:**
1. Open Dashboard Operativo Contable spreadsheet
2. Go to **Extensions → Apps Script**
3. Copy Script ID from the project settings
4. Create `.clasp.json` in `apps-script/` folder:
   ```json
   {
     "scriptId": "YOUR_SCRIPT_ID_HERE",
     "rootDir": "./dist"
   }
   ```

Note: `rootDir` must be `./dist` as that's where compiled code is output.

#### 3. Build and Deploy Script

```bash
# Build TypeScript and inject API_BASE_URL and API_SECRET
npm run build:script

# Deploy to Dashboard spreadsheet
npm run deploy:script
```

The deploy command builds and pushes in one step. This uploads the compiled JavaScript from `apps-script/dist/` to the Dashboard's bound script.

**Note:** Deploy once after Dashboard is created. No need to redeploy unless menu changes.

### Menu Functions

When you open the Dashboard Operativo Contable spreadsheet, the **ADVA** menu appears in the menu bar:

| Menu Item | API Endpoint | Description |
|-----------|--------------|-------------|
| 🔄 Trigger Scan | POST /api/scan | Manually trigger document scan |
| 🔗 Trigger Re-match | POST /api/rematch | Re-run matching on unmatched docs |
| 🏦 Auto-fill Bank Data | POST /api/autofill-bank | Auto-fill bank movement descriptions |
| ℹ️ About | GET /api/status | Show server info, test connectivity, display uptime and queue status |

**Note:** API URL and secret are configured at build time via environment variables. No per-spreadsheet configuration needed.

### Updating Menu Logic

After modifying script code in `apps-script/src/main.ts`:

```bash
npm run deploy:script
```

This rebuilds (with current `API_BASE_URL` and `API_SECRET` from `.env`) and deploys to the Dashboard.

### Secret Rotation

After changing `API_SECRET`:

1. Update `API_SECRET` in `.env`
2. Rebuild and redeploy: `npm run deploy:script`
3. Restart server (picks up new secret from env)

Only Dashboard has the menu, so only needs one-time redeployment.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Menu doesn't appear | Refresh spreadsheet. Check Extensions → Apps Script for errors. Ensure script is deployed. |
| API calls fail | Check "About" menu to test connectivity. Verify `API_BASE_URL` and `API_SECRET` were set correctly when script was built. Rebuild and redeploy if either changed. Check server is running and accessible. |
| Build fails | Ensure both `API_BASE_URL` and `API_SECRET` are set in `.env` file. Use full URL with protocol (e.g., `https://example.com`). |

---

## API Endpoints

All endpoints except `/health` and `/webhooks/drive` require Bearer token authentication (`Authorization: Bearer <API_SECRET>`).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Simple health check (load balancer probes) |
| GET | `/api/status` | Yes | Detailed status + queue info |
| POST | `/api/scan` | Yes | Trigger manual document scan |
| POST | `/api/rematch` | Yes | Re-run matching on unmatched docs |
| POST | `/api/autofill-bank` | Yes | Auto-fill bank descriptions |
| POST | `/webhooks/drive` | No | Drive push notifications (validated via channel ID) |

### Example API Calls

**Note:** All endpoints except `/health` and `/webhooks/drive` require authentication via Bearer token.

```bash
# Health check (no auth required)
curl https://your-app.up.railway.app/health

# Full status (requires auth)
curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-app.up.railway.app/api/status

# Trigger scan (requires auth)
curl -X POST -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-app.up.railway.app/api/scan

# Rematch unmatched documents (requires auth)
curl -X POST -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-app.up.railway.app/api/rematch

# Auto-fill bank movements (requires auth)
curl -X POST -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-app.up.railway.app/api/autofill-bank
```

---

## Real-time Monitoring

The server supports real-time document processing through Google Drive Push Notifications. When enabled, documents are automatically processed as soon as they're added to the Entrada folder.

### How It Works

1. **Push Notifications**: Google Drive sends HTTP notifications to your server when files change
2. **Automatic Processing**: Server receives notification and queues a scan automatically
3. **Channel Renewal**: Watch channels are automatically renewed every 30 minutes to prevent expiration
4. **Fallback Polling**: Scans every 5 minutes as backup if notifications fail

### Setup

Real-time monitoring is **optional** and requires the `API_BASE_URL` environment variable:

```bash
# Set after deploying and generating your Railway domain
railway variables --set API_BASE_URL=https://your-app.up.railway.app
```

**How it works:**
- The webhook URL is automatically derived by appending `/webhooks/drive` to `API_BASE_URL`
- Must be a public HTTPS URL (Railway provides this automatically)
- Server will validate incoming notifications from Google

### Without Real-time Monitoring

If `API_BASE_URL` is not set:
- Real-time monitoring is disabled
- Fallback polling still runs every 5 minutes
- Manual scans via `/api/scan` still work
- Startup scan still processes pending documents

### Verification

After enabling, check logs for:
```
Real-time monitoring active for Entrada folder
Started watching folder [folder-id], expires at [timestamp]
```

When a file is added to Entrada, you'll see:
```
Drive notification received
Change detected, queueing scan
Triggering scan for folder [folder-id]...
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

**Via Railway Dashboard:**
1. Go to your service → Variables
2. Update or add the variable
3. Railway automatically redeploys

**Via Railway CLI:**
```bash
railway variables --set VARIABLE_NAME=new_value
# Railway automatically redeploys after variable changes
```

### Redeployment

**Automatic (Recommended):**
Push to the `main` branch and Railway auto-deploys:
```bash
git push origin main
```

**Manual Redeploy:**
In Railway dashboard:
- Use Command Palette (⌘K or Ctrl+K)
- Select "Deploy Latest Commit"

**Deploy Specific Commit:**
1. In Railway dashboard, go to Deployments
2. Find the desired deployment
3. Click "Redeploy"

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
| Auto-deploy not triggering | Verify Settings → Source shows correct branch and Auto-deploy is enabled. Check GitHub connection in Railway dashboard. |

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

**Automatic Deployment (Default):**

The project is configured for automatic deployment from GitHub. When developers push updates to the `main` branch, Railway automatically:
1. Detects the new commit
2. Builds the application
3. Deploys to production
4. Provides deployment status in the dashboard

You don't need to do anything - deployments happen automatically on push.

**Monitoring Deployments:**

1. **Via Railway Dashboard:**
   - Go to https://railway.app
   - Select your project
   - View Deployments tab for status and logs

2. **Via Railway CLI:**
   ```bash
   railway logs          # View live logs
   railway status        # Check deployment status
   ```

**Manual Deployment (if needed):**

If you need to manually trigger a deployment:
1. Open Railway dashboard
2. Press ⌘K (Mac) or Ctrl+K (Windows/Linux)
3. Select "Deploy Latest Commit"

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
