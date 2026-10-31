/**
 * What infra/aws/help.ts was asked for (review of #140, H7): one report by its code, or the newest few. A code is the
 * first six characters of a report's id, so an all-digit one such as 123456 is a code like any other; a count always
 * says so with --count.
 *
 *   (nothing)                       the newest five
 *   --count 20, --count=20, -n 20   the newest twenty (1 to 50)
 *   3F9A2C, 123456                  the report with that code
 */
export type HelpArgs = { code: string; count: null } | { code: null; count: number };

export const HELP_USAGE = "Usage: npx tsx infra/aws/help.ts [CODE | --count N]  (CODE: a report's six-character code; N: the newest N, 1 to 50)";

export function parseHelpArgs(argv: readonly string[]): HelpArgs | { error: string } {
  const args = argv.flatMap((a) => (a.startsWith("--count=") ? ["--count", a.slice("--count=".length)] : [a]));
  if (args.length === 0) return { code: null, count: 5 };
  if (args.length === 1 && /^[0-9a-f]{6}$/i.test(args[0]!)) return { code: args[0]!.toLowerCase(), count: null };
  if (args.length === 2 && (args[0] === "--count" || args[0] === "-n") && /^\d{1,2}$/.test(args[1]!)) {
    const n = Number(args[1]);
    if (n >= 1 && n <= 50) return { code: null, count: n };
  }
  return { error: HELP_USAGE };
}
