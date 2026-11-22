// What the extension asks the user to do next while punk is not ready. Pure: no VS Code imports.
import type { Problem } from "./punk";

export type Step = "install" | "upgrade" | "init" | "track";

/** The next setup step: for a setup problem, or nothing tracked yet. null when nothing is needed. */
export function nextStep(problem: Problem | null, tracked: number): Step | null {
  if (problem === "missing") return "install";
  if (problem === "old") return "upgrade";
  if (problem === "nostore") return "init";
  if (problem === null && tracked === 0) return "track";
  return null;
}

/** Status bar text and tooltip while a setup step is pending. */
export function setupStatus(step: Step, detail: string): { text: string; tooltip: string } {
  const what: Record<Step, string> = {
    install: "Install punk",
    upgrade: "Upgrade punk to 0.4.0 or newer",
    init: "Create a store (or bring back your existing one)",
    track: "Track this folder",
  };
  return { text: "$(tools) punk: set up", tooltip: `${what[step]}. Click to start.${detail ? `\n\n${detail}` : ""}` };
}

/** The terminal command for installing or upgrading punk. Fixed text: nothing from settings or input. */
export function installCommand(step: "install" | "upgrade"): string {
  return step === "install" ? "pipx install punk-records" : "pipx upgrade punk-records";
}
