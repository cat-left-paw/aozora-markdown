import { collisionKey, sanitizeFilename } from "./naming.js";
import type { CreateOnlyCommand } from "./hostContracts.js";
export interface PathIdentity {
  path: string;
  kind?: "file" | "directory";
  canonicalIdentity?: string;
  unsafeAlias?: boolean;
}
export interface OutputSnapshot {
  inputs: readonly PathIdentity[];
  existing: readonly PathIdentity[];
  canonicalKey?: (path: string) => string;
}
export interface DirectoryProposal {
  name: string;
  groupId: string;
}
export interface OutputRequest {
  sourceId: string;
  desiredPath: string;
  directories?: readonly DirectoryProposal[];
}
export interface PlannedOutput extends CreateOnlyCommand {
  proposedPath: string;
  collisions: string[];
  requiredCapabilities: readonly [
    "rootContainment",
    "aliasInspection",
    "exclusiveCreate",
  ];
}
export type OutputPlan =
  | { ok: true; outputs: PlannedOutput[]; directories: string[] }
  | { ok: false; code: "INVALID_OUTPUT_PATH"; sourceId: string };
function relative(s: string): boolean {
  return (
    !!s &&
    !/^[\/\\]|^[a-z]:|[\x00-\x1f\x7f]/iu.test(s) &&
    !s.split(/[\/\\]/u).some((x) => x === ".." || x === "." || !x)
  );
}
export function planOutputs(
  requests: readonly OutputRequest[],
  snapshot: OutputSnapshot,
): OutputPlan {
  const keys = (s: string) => [
    "portable:" + collisionKey(s),
    ...(snapshot.canonicalKey ? ["host:" + snapshot.canonicalKey(s)] : []),
  ];
  const get = <T>(map: Map<string, T>, path: string): T | undefined => {
    for (const k of keys(path)) if (map.has(k)) return map.get(k);
    return undefined;
  };
  const put = <T>(map: Map<string, T>, path: string, value: T) => {
    for (const k of keys(path)) map.set(k, value);
  };
  const occupied = new Map<string, PathIdentity>();
  for (const p of [...snapshot.existing, ...snapshot.inputs]) {
    put(occupied, p.path, { ...p });
    const segments = p.path.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join("/");
      if (!get(occupied, parent))
        put(occupied, parent, { path: parent, kind: "directory" });
    }
  }
  const groups = new Map<string, string>(),
    claimedDirectories = new Map<string, string>(),
    directories: string[] = [],
    outputs: PlannedOutput[] = [];
  for (const request of requests) {
    if (!relative(request.desiredPath))
      return {
        ok: false,
        code: "INVALID_OUTPUT_PATH",
        sourceId: request.sourceId,
      };
    const segments = request.desiredPath.split("/"),
      filename = segments.pop()!;
    const match = /^(.*)\.(md|txt)$/iu.exec(filename);
    if (!match)
      return {
        ok: false,
        code: "INVALID_OUTPUT_PATH",
        sourceId: request.sourceId,
      };
    const extension = match[2].toLowerCase() as "md" | "txt",
      stem = match[1];
    const dirs =
      request.directories ??
      segments.map((name, i) => ({
        name,
        groupId: "path:" + segments.slice(0, i + 1).join("/"),
      }));
    let parent = "";
    const collisions: string[] = [];
    for (const dir of dirs) {
      const group = JSON.stringify([parent, dir.groupId]);
      let path = groups.get(group);
      if (!path) {
        for (let n = 0; ; n++) {
          const name = sanitizeFilename(dir.name, {
            suffix: n === 0 ? "" : n === 1 ? "_converted" : `_converted${n}`,
          });
          const candidate = parent ? `${parent}/${name}` : name;
          const old = get(occupied, candidate),
            claim = get(claimedDirectories, candidate);
          if (
            !old ||
            (old.kind === "directory" &&
              !old.unsafeAlias &&
              (!claim || claim === group))
          ) {
            path = candidate;
            put(occupied, path, { path, kind: "directory" });
            put(claimedDirectories, path, group);
            groups.set(group, path);
            directories.push(path);
            break;
          }
          collisions.push(candidate);
        }
      }
      parent = path;
    }
    const proposedPath = request.desiredPath;
    for (let n = 0; ; n++) {
      const name = sanitizeFilename(stem, {
        extension,
        suffix: n === 0 ? "" : n === 1 ? "_converted" : `_converted${n}`,
      });
      const path = parent ? `${parent}/${name}` : name;
      if (get(occupied, path)) {
        collisions.push(path);
        continue;
      }
      put(occupied, path, { path, kind: "file" });
      outputs.push({
        relativePath: path,
        sourceId: request.sourceId,
        mode: "exclusive-create",
        outputEncoding: "utf-8",
        proposedPath,
        collisions,
        requiredCapabilities: [
          "rootContainment",
          "aliasInspection",
          "exclusiveCreate",
        ],
      });
      break;
    }
  }
  return { ok: true, outputs, directories: [...new Set(directories)] };
}
