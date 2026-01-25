#!/usr/bin/env node

/**
 * Upload all PDFs from _samples directory to Google Drive Entrada folder
 * Usage: node support/upload-samples.js
 */

import { createReadStream, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { google } from 'googleapis';
import { styleText } from 'node:util';
import cliProgress from 'cli-progress';

/**
 * ASCII Art Banner
 */
function printBanner() {
  const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     █████╗ ██████╗ ██╗   ██╗ █████╗     ██╗   ██╗██████╗      ║
║    ██╔══██╗██╔══██╗██║   ██║██╔══██╗    ██║   ██║██╔══██╗     ║
║    ███████║██║  ██║██║   ██║███████║    ██║   ██║██████╔╝     ║
║    ██╔══██║██║  ██║╚██╗ ██╔╝██╔══██║    ██║   ██║██╔═══╝      ║
║    ██║  ██║██████╔╝ ╚████╔╝ ██║  ██║    ╚██████╔╝██║          ║
║    ╚═╝  ╚═╝╚═════╝   ╚═══╝  ╚═╝  ╚═╝     ╚═════╝ ╚═╝          ║
║                                                               ║
║              Sample PDF Upload to Google Drive                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;
  console.log(styleText('cyan', banner));
}

/**
 * Print a formatted step message
 */
function printStep(stepNum, message) {
  const prefix = styleText('yellow', `[Step ${stepNum}]`);
  console.log(`\n${prefix} ${message}`);
}

/**
 * Print a success message
 */
function printSuccess(message) {
  console.log(styleText('green', `✓ ${message}`));
}

/**
 * Print an error message
 */
function printError(message) {
  console.log(styleText('red', `✗ ${message}`));
}

/**
 * Print an info message
 */
function printInfo(message) {
  console.log(styleText('blue', `ℹ ${message}`));
}

/**
 * Parse service account credentials from environment
 */
function getServiceAccountCredentials() {
  const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!keyString) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment');
  }

  try {
    // Try base64 decode first
    const decoded = Buffer.from(keyString, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    // Try as raw JSON
    try {
      return JSON.parse(keyString);
    } catch {
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY format');
    }
  }
}

/**
 * Get authenticated Drive client
 */
function getDriveClient() {
  const credentials = getServiceAccountCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Find Entrada folder ID
 */
async function findEntradaFolder(drive) {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;

  if (!rootId) {
    throw new Error('DRIVE_ROOT_FOLDER_ID not found in environment');
  }

  printInfo(`Searching for Entrada folder in root: ${rootId}`);

  const response = await drive.files.list({
    q: `'${rootId}' in parents and name = 'Entrada' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = response.data.files || [];

  if (files.length === 0) {
    throw new Error('Entrada folder not found');
  }

  const entradaId = files[0].id;
  printSuccess(`Found Entrada folder: ${entradaId}`);

  return entradaId;
}

/**
 * Recursively find all PDF files in a directory
 */
function findPdfFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      findPdfFiles(filePath, fileList);
    } else if (file.toLowerCase().endsWith('.pdf')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * Upload a file to Google Drive
 */
async function uploadFile(drive, filePath, folderId) {
  const fileName = basename(filePath);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: createReadStream(filePath),
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });

  return response.data.id;
}

/**
 * Main function
 */
async function main() {
  try {
    // Print banner
    printBanner();

    // Step 1: Initialize Drive client
    printStep(1, 'Authenticating with Google Drive');
    const drive = getDriveClient();
    printSuccess('Authentication successful');

    // Step 2: Find Entrada folder
    printStep(2, 'Locating Entrada folder');
    const entradaId = await findEntradaFolder(drive);

    // Step 3: Find PDF files
    printStep(3, 'Scanning for PDF files');
    const samplesDir = join(process.cwd(), '_samples');
    printInfo(`Directory: ${samplesDir}`);

    const pdfFiles = findPdfFiles(samplesDir);
    printSuccess(`Found ${pdfFiles.length} PDF file${pdfFiles.length !== 1 ? 's' : ''}`);

    if (pdfFiles.length === 0) {
      printInfo('No PDF files to upload');
      return;
    }

    // Step 4: Upload files with progress bar
    printStep(4, 'Uploading files to Google Drive');
    console.log(''); // Empty line before progress bar

    const progressBar = new cliProgress.SingleBar({
      format: `${styleText('cyan', 'Progress')} |{bar}| {percentage}% | {value}/{total} files | {filename}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    });

    progressBar.start(pdfFiles.length, 0, { filename: 'Initializing...' });

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < pdfFiles.length; i++) {
      const filePath = pdfFiles[i];
      const fileName = basename(filePath);

      progressBar.update(i, { filename: fileName });

      try {
        await uploadFile(drive, filePath, entradaId);
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({ file: fileName, error: error.message });
      }

      progressBar.update(i + 1, { filename: fileName });
    }

    progressBar.stop();

    // Summary
    console.log('\n' + styleText('bold', '═'.repeat(63)));
    console.log(styleText('bold', '                         UPLOAD SUMMARY'));
    console.log(styleText('bold', '═'.repeat(63)));
    console.log('');
    console.log(`  ${styleText('green', '✓')} Successful: ${styleText('green', successCount.toString())}`);
    console.log(`  ${styleText('red', '✗')} Failed:     ${styleText('red', errorCount.toString())}`);
    console.log(`  ${styleText('blue', '━')} Total:      ${styleText('blue', pdfFiles.length.toString())}`);

    if (errors.length > 0) {
      console.log('\n' + styleText('red', 'Errors:'));
      errors.forEach(({ file, error }) => {
        console.log(`  ${styleText('red', '✗')} ${file}: ${error}`);
      });
    }

    console.log('\n' + styleText('bold', '═'.repeat(63)));

    if (errorCount > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.log('\n');
    printError(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
