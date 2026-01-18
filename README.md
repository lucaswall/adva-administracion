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

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables (see below)
export GEMINI_API_KEY=your_key
export GOOGLE_SERVICE_ACCOUNT_KEY=$(cat service-account.json | base64)
export DRIVE_WATCH_FOLDER_ID=your_folder_id

# Build and run
npm run build
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment: development, production, test |
| `LOG_LEVEL` | No | Log level: DEBUG, INFO, WARN, ERROR |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes | Base64-encoded service account JSON |
| `GEMINI_API_KEY` | Yes | Gemini API key |
| `DRIVE_WATCH_FOLDER_ID` | Yes | Google Drive folder to watch |
| `COBROS_SPREADSHEET_ID` | No | Spreadsheet for incoming invoices |
| `GASTOS_SPREADSHEET_ID` | No | Spreadsheet for outgoing payments |
| `BANK_SPREADSHEET_IDS` | No | Comma-separated bank spreadsheet IDs |
| `MATCH_DAYS_BEFORE` | No | Days before invoice to match (default: 10) |
| `MATCH_DAYS_AFTER` | No | Days after invoice to match (default: 60) |
| `USD_ARS_TOLERANCE_PERCENT` | No | USD/ARS match tolerance (default: 5) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Simple health check |
| GET | `/api/status` | Status with queue info |
| POST | `/api/scan` | Trigger manual scan |
| POST | `/api/rematch` | Re-run matching |
| POST | `/api/autofill-bank` | Auto-fill bank descriptions |
| POST | `/webhooks/drive` | Drive push notifications |

## Development

```bash
npm run dev            # Dev mode with watch
npm test               # Run tests
npm run test:watch     # TDD mode
npm run test:coverage  # Coverage report
npm run lint           # Type check
```

### Project Structure

```
src/
├── server.ts         # Fastify entry point
├── config.ts         # Environment config
├── routes/           # HTTP route handlers
├── services/         # Google API wrappers
├── processing/       # Queue management
├── types/            # TypeScript definitions
├── gemini/           # Gemini API client
├── matching/         # Invoice-payment matching
├── bank/             # Bank movement matching
└── utils/            # Validation, dates, etc.
tests/
└── unit/             # Unit tests (525+)
```

## Deployment

### Railway.app

1. Create a new Railway project
2. Connect your GitHub repository
3. Set environment variables in Railway dashboard
4. Deploy

### Docker (optional)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

## Cost Estimate

| Service | Monthly Cost |
|---------|-------------|
| Railway.app | ~$5-8 |
| Gemini API (free tier) | $0 |
| **Total** | **~$5-8/month** |

## License

MIT License - Internal ADVA use

---

**ADVA - Asociación de Desarrolladores de Videojuegos Argentina**
