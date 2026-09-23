export interface DestinationCapabilities {
  rootContainment: boolean;
  aliasInspection: boolean;
  exclusiveCreate: boolean;
  delivery: "filesystem" | "browser-artifact";
}
export type DestinationCheck =
  | {
      ok: true;
      operation: "exclusive-create";
      delivery: "filesystem" | "browser-artifact";
    }
  | { ok: false; code: "UNSAFE_DESTINATION" | "EXCLUSIVE_CREATE_UNAVAILABLE" };
export function authorizeDestination(
  capabilities: DestinationCapabilities,
  observed: {
    insideRoot: boolean;
    parentSymlink: boolean;
    leafExists: boolean;
    sourceAlias: boolean;
  },
): DestinationCheck {
  if (
    !capabilities.rootContainment ||
    !capabilities.aliasInspection ||
    !observed.insideRoot ||
    observed.parentSymlink ||
    observed.leafExists ||
    observed.sourceAlias
  )
    return { ok: false, code: "UNSAFE_DESTINATION" };
  if (!capabilities.exclusiveCreate)
    return { ok: false, code: "EXCLUSIVE_CREATE_UNAVAILABLE" };
  return {
    ok: true,
    operation: "exclusive-create",
    delivery: capabilities.delivery,
  };
}
/** A checked plan is not authorization to truncate. Host MUST perform an atomic create.
 * A collision after this check must fail/replan; never unlink or replace an existing path.
 */
export interface CreateOnlyCommand {
  relativePath: string;
  sourceId: string;
  mode: "exclusive-create";
  outputEncoding: "utf-8";
}
