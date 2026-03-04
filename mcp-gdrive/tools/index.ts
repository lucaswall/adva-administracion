import { schema as gdriveSearchSchema, search } from './gdrive_search.js';
import { schema as gdriveReadFileSchema, readFile } from './gdrive_read_file.js';
import { schema as gdriveListFolderSchema, listFolder } from './gdrive_list_folder.js';
import { schema as gdriveGetPdfSchema, getPdf } from './gdrive_get_pdf.js';
import { schema as gsheetsReadSchema, readSheet } from './gsheets_read.js';
import { schema as gsheetsUpdateSchema, updateSheet } from './gsheets_update.js';
import { schema as gsheetsDeleteRowsSchema, deleteRows } from './gsheets_delete_rows.js';
import { schema as gsheetsAppendRowsSchema, appendRows } from './gsheets_append_rows.js';
import { schema as gdriveMoveFileSchema, moveFile } from './gdrive_move_file.js';
import { schema as gdriveRenameFileSchema, renameFile } from './gdrive_rename_file.js';
import { schema as gdriveCopyFileSchema, copyFile } from './gdrive_copy_file.js';
import { schema as gdriveGetFileInfoSchema, getFileInfo } from './gdrive_get_file_info.js';
import { schema as gsheetsMetadataSchema, getMetadata } from './gsheets_metadata.js';
import {
  Tool,
  GDriveSearchInput,
  GDriveReadFileInput,
  GDriveListFolderInput,
  GDriveGetPdfInput,
  GSheetsReadInput,
  GSheetsUpdateInput,
  GSheetsDeleteRowsInput,
  GSheetsAppendRowsInput,
  GDriveMoveFileInput,
  GDriveRenameFileInput,
  GDriveCopyFileInput,
  GDriveGetFileInfoInput,
  GSheetsMetadataInput,
} from './types.js';

export const tools: [
  Tool<GDriveSearchInput>,
  Tool<GDriveReadFileInput>,
  Tool<GDriveListFolderInput>,
  Tool<GDriveGetPdfInput>,
  Tool<GDriveGetFileInfoInput>,
  Tool<GSheetsReadInput>,
  Tool<GSheetsUpdateInput>,
  Tool<GSheetsDeleteRowsInput>,
  Tool<GSheetsAppendRowsInput>,
  Tool<GDriveMoveFileInput>,
  Tool<GDriveRenameFileInput>,
  Tool<GDriveCopyFileInput>,
  Tool<GSheetsMetadataInput>
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
    ...gdriveGetFileInfoSchema,
    handler: getFileInfo,
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
    ...gsheetsDeleteRowsSchema,
    handler: deleteRows,
  },
  {
    ...gsheetsAppendRowsSchema,
    handler: appendRows,
  },
  {
    ...gdriveMoveFileSchema,
    handler: moveFile,
  },
  {
    ...gdriveRenameFileSchema,
    handler: renameFile,
  },
  {
    ...gdriveCopyFileSchema,
    handler: copyFile,
  },
  {
    ...gsheetsMetadataSchema,
    handler: getMetadata,
  },
];
