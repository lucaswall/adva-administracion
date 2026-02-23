import { schema as gdriveSearchSchema, search } from './gdrive_search.js';
import { schema as gdriveReadFileSchema, readFile } from './gdrive_read_file.js';
import { schema as gdriveListFolderSchema, listFolder } from './gdrive_list_folder.js';
import { schema as gdriveGetPdfSchema, getPdf } from './gdrive_get_pdf.js';
import { schema as gsheetsReadSchema, readSheet } from './gsheets_read.js';
import { schema as gsheetsUpdateSchema, updateSheet } from './gsheets_update.js';
import { schema as gdriveMoveFileSchema, moveFile } from './gdrive_move_file.js';
import { schema as gdriveRenameFileSchema, renameFile } from './gdrive_rename_file.js';
import {
  Tool,
  GDriveSearchInput,
  GDriveReadFileInput,
  GDriveListFolderInput,
  GDriveGetPdfInput,
  GSheetsReadInput,
  GSheetsUpdateInput,
  GDriveMoveFileInput,
  GDriveRenameFileInput,
} from './types.js';

export const tools: [
  Tool<GDriveSearchInput>,
  Tool<GDriveReadFileInput>,
  Tool<GDriveListFolderInput>,
  Tool<GDriveGetPdfInput>,
  Tool<GSheetsReadInput>,
  Tool<GSheetsUpdateInput>,
  Tool<GDriveMoveFileInput>,
  Tool<GDriveRenameFileInput>
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
  {
    ...gsheetsUpdateSchema,
    handler: updateSheet,
  },
  {
    ...gdriveMoveFileSchema,
    handler: moveFile,
  },
  {
    ...gdriveRenameFileSchema,
    handler: renameFile,
  },
];
