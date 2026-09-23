import {
  validateZipEntry,
  type ZipEntryMetadata,
  type EntryIdentity,
} from "./zipPaths.js";
import {
  planOutputs,
  type OutputRequest,
  type OutputSnapshot,
  type PlannedOutput,
} from "./outputPlan.js";
export interface ZipArchive {
  archiveId: string;
  stem: string;
  entries: readonly ZipEntryMetadata[];
}
export type ZipPlan =
  | {
      ok: true;
      entries: (PlannedOutput & {
        entryId: EntryIdentity;
        validatedRelativeName: string;
      })[];
      directories: string[];
      ignored: EntryIdentity[];
    }
  | {
      ok: false;
      code: "UNSAFE_ZIP_ARCHIVE";
      archiveId: string;
      reason: string;
    };
export interface ZipPlanOptions {
  /** Every TXT/MD entry is written with this extension. Default `md`. */
  outputExtension?: "md" | "txt";
  organizeByAuthor?: boolean;
  metadata?: Readonly<Record<string, { author?: string; title?: string }>>;
}
function outputExtensionOf(options: ZipPlanOptions): "md" | "txt" {
  if ((options as { renameToMd?: unknown }).renameToMd !== undefined)
    throw new TypeError(
      'ZipPlanOptions.renameToMd was removed in aozora-ts-v3: use outputExtension ("md" | "txt").',
    );
  const ext =
    options.outputExtension === undefined ? "md" : options.outputExtension;
  if (ext !== "md" && ext !== "txt")
    throw new TypeError('ZipPlanOptions.outputExtension must be "md" or "txt"');
  return ext;
}
export function planZipEntries(
  archives: readonly ZipArchive[],
  options: ZipPlanOptions = {},
  snapshot: OutputSnapshot = { inputs: [], existing: [] },
): ZipPlan {
  outputExtensionOf(options);
  const requests: OutputRequest[] = [],
    data = new Map<
      string,
      { entryId: EntryIdentity; validatedRelativeName: string }
    >(),
    ignored: EntryIdentity[] = [];
  const seenArchives = new Set<string>();
  for (const archive of archives) {
    if (seenArchives.has(archive.archiveId))
      return {
        ok: false,
        code: "UNSAFE_ZIP_ARCHIVE",
        archiveId: archive.archiveId,
        reason: "duplicate-archive-identity",
      };
    seenArchives.add(archive.archiveId);
    const indices = new Set<number>();
    for (const raw of archive.entries) {
      const validation = validateZipEntry(raw);
      if (
        !validation.ok ||
        raw.archiveId !== archive.archiveId ||
        indices.has(raw.centralDirectoryIndex)
      )
        return {
          ok: false,
          code: "UNSAFE_ZIP_ARCHIVE",
          archiveId: archive.archiveId,
          reason: validation.ok ? "invalid-entry-identity" : validation.reason,
        };
      indices.add(raw.centralDirectoryIndex);
      const e = validation.entry,
        id = JSON.stringify([
          e.entryId.archiveId,
          e.entryId.centralDirectoryIndex,
        ]);
      const segments = e.relativeName.split("/"),
        basename = segments.pop()!,
        m = /^(.*)\.(txt|md)$/iu.exec(basename);
      if (e.isDirectory || !m) {
        ignored.push(e.entryId);
        continue;
      }
      requests.push(zipOutputRequest(archive, e.relativeName, id, options));
      data.set(id, {
        entryId: e.entryId,
        validatedRelativeName: e.relativeName,
      });
    }
  }
  const plan = planOutputs(requests, snapshot);
  if (!plan.ok) throw new Error("Internal validated ZIP output path invariant");
  return {
    ok: true,
    entries: plan.outputs.map((p) => ({ ...p, ...data.get(p.sourceId)! })),
    directories: plan.directories,
    ignored,
  };
}
import { sanitizeFilename } from "./naming.js";
const safeTitle = (s: string) => sanitizeFilename(s);

/** Internal request construction shared with the bytes import adapter. */
export function zipOutputRequest(
  archive: Pick<ZipArchive, "archiveId" | "stem">,
  relativeName: string,
  id: string,
  options: ZipPlanOptions,
): OutputRequest {
  const segments = relativeName.split("/"),
    basename = segments.pop()!,
    m = /^(.*)\.(txt|md)$/iu.exec(basename)!;
  const ext = outputExtensionOf(options);
  const meta = options.metadata?.[id];
  const directories = options.organizeByAuthor
    ? [
        {
          name: meta?.author ?? "unknown_author",
          groupId: "author:" + (meta?.author ?? "unknown_author"),
        },
      ]
    : [
        { name: archive.stem, groupId: "archive:" + archive.archiveId },
        ...segments.map((name, i) => ({
          name,
          groupId: JSON.stringify([
            archive.archiveId,
            segments.slice(0, i + 1),
          ]),
        })),
      ];
  // Only the basename below is executable naming input; raw ZIP paths never reach a writer.
  const title = options.organizeByAuthor ? (meta?.title ?? m[1]) : m[1];
  // sanitize individual name data before assembling the output path.
  return {
    sourceId: id,
    desiredPath: `${safeTitle(title)}.${ext}`,
    directories,
  };
}
