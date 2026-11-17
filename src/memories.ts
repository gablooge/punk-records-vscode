// Which tracked satellite a file belongs to, and whether it is a memory file. Pure: no VS Code imports.
import * as path from "node:path";
import type { Listing } from "./punk";

// File names that are memories anywhere in a project (mirrors punk's discover.BASENAMES).
const BASENAMES = new Set([
  "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENT.md", "GEMINI.md", "napkin.md", "NAPKIN.md", ".napkin.md",
  "CONVENTIONS.md", ".cursorrules", ".windsurfrules", ".clinerules", ".goosehints",
]);
// Folders and files (relative to the project) that hold memories (mirrors discover.PROJECT_GLOBS).
const PREFIXES = [
  ".github/copilot-instructions.md", ".github/instructions/", ".cursor/rules/", ".windsurf/rules/",
  ".clinerules/", ".roo/rules/", ".kiro/steering/", ".claude/",
];

export interface FileInSatellite {
  satellite: string;
  rel: string; // POSIX path relative to the satellite's local folder
}

/** The tracked satellite containing `file` (deepest wins), if the file looks like a memory. */
export function memoryFile(listing: Listing, file: string): FileInSatellite | null {
  let best: FileInSatellite | null = null;
  let bestDepth = -1;
  for (const sat of listing.satellites) {
    if (!sat.local_path) continue;
    const rel = path.relative(sat.local_path, file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const posix = rel.split(path.sep).join("/");
    const known = sat.memories.includes(posix);
    const looks = BASENAMES.has(path.basename(file)) || PREFIXES.some((p) => posix === p || posix.startsWith(p));
    if (!known && !looks) continue;
    if (sat.kind === "global" && !known && !posix.startsWith(".")) continue; // global: only dotfile folders
    const depth = sat.local_path.split(/[\\/]/).length;
    if (depth > bestDepth) {
      best = { satellite: sat.id, rel: posix };
      bestDepth = depth;
    }
  }
  return best;
}
