import { schema as gdriveSearchSchema, search } from './gdrive_search.js';
import { schema as gdriveReadFileSchema, readFile } from './gdrive_read_file.js';
import { schema as gdriveListFolderSchema, listFolder } from './gdrive_list_folder.js';
import { schema as gdriveGetPdfSchema, getPdf } from './gdrive_get_pdf.js';
import { schema as gsheetsReadSchema, readSheet } from './gsheets_read.js';
import {
  Tool,
  GDriveSearchInput,
  GDriveReadFileInput,
  GDriveListFolderInput,
  GDriveGetPdfInput,
  GSheetsReadInput,
} from './types.js';

export const tools: [
  Tool<GDriveSearchInput>,
  Tool<GDriveReadFileInput>,
  Tool<GDriveListFolderInput>,
  Tool<GDriveGetPdfInput>,
  Tool<GSheetsReadInput>
] = [
  {
    ...gdriveSearchSchema,
    handler: search,
  },
  {
    ...gdriveReadFileSchema,
    handler: readFile,
  },
  {
    ...gdriveListFolderSchema,
    handler: listFolder,
  },
  {
    ...gdriveGetPdfSchema,
    handler: getPdf,
  },
  {
    ...gsheetsReadSchema,
    handler: readSheet,
  },
];
