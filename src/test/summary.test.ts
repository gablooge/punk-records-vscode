import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Action, Status } from "../punk";
import { summarize } from "../summary";

const a = (kind: string, path = "CLAUDE.md", note = ""): Action => ({ kind, satellite: "github.com/me/app", path, note });
const status = (save: Action[] = [], restore: Action[] = [], remote: Status["remote"] = null): Status => ({
  version: 1, save, restore, remote,
});

test("clean", () => {
  const s = summarize(status([], [], { kind: "git", url: "git@github.com:me/brain.git" }));
  assert.equal(s.state, "clean");
  assert.equal(s.text, "$(check) punk");
  assert.match(s.tooltip, /git remote: git@github.com:me\/brain.git/);
});

test("conflicts win over everything and are listed", () => {
  const s = summarize(status([a("update"), a("conflict", "AGENTS.md", "changed here and in the store")], [a("blocked", "napkin.md")]));
  assert.equal(s.state, "conflict");
  assert.equal(s.text, "$(warning) punk: 2 conflicts");
  assert.deepEqual(s.conflicts.map((x) => x.path), ["AGENTS.md", "napkin.md"]);
  assert.match(s.tooltip, /conflict github.com\/me\/app\/AGENTS.md \(changed here and in the store\)/);
});

test("unsaved before incoming; skipped and stale do not count", () => {
  assert.equal(summarize(status([a("add"), a("skipped")], [a("update")])).text, "$(cloud-upload) punk: 1 to save");
  assert.equal(summarize(status([a("skipped")], [a("update"), a("stale")])).text, "$(cloud-download) punk: 1 to restore");
  assert.equal(summarize(status([a("skipped")], [a("stale")])).state, "clean");
  assert.equal(summarize(status([a("conflict")])).text, "$(warning) punk: 1 conflict");
});
