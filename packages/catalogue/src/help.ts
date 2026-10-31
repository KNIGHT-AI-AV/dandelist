/**
 * What a help report may carry from the app (apps/mobile/lib/help.ts) to the server (apps/api/src/help.ts), shared so
 * both keep to one list (review of #140): where the app is, the device and build, and its last errors and warnings, with
 * anything shaped like a credential cut out. The phone cuts each line before keeping it; the server keeps only these
 * fields and cuts every line again before storing a report.
 */
export interface HelpLine {
  at: string;
  level: "error" | "warn";
  text: string;
}

export interface HelpDiagnostics {
  route?: string;
  platform?: string;
  os?: string;
  version?: string | null;
  build?: string | null;
  window?: { width?: number; height?: number; scale?: number; fontScale?: number };
  at?: string;
  logs?: HelpLine[];
}

/** The last lines kept for a report, and the longest a line may be. */
export const HELP_LOG_KEEP = 40;
export const HELP_LINE_MAX = 600;

const CUT = "[removed]";
const RULES: [RegExp, string][] = [
  // An address keeps its origin and path: its query and fragment (sign-in tickets, codes, tokens) go.
  [/\b(https?:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, "$1"],
  // Authorization header values.
  [/\b(Bearer)\s+[^\s"',;]{6,}/gi, `$1 ${CUT}`],
  [/\b(Basic)\s+[A-Za-z0-9+/]{16,}={0,2}/g, `$1 ${CUT}`],
  // JSON web tokens, wherever they appear.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, CUT],
  // A named secret's value, as key=value or "key": "value": tokens, tickets, keys, passwords, one-time codes.
  [/\b((?:[A-Za-z]+[_-]?)?(?:token|ticket|secret|password|passcode|authorization|api[_-]?key)|code|otp)(["']?\s*[:=]\s*["']?)([^\s"'&,;}\]]+)/gi, `$1$2${CUT}`],
  // Long opaque strings (keys, signatures, encoded data): 32 or more letters and digits in a row.
  [/\b[A-Za-z0-9_+]{32,}={0,2}/g, CUT],
];

/** A log line or route with anything shaped like a credential cut out. */
export function redactDiagnostic(text: string): string {
  return RULES.reduce((out, [rule, to]) => out.replace(rule, to), text);
}
