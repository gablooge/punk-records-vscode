// The messages are what punk 0.6.2 prints, captured from real runs.
import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "../punk";
import { afterSync, showBlock, syncProblem } from "../syncProblem";

const res = (code: number, stderr = "", stdout = ""): RunResult => ({ code, stdout, stderr });

const MERGE =
  "punk: could not merge origin main: both changed satellites/github.com/me/app.json\n" +
  "The store was left as it was. To merge by hand, run git in it (`punk git pull --rebase ...`), fix those files, " +
  "continue the rebase, then `punk sync`.\n";
const NOT_STORE =
  "punk: could not merge origin main: it is not a punk store (no punk.json or satellites/) and shares no history " +
  "with this one. The store was left as it was; check the remote with `punk git remote -v`.\n";
const AGE =
  "punk: encryption needs age on PATH: install age (https://age-encryption.org, e.g. `brew install age` or `apt install age`)\n";
const UNREACHABLE =
  "punk: git ls-remote --heads origin main failed:\nfatal: '/tmp/nope.git' does not appear to be a git repository\n" +
  "fatal: Could not read from remote repository.\n";

test("a store that cannot merge its remote is a lasting problem", () => {
  const p = syncProblem(res(2, MERGE))!;
  assert.equal(p.kind, "merge");
  assert.equal(p.text, "$(warning) punk: sync blocked");
  const lines = p.tooltip.split("\n");
  assert.match(lines[0], /both changed the same files/);
  assert.match(p.tooltip, /both changed satellites\/github.com\/me\/app.json/); // punk's own message, without "punk: "
  assert.doesNotMatch(p.tooltip, /^punk: /m);
});

test("a remote that is not a punk store", () => {
  const p = syncProblem(res(2, NOT_STORE))!;
  assert.equal(p.kind, "notstore");
  assert.equal(p.text, "$(warning) punk: wrong remote");
  assert.match(p.tooltip, /punk git remote -v/);
});

test("age missing for an encrypted store", () => {
  const p = syncProblem(res(2, AGE))!;
  assert.equal(p.kind, "age");
  assert.equal(p.text, "$(warning) punk: needs age");
  assert.match(p.tooltip, /brew install age/);
  assert.equal(syncProblem(res(2, AGE.replace("age on PATH", "age and age-keygen on PATH")))?.kind, "age");
});

test("an unreachable remote, other errors and other exit codes are not lasting", () => {
  assert.equal(syncProblem(res(2, UNREACHABLE)), null);
  assert.equal(syncProblem(res(2, "punk: could not merge origin main: some git error\n")), null);
  assert.equal(syncProblem(res(1, MERGE)), null); // only exit 2 is a punk error
  assert.equal(syncProblem(res(0)), null);
});

test("afterSync: cleared when the exchange worked, kept when a sync could not tell", () => {
  const blocked = syncProblem(res(2, MERGE));
  assert.equal(afterSync(blocked, res(0, "", "in sync\n")), null);
  assert.equal(afterSync(blocked, res(1, "1 file(s) need attention")), null); // file conflicts: the remote merged
  const kept = afterSync(blocked, res(2, UNREACHABLE)); // the remote was not reached: still blocked
  assert.deepEqual([kept?.kind, kept?.text], [blocked?.kind, blocked?.text]);
  assert.equal(afterSync(blocked, res(2, AGE))?.kind, "age"); // a new lasting problem replaces it
  assert.equal(afterSync(null, res(2, UNREACHABLE)), null);
});

test("afterSync: a run that was killed or timed out keeps the block (its exit code is not punk's)", () => {
  const blocked = syncProblem(res(2, MERGE));
  assert.equal(afterSync(blocked, { ...res(1), killed: true }), blocked);
  assert.equal(afterSync(null, { ...res(1), killed: true }), null);
});

test("afterSync: another error after a block keeps the block and shows the newer error too", () => {
  const blocked = syncProblem(res(2, MERGE))!;
  const push = "punk: git push -q -u origin main failed:\n! [remote rejected] main -> main (pre-receive hook declined)\n";
  const kept = afterSync(blocked, res(2, push))!;
  assert.equal(kept.kind, "merge");
  assert.equal(kept.text, blocked.text);
  assert.match(kept.tooltip, /both changed satellites/); // the block's own message
  assert.match(kept.tooltip, /The last sync failed with another error:\ngit push -q -u origin main failed:/);
  const again = afterSync(kept, res(2, push))!; // not repeated on every failed sync
  assert.equal(again.tooltip.split("The last sync failed").length, 2);
});

test("showBlock: a block wins over the track step, not over install, upgrade or init", () => {
  const blocked = syncProblem(res(2, AGE))!;
  assert.equal(showBlock(null, blocked), blocked);
  assert.equal(showBlock("track", blocked), blocked);
  for (const step of ["install", "upgrade", "init"] as const) assert.equal(showBlock(step, blocked), null);
  assert.equal(showBlock(null, null), null);
});
