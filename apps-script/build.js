#!/usr/bin/env node
/**
 * Build script for ADVA Apps Script Library
 *
 * This script:
 * 1. Reads API_BASE_URL from .env file
 * 2. Injects it into config.template.ts → config.ts
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
    log.error('Please create a .env file in the project root with API_BASE_URL set.');
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
  log.info('Building ADVA Apps Script Library...\n');

  // Step 1: Read environment variables
  const envPath = path.resolve(__dirname, '..', '.env');
  log.info(`Reading environment from: ${envPath}`);
  const envVars = readEnvFile(envPath);

  // Step 2: Validate API_BASE_URL
  const apiBaseUrl = envVars.API_BASE_URL;
  if (!apiBaseUrl || apiBaseUrl === 'your_domain_here') {
    log.error('API_BASE_URL is not set in .env file!');
    log.error('');
    log.error('Please add API_BASE_URL to your .env file:');
    log.error('  API_BASE_URL=your-domain.railway.app');
    log.error('');
    log.error('(Domain only, no protocol)');
    process.exit(1);
  }

  log.success(`API_BASE_URL: ${apiBaseUrl}`);

  // Step 3: Inject API_BASE_URL into config.ts
  const templatePath = path.resolve(__dirname, 'src', 'config.template.ts');
  const configPath = path.resolve(__dirname, 'src', 'config.ts');

  log.info('Injecting API_BASE_URL into config.ts...');

  if (!fs.existsSync(templatePath)) {
    log.error(`Template file not found: ${templatePath}`);
    process.exit(1);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  const configContent = templateContent.replace('{{API_BASE_URL}}', apiBaseUrl);
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
      globalName: 'ADVALib',
      target: 'es2019',
      platform: 'browser',
      minify: false,
      sourcemap: false,
      footer: {
        js: `
// Expose functions to global scope for Apps Script
var createMenu = ADVALib.createMenu;
var triggerScan = ADVALib.triggerScan;
var triggerRematch = ADVALib.triggerRematch;
var triggerAutofillBank = ADVALib.triggerAutofillBank;
var showAbout = ADVALib.showAbout;
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
  log.success('\n✓ Build complete! Library is ready in apps-script/dist/');
  log.info('\nNext steps:');
  log.info('  1. Run: npm run deploy:library');
  log.info('  2. Or manually: cd apps-script && clasp push');
}

// Run build
try {
  await build();
} catch (error) {
  log.error(`Build failed: ${error.message}`);
  process.exit(1);
}
