import * as assert from "node:assert/strict";
import { test } from "node:test";
import { installCommand, menuItems, nextStep, setupStatus } from "../setup";

test("each setup problem has its step", () => {
  assert.equal(nextStep("missing", 0), "install");
  assert.equal(nextStep("old", 3), "upgrade");
  assert.equal(nextStep("nostore", 0), "init");
});

test("a store with no projects asks to track; with projects, nothing", () => {
  assert.equal(nextStep(null, 0), "track");
  assert.equal(nextStep(null, 1), null);
});

test("other failures are not setup steps", () => {
  assert.equal(nextStep("other", 0), null);
});

test("status bar text and tooltip while setting up", () => {
  const s = setupStatus("init", "no store at /x - run `punk init` first");
  assert.equal(s.text, "$(tools) punk: set up");
  assert.match(s.tooltip, /^Create a store/);
  assert.match(s.tooltip, /no store at \/x/);
  assert.doesNotMatch(setupStatus("track", "").tooltip, /\n\n/);
});

test("install commands are fixed text", () => {
  assert.equal(installCommand("install"), "pipx install punk-records");
  assert.equal(installCommand("upgrade"), "pipx upgrade punk-records");
});

test("the actions menu offers Track while that step is pending", () => {
  const ids = (step: Parameters<typeof menuItems>[0]) => menuItems(step).map(([, command]) => command);
  assert.equal(ids("track")[0], "punkRecords.track");
  assert.ok(!ids(null).includes("punkRecords.track"));
  assert.ok(ids(null).includes("punkRecords.sync"));
  assert.deepEqual(ids("track").slice(1), ids(null));
});
