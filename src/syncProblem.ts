// What a failed `punk sync` means for the status bar. Pure: no VS Code imports.
import type { RunResult } from "./punk";

/**
 * merge:    the store and its remote both changed the same file (punk 0.6.1+)
 * notstore: the remote is not a punk store (punk 0.6.2+; older punk mixed it in silently)
 * age:      the store syncs through an encrypted remote and age is not on PATH (punk 0.6.1+)
 */
export type SyncProblemKind = "merge" | "notstore" | "age";

export interface SyncProblem {
  kind: SyncProblemKind;
  text: string; // status bar text, with a $(codicon)
  tooltip: string; // first line: what is wrong and what to do; then punk's own message
}

const KINDS: { kind: SyncProblemKind; pattern: RegExp; text: string; summary: string }[] = [
  {
    kind: "merge",
    pattern: /could not merge .*: both changed /,
    text: "$(warning) punk: sync blocked",
    summary: "Sync is blocked: the store and its remote both changed the same files. Merge them by hand, then sync.",
  },
  {
    kind: "notstore",
    pattern: /could not merge .*: it is not a punk store/,
    text: "$(warning) punk: wrong remote",
    summary: "Sync is blocked: the store's remote is not a Punk Records store. Check the remote, then sync.",
  },
  {
    kind: "age",
    pattern: /encryption needs .* on PATH/,
    text: "$(warning) punk: needs age",
    summary: "Sync is blocked: this store syncs encrypted, and age is not installed. Install age, then sync.",
  },
];

/**
 * A problem that stays until a person acts, from a `punk sync` result; null for anything else.
 * Exit 0 and 1 mean the remote exchange went through (1 is file conflicts, which `punk status` shows).
 * Exit 2 is any punk error: only the kinds above are lasting. A remote that cannot be reached is not,
 * since the next sync may get past it; it stays a one-off warning, as in `punk session`.
 */
export function syncProblem(r: RunResult): SyncProblem | null {
  if (r.code !== 2) return null;
  const message = r.stderr.trim().replace(/^punk: /, "");
  const hit = KINDS.find((k) => k.pattern.test(message));
  if (!hit) return null;
  return {
    kind: hit.kind,
    text: hit.text,
    tooltip: `${hit.summary}\n\n${message}\n\nThis stays until a sync succeeds.`,
  };
}

/** What the extension keeps after a sync: cleared when the exchange worked, kept when it is unknown. */
export function afterSync(previous: SyncProblem | null, r: RunResult): SyncProblem | null {
  if (r.code === 0 || r.code === 1) return null;
  return syncProblem(r) ?? previous;
}
