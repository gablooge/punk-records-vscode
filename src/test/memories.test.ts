import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { memoryFile } from "../memories";
import type { Listing } from "../punk";

const root = path.resolve("/work/app");
const home = path.resolve("/home/me");
const listing: Listing = {
  version: 1,
  satellites: [
    { id: "global", kind: "global", name: "global", local_path: home, memories: [".claude/CLAUDE.md"] },
    { id: "github.com/me/app", kind: "project", name: "app", local_path: root, memories: ["CLAUDE.md"] },
    { id: "github.com/me/lib", kind: "project", name: "lib", local_path: path.join(root, "vendor", "lib"), memories: [] },
    { id: "github.com/me/old", kind: "project", name: "old", local_path: null, memories: ["CLAUDE.md"] },
  ],
  subscriptions: [],
};

test("known and new memory files map to their satellite", () => {
  assert.deepEqual(memoryFile(listing, path.join(root, "CLAUDE.md")), { satellite: "github.com/me/app", rel: "CLAUDE.md" });
  assert.deepEqual(memoryFile(listing, path.join(root, "pkg", "AGENTS.md")), { satellite: "github.com/me/app", rel: "pkg/AGENTS.md" });
  assert.deepEqual(memoryFile(listing, path.join(root, ".cursor", "rules", "style.mdc")), { satellite: "github.com/me/app", rel: ".cursor/rules/style.mdc" });
});

test("deepest satellite wins", () => {
  assert.equal(memoryFile(listing, path.join(root, "vendor", "lib", "CLAUDE.md"))?.satellite, "github.com/me/lib");
});

test("ordinary files and files outside satellites are ignored", () => {
  assert.equal(memoryFile(listing, path.join(root, "src", "main.py")), null);
  assert.equal(memoryFile(listing, path.join(root, "README.md")), null);
  assert.equal(memoryFile(listing, path.resolve("/elsewhere/CLAUDE.md")), null);
});

test("global satellite: only memories under its dotfile folders", () => {
  assert.deepEqual(memoryFile(listing, path.join(home, ".claude", "CLAUDE.md")), { satellite: "global", rel: ".claude/CLAUDE.md" });
  assert.equal(memoryFile(listing, path.join(home, "Desktop", "CLAUDE.md")), null);
});
