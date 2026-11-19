/**
 * `@login` mentions in a comment body. A mention is an `@` that does not follow
 * a word character or another `@` (so `bob@example.com` is not one), then a
 * login: letters, digits, `.`, `_`, `-`. Trailing punctuation belongs to the
 * sentence, not the login ("thanks @bob."). Logins are matched case-insensitively,
 * so the result is lower-cased and unique.
 */
const MENTION = /(?<![\w@])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    const login = m[1]!.replace(/[._-]+$/, "").toLowerCase();
    if (login) found.add(login);
  }
  return [...found];
}
