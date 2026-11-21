// Turns `punk status --json` into what the status bar shows. Pure: no VS Code imports.
import type { Action, Status } from "./punk";

export type State = "conflict" | "unsaved" | "incoming" | "clean";

export interface Summary {
  state: State;
  text: string; // status bar text, with a $(codicon)
  tooltip: string;
  conflicts: Action[]; // conflicts and blocked files, from save or restore
}

const CHANGES = new Set(["add", "update", "delete"]);
const PROBLEMS = new Set(["conflict", "blocked"]);

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function line(a: Action): string {
  const where = a.path ? `${a.satellite}/${a.path}` : a.satellite;
  return `${a.kind} ${where}${a.note ? ` (${a.note})` : ""}`;
}

export function summarize(status: Status): Summary {
  const conflicts = [...status.save, ...status.restore].filter((a) => PROBLEMS.has(a.kind));
  const unsaved = status.save.filter((a) => CHANGES.has(a.kind));
  const incoming = status.restore.filter((a) => CHANGES.has(a.kind));
  const remote = status.remote ? `${status.remote.kind} remote: ${status.remote.url}` : "no remote (offline mode)";
  const sections: string[] = [];
  if (conflicts.length) sections.push("Needs attention:\n" + conflicts.map(line).join("\n"));
  if (unsaved.length) sections.push("To save:\n" + unsaved.map(line).join("\n"));
  if (incoming.length) sections.push("To restore:\n" + incoming.map(line).join("\n"));
  const tooltip = [...sections, remote].join("\n\n");
  if (conflicts.length) {
    return { state: "conflict", text: `$(warning) punk: ${plural(conflicts.length, "conflict")}`, tooltip, conflicts };
  }
  if (unsaved.length) {
    return { state: "unsaved", text: `$(cloud-upload) punk: ${unsaved.length} to save`, tooltip, conflicts };
  }
  if (incoming.length) {
    return { state: "incoming", text: `$(cloud-download) punk: ${incoming.length} to restore`, tooltip, conflicts };
  }
  return { state: "clean", text: "$(check) punk", tooltip: `All memories saved and restored.\n\n${remote}`, conflicts };
}
