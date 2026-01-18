# ADVA Administración Server

Node.js server for automated invoice and payment processing for ADVA using Google APIs and Gemini AI.

## Features

- REST API for document scanning and processing
- AI-powered data extraction using Gemini 2.5 Flash
- Google Drive integration with push notifications
- Google Sheets for structured data storage
- Automatic invoice-payment matching
- Built-in validation for Argentine CUIT and CAE
- Comprehensive test suite (525+ tests)

## Supported Documents

- **Facturas**: Argentine ARCA invoices (A, B, C, E, NC, ND)
- **Pagos**: Bank payment slips (BBVA and others)
- **Recibos**: Employee salary receipts (sueldo, liquidación final)

## Prerequisites

1. **Node.js** v20+
2. **Google Cloud Service Account** with Drive and Sheets API access
3. **Gemini API Key** from https://aistudio.google.com/apikey

---

## Local Development Setup

### 1. Install Dependencies

```bash
git clone <repository-url>
cd adva-administracion
npm install
```

### 2. Create Environment File

Create a `.env` file in the project root (this file is gitignored):

```env
# ===================
# Server Configuration
# ===================
PORT=3000
NODE_ENV=development
LOG_LEVEL=DEBUG

# ===================
# Google Authentication (Required for full functionality)
# ===================
# Option 1: Base64-encoded service account JSON
GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-json>

# To encode your service account file:
#   cat service-account.json | base64

# Option 2: For local dev, you can leave this empty and the server
# will start but Google API calls will fail

# ===================
# Gemini AI (Required for document processing)
# ===================
# Get your key from: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# ===================
# Google Drive Configuration
# ===================
# The folder ID to watch for new documents
# Get this from the folder URL: https://drive.google.com/drive/folders/<FOLDER_ID>
DRIVE_WATCH_FOLDER_ID=your_folder_id_here

# ===================
# Google Sheets Configuration (Optional)
# ===================
# Spreadsheet IDs for storing processed documents
# Get from URL: https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
COBROS_SPREADSHEET_ID=
GASTOS_SPREADSHEET_ID=
BANK_SPREADSHEET_IDS=

# ===================
# Matching Configuration (Optional - defaults shown)
# ===================
MATCH_DAYS_BEFORE=10
MATCH_DAYS_AFTER=60
USD_ARS_TOLERANCE_PERCENT=5
```

### 3. Run in Development Mode

```bash
# With hot reload (recommended for development)
npm run dev

# Or build and run
npm run build
npm start
```

### 4. Test the Server

```bash
# Health check
curl http://localhost:3000/health
# Response: {"status":"ok"}

# Status endpoint
curl http://localhost:3000/api/status
# Response: {"status":"ok","timestamp":"...","version":"2.0.0","environment":"development",...}

# Trigger a scan (currently returns stub response)
curl -X POST http://localhost:3000/api/scan
```

### 5. Run Tests

```bash
npm test               # Run all 525 tests
npm run test:watch     # TDD mode with watch
npm run test:coverage  # Generate coverage report
npm run lint           # TypeScript type checking
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Prod | - | Base64-encoded service account JSON |
| `GEMINI_API_KEY` | Prod | - | Gemini API key |
| `DRIVE_WATCH_FOLDER_ID` | Prod | - | Google Drive folder ID to watch |
| `COBROS_SPREADSHEET_ID` | No | - | Spreadsheet for incoming invoices |
| `GASTOS_SPREADSHEET_ID` | No | - | Spreadsheet for outgoing payments |
| `BANK_SPREADSHEET_IDS` | No | - | Comma-separated bank spreadsheet IDs |
| `MATCH_DAYS_BEFORE` | No | `10` | Days before invoice date to match payments |
| `MATCH_DAYS_AFTER` | No | `60` | Days after invoice date to match payments |
| `USD_ARS_TOLERANCE_PERCENT` | No | `5` | Tolerance % for USD/ARS exchange matching |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Simple health check for load balancers |
| GET | `/api/status` | Detailed status with queue info and version |
| POST | `/api/scan` | Trigger manual document scan |
| POST | `/api/rematch` | Re-run matching on unmatched documents |
| POST | `/api/autofill-bank` | Auto-fill bank movement descriptions |
| POST | `/webhooks/drive` | Receive Google Drive push notifications |

---

## Production Deployment (Railway.app)

### Railway Pricing

> **Note:** Railway does NOT have a permanent free tier. The free trial is 30 days only.

| Plan | Cost | Included Credits | Best For |
|------|------|------------------|----------|
| **Free Trial** | $0 | $5 (expires in 30 days) | Testing deployment |
| **Hobby** | $5/month | $5/month | Personal projects, this app |
| **Pro** | $20/month | $20/month | Teams, higher traffic |

**For this app:** The Hobby plan ($5/month) is sufficient. Expected usage is $2-5/month, which is covered by the included credits.

### Deployment Steps

#### Option A: Deploy via Railway Dashboard (Recommended)

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app) and sign up
   - Connect your GitHub account

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `adva-administracion` repository

3. **Configure Environment Variables**

   In the Railway dashboard, go to your service → Variables → Add the following:

   ```
   NODE_ENV=production
   LOG_LEVEL=INFO
   GEMINI_API_KEY=your_gemini_api_key
   GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded-service-account-json>
   DRIVE_WATCH_FOLDER_ID=your_folder_id
   ```

   To encode your service account for Railway:
   ```bash
   cat service-account.json | base64 | tr -d '\n'
   ```

4. **Deploy**
   - Railway auto-deploys on git push
   - Check the deployment logs for any errors
   - Your app will be available at `https://<project-name>.up.railway.app`

#### Option B: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project (run in your repo directory)
railway init

# Link to existing project (if already created in dashboard)
railway link

# Set environment variables
railway variables set NODE_ENV=production
railway variables set LOG_LEVEL=INFO
railway variables set GEMINI_API_KEY=your_key_here
railway variables set DRIVE_WATCH_FOLDER_ID=your_folder_id

# For the service account, encode and set:
railway variables set GOOGLE_SERVICE_ACCOUNT_KEY=$(cat service-account.json | base64 | tr -d '\n')

# Deploy
railway up

# View logs
railway logs

# Open deployed app
railway open
```

### Verify Deployment

```bash
# Replace with your Railway URL
curl https://your-app.up.railway.app/health
# Response: {"status":"ok"}

curl https://your-app.up.railway.app/api/status
# Response: {"status":"ok","version":"2.0.0","environment":"production",...}
```

### Custom Domain (Optional)

1. In Railway dashboard, go to Settings → Domains
2. Add your custom domain
3. Configure DNS with the provided CNAME record

---

## Project Structure

```
src/
├── server.ts         # Fastify entry point
├── config.ts         # Environment configuration
├── routes/           # HTTP route handlers
│   ├── status.ts     # GET /health, /api/status
│   ├── scan.ts       # POST /api/scan, /rematch, /autofill-bank
│   └── webhooks.ts   # POST /webhooks/drive
├── services/         # Google API wrappers
│   ├── google-auth.ts
│   ├── drive.ts
│   └── sheets.ts
├── processing/       # Queue management
├── types/            # TypeScript definitions
├── gemini/           # Gemini API client
├── matching/         # Invoice-payment matching
├── bank/             # Bank movement matching
└── utils/            # Validation, dates, etc.
tests/
└── unit/             # Unit tests (525+)
```

---

## Google Cloud Setup

### 1. Create Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable APIs:
   - Google Drive API
   - Google Sheets API
4. Create Service Account:
   - IAM & Admin → Service Accounts → Create
   - Download JSON key file
5. Share your Drive folder and Spreadsheets with the service account email

### 2. Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new API key
3. Copy the key to your environment variables

---

## Cost Estimate

| Service | Monthly Cost |
|---------|-------------|
| Railway.app (Hobby) | $5 (includes $5 credits) |
| Gemini API (free tier) | $0 |
| Google Cloud APIs | $0 (within free quotas) |
| **Total** | **~$5/month** |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server won't start | Check `NODE_ENV` and required env vars |
| Google API errors | Verify service account key is base64-encoded correctly |
| "Permission denied" on Drive | Share folder with service account email |
| Railway deploy fails | Check build logs, ensure `npm run build` works locally |

---

## License

MIT License - Internal ADVA use

---

**ADVA - Asociación de Desarrolladores de Videojuegos Argentina**
