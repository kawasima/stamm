import type { Behaviors } from "./behaviors.js";

const MAX_PROJECTS = 50;

/**
 * Text the server hands to a client on connect (MCP `instructions`), which the
 * client adds to the agent's context. It carries each visible project's Code of
 * Conduct, so an agent has it before its first write. stamm only delivers the
 * text; what it says and whether it was followed are the project's concern.
 *
 * A key limited to a few projects gets those projects' texts in full. With many
 * projects, only a list is given, and the agent reads the rest with project_get.
 */
export async function buildInstructions(behaviors: Behaviors, actorId: string | undefined): Promise<string | undefined> {
  if (!actorId) return undefined;
  const page = await behaviors.listProjects({ actorId, pagination: { limit: MAX_PROJECTS } });
  const withCoc = page.items.filter((p) => p.codeOfConduct);
  if (withCoc.length === 0) return undefined;

  const head =
    "Each project below has a Code of Conduct. Before you write a comment or an issue in a project, " +
    "read its Code of Conduct and write the text so that it follows it. Change only the wording: keep the facts, " +
    "requests, deadlines and severity as they are. If you are unsure whether a text complies, say so rather than guessing.";

  if (withCoc.length <= 3) {
    const sections = withCoc.map((p) => `## ${p.identifier} (${p.name}) — Code of Conduct\n\n${p.codeOfConduct}`);
    return [head, ...sections].join("\n\n");
  }
  const list = withCoc.map((p) => `- ${p.identifier} (${p.name})`).join("\n");
  return `${head}\n\nProjects with a Code of Conduct (read it with project_get, field codeOfConduct):\n${list}`;
}
