/**
 * The only module that pulls in the xlsx layer. The admin panel reaches it
 * exclusively through `await import('../lib/master/lazy')`, so none of this
 * ships in the initial bundle — an auditor on a phone never downloads it.
 */
import { buildMasterSheets, exportFilename } from './export'
import type { ExportInput } from './export'
import { validateWorkbook } from './import'
import type { ImportContext, ImportPlan } from './import'
import { readXlsx, XlsxError } from '../xlsx/read'
import { writeXlsx } from '../xlsx/write'
import { canRead } from '../xlsx/zip'

export { canRead, exportFilename, XlsxError }
export type { ImportPlan }

export function buildWorkbook(input: ExportInput): Blob {
  const bytes = writeXlsx(buildMasterSheets(input))
  return new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function readAndValidate(file: File, ctx: ImportContext): Promise<ImportPlan> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const wb = await readXlsx(bytes)
  return validateWorkbook(wb, ctx)
}
