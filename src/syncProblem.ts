// What a failed `punk sync` means for the status bar. Pure: no VS Code imports.
import type { RunResult } from "./punk";
import type { Step } from "./setup";

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
  message: string; // punk's message for this problem, without "punk: "
  latest: string | null; // a different error from a later sync, while this one was not known to be fixed
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

function messageOf(r: RunResult): string {
  return r.stderr.trim().replace(/^punk: /, "");
}

function make(kind: SyncProblemKind, message: string, latest: string | null): SyncProblem {
  const k = KINDS.find((x) => x.kind === kind)!;
  const parts = [k.summary, message];
  if (latest) parts.push(`The last sync failed with another error:\n${latest}`);
  parts.push("This stays until a sync succeeds.");
  return { kind, text: k.text, tooltip: parts.join("\n\n"), message, latest };
}

/**
 * A problem that stays until a person acts, from a `punk sync` result; null for anything else.
 * Exit 0 and 1 mean the remote exchange went through (1 is file conflicts, which `punk status` shows).
 * Exit 2 is any punk error: only the kinds above are lasting. A remote that cannot be reached is not,
 * since the next sync may get past it; it stays a one-off warning, as in `punk session`.
 */
export function syncProblem(r: RunResult): SyncProblem | null {
  if (r.killed || r.code !== 2) return null;
  const message = messageOf(r);
  const hit = KINDS.find((k) => k.pattern.test(message));
  return hit ? make(hit.kind, message, null) : null;
}

/**
 * What the extension keeps after a sync: cleared when the exchange worked; replaced by a new lasting
 * problem; otherwise kept, since the sync could not tell (a killed or timed-out run has no exit code
 * of punk's, and another error means the remote was not reached). The other error is shown with it.
 */
export function afterSync(previous: SyncProblem | null, r: RunResult): SyncProblem | null {
  if (r.killed) return previous;
  if (r.code === 0 || r.code === 1) return null;
  const now = syncProblem(r);
  if (now || !previous) return now;
  return make(previous.kind, previous.message, messageOf(r) || `exit ${r.code}`);
}

/** The block to show: over a suggestion to track a folder, but not while punk itself is not ready. */
export function showBlock(step: Step | null, block: SyncProblem | null): SyncProblem | null {
  return step === null || step === "track" ? block : null;
}
