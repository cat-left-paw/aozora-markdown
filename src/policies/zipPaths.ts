export interface ZipEntryMetadata {
  archiveId: string;
  centralDirectoryIndex: number;
  rawName: string;
  decodedName?: string;
  isDirectory?: boolean;
  isSymlink?: boolean;
  unixMode?: number;
}
export interface EntryIdentity {
  archiveId: string;
  centralDirectoryIndex: number;
}
export interface ValidatedZipEntry {
  entryId: EntryIdentity;
  relativeName: string;
  isDirectory: boolean;
}
export type ZipValidation =
  | {
      ok: true;
      entry: ValidatedZipEntry;
      record: { rawName: string; decodedName: string };
    }
  | {
      ok: false;
      code: "UNSAFE_ZIP_ENTRY";
      entryId: EntryIdentity;
      reason: string;
    };
export function validateZipEntry(entry: ZipEntryMetadata): ZipValidation {
  const entryId = {
    archiveId: entry.archiveId,
    centralDirectoryIndex: entry.centralDirectoryIndex,
  };
  const reject = (reason: string): ZipValidation => ({
    ok: false,
    code: "UNSAFE_ZIP_ENTRY",
    entryId,
    reason,
  });
  if (
    !Number.isInteger(entry.centralDirectoryIndex) ||
    entry.centralDirectoryIndex < 0
  )
    return reject("invalid-entry-index");
  if (
    entry.isSymlink ||
    (entry.unixMode !== undefined && (entry.unixMode & 0xf000) === 0xa000)
  )
    return reject("symlink");
  const decodedName = entry.decodedName ?? entry.rawName;
  for (const name of [entry.rawName, decodedName]) {
    if (/[\x00-\x1f]/u.test(name)) return reject("control-character");
    if (/^[\/\\]|^[a-z]:/iu.test(name)) return reject("absolute-or-drive-path");
    if (name.split(/[\/\\]/u).includes("..")) return reject("parent-segment");
  }
  const parts = decodedName.split(/[\/\\]/u).filter((s) => s && s !== ".");
  if (!parts.length) return reject("empty-path");
  return {
    ok: true,
    entry: {
      entryId,
      relativeName: parts.join("/"),
      isDirectory: entry.isDirectory ?? /[\/\\]$/u.test(decodedName),
    },
    record: { rawName: entry.rawName, decodedName },
  };
}
