/**
 * Domain errors. Behaviors throw these; the MCP layer turns a throw into an
 * `isError` tool result (see src/mcp/registry.ts), so no special wiring is
 * needed beyond throwing a clear, human-readable message.
 */
export class DomainError extends Error {}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} not found: ${id}` : `${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * A write was rejected because its value violates a domain rule (e.g. a custom
 * field value that does not match its definition's type, constraints, or scope).
 * Distinct from NotFound/Conflict: the request is well-formed but invalid.
 */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Authentication failure at the transport boundary (e.g. a missing, malformed,
 * expired, or unverifiable JWT). The HTTP layer maps this to a 401. It extends
 * DomainError so a stray throw inside a behavior still surfaces as an MCP error.
 */
export class UnauthorizedError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
