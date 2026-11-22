import { z } from "zod";

export type AnyContract = z.ZodFunction<z.ZodTuple<any, any>, any>;

/**
 * Extract the argument object schema from a behavior contract
 * (`z.function().args(z.object({...}))`).
 */
export function contractArgsObject(contract: AnyContract): z.ZodObject<z.ZodRawShape> {
  const argsObject = contract.parameters()._def.items[0];
  if (!(argsObject instanceof z.ZodObject)) {
    throw new Error("contract args[0] is not a ZodObject");
  }
  return argsObject as z.ZodObject<z.ZodRawShape>;
}

/**
 * The argument object's raw shape, for use as an MCP tool inputSchema.
 */
export function contractArgs(contract: AnyContract): z.ZodRawShape {
  return contractArgsObject(contract).shape;
}

/**
 * Extract the resolved return schema from a behavior contract, unwrapping the
 * `Promise(...)`, for use as an MCP tool outputSchema.
 */
export function contractReturn(contract: AnyContract): z.ZodTypeAny {
  const ret = contract.returnType();
  return ret instanceof z.ZodPromise ? ret._def.type : ret;
}

/**
 * A behavior's result as its contract declares it, for handing to a client. Fields
 * the contract does not name are dropped: what an implementation happens to have
 * loaded (an email, a storage key) is not thereby published. A result that does not
 * fit the contract is a bug in the server and is thrown, not sent; the error names
 * the fields and not their values.
 */
export function declaredResult(contract: AnyContract, result: unknown): unknown {
  const schema = contractReturn(contract);
  if (schema instanceof z.ZodVoid) return undefined;
  const parsed = schema.safeParse(result ?? (schema.isNullable() ? null : result));
  if (!parsed.success) throw new Error(`result does not match its contract: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join(", ")}`);
  return parsed.data;
}
