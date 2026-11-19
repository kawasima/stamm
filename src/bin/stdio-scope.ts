import { KeyScope } from "../schema/credential.js";

/**
 * Parse STAMM_SCOPE, the stdio counterpart of a key's scope. Unset or blank means
 * unrestricted. Anything that does not parse is an error: a typo must not leave
 * the server running with more access than the operator intended.
 */
export function parseScopeEnv(raw: string | undefined): KeyScope {
  if (raw === undefined || raw.trim() === "") return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("STAMM_SCOPE is not valid JSON");
  }
  const parsed = KeyScope.strict().safeParse(json);
  if (!parsed.success) {
    throw new Error(`STAMM_SCOPE is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function isRestricted(scope: KeyScope): boolean {
  return scope.readOnly === true || scope.projectIds !== undefined;
}
