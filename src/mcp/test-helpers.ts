import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStammServer } from "./server.js";
import type { Behaviors } from "./behaviors.js";

/** A fully-valid Issue, matching schema/issue.ts, for use as a return fixture. */
export const validIssue = {
  id: "i1",
  key: "PROJ",
  number: 1,
  projectId: "p1",
  issueTypeId: "t1",
  priorityId: "pr1",
  statusId: "s1",
  subject: "Something is broken",
  authorId: "u1",
  visibility: "public" as const,
  customFields: [],
};

/**
 * Build a Behaviors stub. Any method not supplied throws when called, so a
 * test only wires up the handful of behaviors it actually exercises.
 */
export function stubBehaviors(overrides: Partial<Behaviors> = {}): Behaviors {
  return new Proxy(overrides as Behaviors, {
    get(target, prop: string) {
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      return () => {
        throw new Error(`Behaviors.${prop} was called but not stubbed`);
      };
    },
  });
}

/** Connect an in-memory client to a stamm server backed by `behaviors`. */
export async function connect(behaviors: Behaviors, opts?: { actorId?: string }): Promise<Client> {
  const server = createStammServer(behaviors, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}
