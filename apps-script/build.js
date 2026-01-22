#!/usr/bin/env node
/**
 * Build script for ADVA Apps Script
 *
 * This script:
 * 1. Reads API_BASE_URL and API_SECRET from .env file
 * 2. Injects them into config.template.ts → config.ts
 * 3. Bundles TypeScript with esbuild (IIFE format for Apps Script)
 * 4. Copies appsscript.json to dist/
 *
 * Usage: node build.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

/**
 * Log functions with color
 */
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.warn(`${colors.yellow}⚠${colors.reset} ${msg}`)
};

/**
 * Reads .env file and returns key-value pairs
 * @param {string} envPath - Path to .env file
 * @returns {Record<string, string>} Environment variables
 */
function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    log.error(`.env file not found at: ${envPath}`);
    log.error('Please create a .env file in the project root with API_BASE_URL and API_SECRET set.');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envVars = {};

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      envVars[key] = value;
    }
  }

  return envVars;
}

/**
 * Main build function
 */
async function build() {
  log.info('Building ADVA Apps Script...\n');

  // Step 1: Read environment variables
  const envPath = path.resolve(__dirname, '..', '.env');
  log.info(`Reading environment from: ${envPath}`);
  const envVars = readEnvFile(envPath);

  // Step 2: Validate and process API_BASE_URL
  let apiBaseUrl = envVars.API_BASE_URL;
  if (!apiBaseUrl || apiBaseUrl === 'your_domain_here') {
    log.error('API_BASE_URL is not set in .env file!');
    log.error('');
    log.error('Please add API_BASE_URL to your .env file:');
    log.error('  API_BASE_URL=https://your-domain.railway.app');
    log.error('');
    log.error('(Full URL with protocol, e.g., https://example.com)');
    process.exit(1);
  }

  // Validate URL format and ensure it has a protocol
  let fullUrl = apiBaseUrl;
  if (!apiBaseUrl.startsWith('http://') && !apiBaseUrl.startsWith('https://')) {
    // Add https:// if no protocol specified
    fullUrl = `https://${apiBaseUrl}`;
    log.warn(`No protocol specified, using: ${fullUrl}`);
  } else {
    // Validate URL format
    try {
      new URL(apiBaseUrl);
    } catch (error) {
      log.error(`Invalid API_BASE_URL format: ${apiBaseUrl}`);
      log.error('Please use a valid URL (e.g., https://your-domain.railway.app)');
      process.exit(1);
    }
  }

  log.success(`API_BASE_URL: ${fullUrl}`);

  // Step 2.5: Validate API_SECRET
  const apiSecret = envVars.API_SECRET;
  if (!apiSecret) {
    log.error('API_SECRET is not set in .env file!');
    log.error('');
    log.error('Please add API_SECRET to your .env file:');
    log.error('  API_SECRET=your-secret-token');
    log.error('');
    log.error('This secret is used to authenticate API requests.');
    process.exit(1);
  }

  log.success(`API_SECRET: ${'*'.repeat(apiSecret.length)} (${apiSecret.length} characters)`);

  // Step 3: Inject API_BASE_URL and API_SECRET into config.ts
  const templatePath = path.resolve(__dirname, 'src', 'config.template.ts');
  const configPath = path.resolve(__dirname, 'src', 'config.ts');

  log.info('Injecting API_BASE_URL and API_SECRET into config.ts...');

  if (!fs.existsSync(templatePath)) {
    log.error(`Template file not found: ${templatePath}`);
    process.exit(1);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  // Inject full URL with protocol for Apps Script
  let configContent = templateContent.replace('{{API_BASE_URL}}', fullUrl);
  configContent = configContent.replace('{{API_SECRET}}', apiSecret);
  fs.writeFileSync(configPath, configContent, 'utf-8');

  log.success('config.ts generated');

  // Step 4: Bundle with esbuild
  log.info('Bundling with esbuild...');

  const entryPoint = path.resolve(__dirname, 'src', 'main.ts');
  const outfile = path.resolve(__dirname, 'dist', 'main.js');

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outfile,
      format: 'iife',
      globalName: 'ADVA',
      target: 'es2019',
      platform: 'browser',
      minify: true,
      sourcemap: false,
      footer: {
        js: `
// Expose functions to global scope for Apps Script
function onOpen() {
  return ADVA.createMenu();
}

function triggerScan() {
  return ADVA.triggerScan();
}

function triggerRematch() {
  return ADVA.triggerRematch();
}

function triggerAutofillBank() {
  return ADVA.triggerAutofillBank();
}

function showAbout() {
  return ADVA.showAbout();
}
`
      }
    });
    log.success('TypeScript bundled successfully');
  } catch (error) {
    log.error('Bundling failed!');
    log.error(error.message);
    process.exit(1);
  }

  // Step 5: Copy appsscript.json to dist/
  const manifestSrc = path.resolve(__dirname, 'appsscript.json');
  const manifestDest = path.resolve(__dirname, 'dist', 'appsscript.json');

  log.info('Copying appsscript.json to dist/...');

  if (!fs.existsSync(manifestSrc)) {
    log.error(`Manifest file not found: ${manifestSrc}`);
    process.exit(1);
  }

  // Ensure dist directory exists
  const distDir = path.resolve(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.copyFileSync(manifestSrc, manifestDest);
  log.success('appsscript.json copied to dist/');

  // Build complete
  log.success('\n✓ Build complete! Script is ready in apps-script/dist/');
  log.info('\nNext steps:');
  log.info('  1. Run: npm run deploy:script');
  log.info('  2. Or manually: cd apps-script && clasp push');
  log.info('  3. Deploy once after Dashboard is created');
}

// Run build
try {
  await build();
} catch (error) {
  log.error(`Build failed: ${error.message}`);
  process.exit(1);
}
