#!/usr/bin/env node

/**
 * Upload all PDFs from _samples directory to Google Drive Entrada folder
 * Usage: node support/upload-samples.js
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { google } from 'googleapis';
import { config } from 'dotenv';

// Load environment variables
config();

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

  console.log(`Searching for Entrada folder in root: ${rootId}`);

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
  console.log(`Found Entrada folder: ${entradaId}`);

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
  const fileContent = readFileSync(filePath);

  console.log(`Uploading: ${filePath}`);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: fileContent,
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });

  console.log(`  ✓ Uploaded as: ${response.data.name} (${response.data.id})`);

  return response.data.id;
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting upload process...\n');

    // Initialize Drive client
    const drive = getDriveClient();

    // Find Entrada folder
    const entradaId = await findEntradaFolder(drive);

    // Find all PDF files in _samples
    const samplesDir = join(process.cwd(), '_samples');
    console.log(`\nScanning directory: ${samplesDir}`);

    const pdfFiles = findPdfFiles(samplesDir);
    console.log(`Found ${pdfFiles.length} PDF files\n`);

    if (pdfFiles.length === 0) {
      console.log('No PDF files to upload');
      return;
    }

    // Upload each file
    let successCount = 0;
    let errorCount = 0;

    for (const filePath of pdfFiles) {
      try {
        await uploadFile(drive, filePath, entradaId);
        successCount++;
      } catch (error) {
        console.error(`  ✗ Error uploading ${filePath}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\nUpload complete!`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);

  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
