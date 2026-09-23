import { ImportFailure } from "./limits.js";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const ZIP64_LOCATOR_BYTES = 20;

const failure = (reason: string): never => {
  throw new ImportFailure("ZIP_HEADER_MISMATCH", "structure", "unit", reason);
};

function safeNumber(value: bigint, reason: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) failure(reason);
  return Number(value);
}

function locateEocd(
  bytes: Uint8Array,
  view: DataView,
  adoptedCommentBytes: number,
): number {
  if (
    !Number.isSafeInteger(adoptedCommentBytes) ||
    adoptedCommentBytes < 0 ||
    adoptedCommentBytes > MAX_COMMENT_BYTES
  )
    failure("end-record-comment");
  const offset = bytes.length - EOCD_BYTES - adoptedCommentBytes;
  if (
    offset < 0 ||
    view.getUint32(offset, true) !== EOCD_SIGNATURE ||
    view.getUint16(offset + 20, true) !== adoptedCommentBytes
  )
    failure("end-record-missing");
  return offset;
}

interface Zip64EndRecord {
  recordOffset: number;
  entriesOnDisk: number;
  totalEntries: number;
  centralBytes: number;
  centralOffset: number;
}

function readZip64EndRecord(
  view: DataView,
  eocdOffset: number,
): Zip64EndRecord {
  const locatorOffset = eocdOffset - ZIP64_LOCATOR_BYTES;
  if (
    locatorOffset < 0 ||
    view.getUint32(locatorOffset, true) !== ZIP64_LOCATOR_SIGNATURE
  )
    failure("zip64-locator-missing");
  if (
    view.getUint32(locatorOffset + 4, true) !== 0 ||
    view.getUint32(locatorOffset + 16, true) !== 1
  )
    failure("zip64-multi-disk");
  const recordOffset = safeNumber(
    view.getBigUint64(locatorOffset + 8, true),
    "zip64-record-offset",
  );
  if (
    recordOffset + 56 > locatorOffset ||
    view.getUint32(recordOffset, true) !== ZIP64_EOCD_SIGNATURE
  )
    failure("zip64-end-record-missing");
  const recordBytes = safeNumber(
    view.getBigUint64(recordOffset + 4, true),
    "zip64-end-record-size",
  );
  if (recordBytes < 44 || recordOffset + 12 + recordBytes !== locatorOffset)
    failure("zip64-end-record-size");
  if (
    view.getUint32(recordOffset + 16, true) !== 0 ||
    view.getUint32(recordOffset + 20, true) !== 0
  )
    failure("zip64-multi-disk");
  return {
    recordOffset,
    entriesOnDisk: safeNumber(
      view.getBigUint64(recordOffset + 24, true),
      "zip64-entry-count",
    ),
    totalEntries: safeNumber(
      view.getBigUint64(recordOffset + 32, true),
      "zip64-entry-count",
    ),
    centralBytes: safeNumber(
      view.getBigUint64(recordOffset + 40, true),
      "zip64-central-size",
    ),
    centralOffset: safeNumber(
      view.getBigUint64(recordOffset + 48, true),
      "zip64-central-offset",
    ),
  };
}

/** Validate the adopted single-disk profile fields that zip.js does not cross-check. */
export function validateZipStructure(
  bytes: Uint8Array,
  entryOffsets: readonly number[],
  adoptedCommentBytes: number,
): void {
  if (bytes.length < EOCD_BYTES) failure("end-record-missing");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = locateEocd(bytes, view, adoptedCommentBytes);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  if (diskNumber !== 0 || centralDisk !== 0) failure("multi-disk");

  const diskEntries16 = view.getUint16(eocdOffset + 8, true);
  const totalEntries16 = view.getUint16(eocdOffset + 10, true);
  const centralBytes32 = view.getUint32(eocdOffset + 12, true);
  const centralOffset32 = view.getUint32(eocdOffset + 16, true);
  const needsZip64 =
    diskEntries16 === 0xffff ||
    totalEntries16 === 0xffff ||
    centralBytes32 === 0xffffffff ||
    centralOffset32 === 0xffffffff;

  let entriesOnDisk = diskEntries16;
  let totalEntries = totalEntries16;
  let centralBytes = centralBytes32;
  let centralOffset = centralOffset32;
  let firstEndRecordOffset = eocdOffset;
  if (needsZip64) {
    const zip64 = readZip64EndRecord(view, eocdOffset);
    firstEndRecordOffset = zip64.recordOffset;
    if (diskEntries16 !== 0xffff && diskEntries16 !== zip64.entriesOnDisk)
      failure("end-record-entry-count");
    if (totalEntries16 !== 0xffff && totalEntries16 !== zip64.totalEntries)
      failure("end-record-entry-count");
    entriesOnDisk =
      diskEntries16 === 0xffff ? zip64.entriesOnDisk : diskEntries16;
    totalEntries =
      totalEntries16 === 0xffff ? zip64.totalEntries : totalEntries16;
    if (centralBytes32 !== 0xffffffff && centralBytes32 !== zip64.centralBytes)
      failure("zip64-central-size");
    if (
      centralOffset32 !== 0xffffffff &&
      centralOffset32 !== zip64.centralOffset
    )
      failure("zip64-central-offset");
    centralBytes = zip64.centralBytes;
    centralOffset = zip64.centralOffset;
  }

  if (entriesOnDisk !== totalEntries) failure("end-record-entry-count");
  if (totalEntries !== entryOffsets.length) failure("central-entry-count");
  if (
    !Number.isSafeInteger(centralOffset) ||
    !Number.isSafeInteger(centralBytes) ||
    !Number.isSafeInteger(centralOffset + centralBytes) ||
    centralOffset + centralBytes > firstEndRecordOffset
  )
    failure("central-directory-range");

  if (totalEntries === 0) {
    if (centralOffset !== 0 || centralBytes !== 0 || firstEndRecordOffset !== 0)
      failure("prepended-data");
    return;
  }
  if (
    Math.min(...entryOffsets) !== 0 ||
    bytes.length < 4 ||
    view.getUint32(0, true) !== LOCAL_FILE_SIGNATURE
  )
    failure("prepended-data");
}
