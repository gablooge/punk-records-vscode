// Runs the real punk CLI in a throwaway store. PUNK_BIN points at it (default: `punk` on PATH);
// the tests skip when no punk with --json support (0.4.0+) is available.
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { before, test } from "node:test";
import { Punk, PunkError } from "../punk";
import { syncProblem } from "../syncProblem";

const bin = process.env.PUNK_BIN || "punk";
let available = false;
try {
  available = execFileSync(bin, ["status", "--help"], { encoding: "utf8" }).includes("--json");
} catch {
  available = false;
}
const skip = available ? false : `no punk with --json at '${bin}' (set PUNK_BIN)`;

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "punk-vscode-"))); // long path: Windows tmpdir can be 8.3 (RUNNER~1), punk reports it resolved
// an empty file, not os.devNull: Git for Windows cannot read \\.\nul as a config file
const emptyGitConfig = (dir: string) => { const f = path.join(dir, "gitconfig"); fs.writeFileSync(f, ""); return f; };
const env = {
  ...process.env, HOME: path.join(tmp, "home"), GIT_CONFIG_GLOBAL: emptyGitConfig(tmp), GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};
const store = path.join(tmp, "store");
const app = path.join(tmp, "app");
const sh = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, env, encoding: "utf8" });

before(() => {
  if (!available) return;
  Object.assign(process.env, env); // the Punk class inherits process.env
  fs.mkdirSync(path.join(tmp, "home"));
  fs.mkdirSync(app);
  sh("git", ["init", "-q"], app);
  sh("git", ["remote", "add", "origin", "git@github.com:me/app.git"], app);
  fs.writeFileSync(path.join(app, "CLAUDE.md"), "v1\n");
  sh(bin, ["--home", store, "init", "--no-global", "--machine", "test"]);
  sh(bin, ["--home", store, "track", app]);
  sh(bin, ["--home", store, "save"]);
});

test("status and list", { skip }, async () => {
  const punk = new Punk(bin, store);
  let s = await punk.status();
  assert.deepEqual([s.save, s.restore, s.remote], [[], [], null]);
  fs.writeFileSync(path.join(app, "CLAUDE.md"), "v2\n");
  s = await punk.status();
  assert.deepEqual(s.save.map((x) => [x.kind, x.satellite, x.path]), [["update", "github.com/me/app", "CLAUDE.md"]]);
  const l = await punk.list();
  assert.deepEqual(l.satellites.map((x) => [x.id, x.memories]), [["github.com/me/app", ["CLAUDE.md"]]]);
  assert.equal(fs.realpathSync(l.satellites[0].local_path!), fs.realpathSync(app));
});

test("show reads store copies, also from a team subscription", { skip }, async () => {
  const punk = new Punk(bin, store);
  assert.equal(await punk.show("github.com/me/app", "CLAUDE.md"), "v1\n");
  const team = path.join(tmp, "team");
  sh(bin, ["--home", team, "init", "--no-global", "--machine", "team"]);
  fs.mkdirSync(path.join(team, "records", "global"), { recursive: true });
  fs.writeFileSync(path.join(team, "records", "global", "CLAUDE.md"), "- team rule\n");
  sh("git", ["add", "-A"], team);
  sh("git", ["commit", "-qm", "team"], team);
  sh(bin, ["--home", store, "subscribe", "acme", team]);
  assert.equal(await punk.show("@acme/global", "CLAUDE.md"), "- team rule\n");
  const l = await punk.list();
  assert.deepEqual(l.subscriptions.map((x) => [x.name, x.satellites.map((s) => s.id)]), [["acme", ["global"]]]);
  await assert.rejects(punk.show("github.com/me/app", "nope.md"), PunkError);
});

test("a store that does not exist is a readable error", { skip }, async () => {
  await assert.rejects(new Punk(bin, path.join(tmp, "missing")).status(),
    (e: PunkError) => /run `punk init` first/.test(e.message) && e.problem === "nostore");
});

test("a missing punk executable is a readable error", async () => {
  await assert.rejects(new Punk(path.join(tmp, "no-such-punk")).status(),
    (e: PunkError) => /pipx install punk-records/.test(e.message) && e.problem === "missing");
});

test("an unknown JSON version is refused, not misread", { skip: process.platform === "win32" ? "uses a POSIX shell script" : false }, async () => {
  const fake = path.join(tmp, "fake-punk");
  fs.writeFileSync(fake, '#!/bin/sh\necho \'{"version": 2, "save": [], "restore": [], "remote": null}\'\n', { mode: 0o755 });
  await assert.rejects(new Punk(fake).status(), (e: PunkError) => /version 2 is not supported/.test(e.message) && e.problem === "other");
  fs.writeFileSync(fake, "#!/bin/sh\necho 'local changes: none'\n", { mode: 0o755 });
  await assert.rejects(new Punk(fake).status(), (e: PunkError) => /did not return JSON; punk 0.4.0 or newer/.test(e.message) && e.problem === "old");
});

test("a punk without --json says to upgrade", { skip: process.platform === "win32" ? "uses a POSIX shell script" : false }, async () => {
  // what punk 0.3.1 and older print (argparse), exit code 2
  const fake = path.join(tmp, "old-punk");
  fs.writeFileSync(fake, "#!/bin/sh\necho 'usage: punk [-h] [--home HOME] [--version] command ...' >&2\n" +
    "echo 'punk: error: unrecognized arguments: --json' >&2\nexit 2\n", { mode: 0o755 });
  await assert.rejects(new Punk(fake).status(), (e: PunkError) =>
    /punk 0\.4\.0 or newer is needed/.test(e.message) && /pipx upgrade punk-records/.test(e.message) && !/usage:/.test(e.message) &&
    e.problem === "old");
});

test("a run that times out is marked killed, not read as punk's exit 1", { skip: process.platform === "win32" && "uses a POSIX shell script" }, async () => {
  const slow = path.join(tmp, "slow-punk.sh");
  fs.writeFileSync(slow, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  const r = await new Punk(slow, undefined, 300).run(["sync"]);
  assert.equal(r.killed, true);
  const ok = await new Punk(bin, store).run(["status"]);
  assert.equal(ok.killed, false);
});

// What `punk sync` prints for a problem that stays until a person acts, read by syncProblem().
// Each needs the punk that first printed it; older punk skips.
const punkVersion = (() => {
  try {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(execFileSync(bin, ["--version"], { encoding: "utf8" }));
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  } catch {
    return [0, 0, 0];
  }
})();
const needs = (v: [number, number, number]) => {
  if (!available) return skip;
  const older = punkVersion[0] - v[0] || punkVersion[1] - v[1] || punkVersion[2] - v[2];
  return older < 0 ? `needs punk ${v.join(".")} or newer (found ${punkVersion.join(".")})` : false;
};
let ageOnPath = true;
try {
  execFileSync("age", ["--version"], { stdio: "ignore" });
} catch (e) {
  ageOnPath = (e as NodeJS.ErrnoException).code !== "ENOENT";
}

test("sync: a store that cannot merge its remote", { skip: needs([0, 6, 1]) }, async () => {
  const remote = path.join(tmp, "merge-remote.git");
  sh("git", ["init", "-q", "--bare", remote]);
  const a = path.join(tmp, "merge-a");
  const b = path.join(tmp, "merge-b");
  sh("git", ["clone", "-q", store, a]); // a copy of the test store, so both share its history
  sh("git", ["remote", "set-url", "origin", remote], a);
  sh("git", ["push", "-q", "origin", "HEAD:main"], a);
  sh(bin, ["--home", b, "init", "--no-global", "--machine", "b", remote]);
  const sat = path.join("satellites", "github.com", "me", "app.json");
  for (const [dir, name] of [[a, "from-a"], [b, "from-b"]]) {
    const f = path.join(dir, sat);
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), name }));
    sh("git", ["commit", "-qam", name], dir);
  }
  sh("git", ["push", "-q", "origin", "HEAD:main"], a);
  const r = await new Punk(bin, b).run(["sync"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(syncProblem(r)?.kind, "merge", r.stderr);
});

test("sync: a remote that is not a punk store", { skip: needs([0, 6, 2]) }, async () => {
  const other = path.join(tmp, "other.git");
  const work = path.join(tmp, "other-work");
  sh("git", ["init", "-q", "--bare", other]);
  fs.mkdirSync(work);
  sh("git", ["init", "-q"], work);
  fs.writeFileSync(path.join(work, "README.md"), "not a store\n");
  sh("git", ["add", "-A"], work);
  sh("git", ["commit", "-qm", "x"], work);
  sh("git", ["push", "-q", other, "HEAD:main"], work);
  const s = path.join(tmp, "store-wrong-remote");
  sh(bin, ["--home", s, "init", "--no-global", "--machine", "w"]);
  sh("git", ["remote", "add", "origin", other], s);
  const r = await new Punk(bin, s).run(["sync"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(syncProblem(r)?.kind, "notstore", r.stderr);
});

test("sync: an encrypted store without age", { skip: needs([0, 6, 1]) || (ageOnPath && "age is on PATH") }, async () => {
  const s = path.join(tmp, "store-encrypted");
  sh(bin, ["--home", s, "init", "--no-global", "--machine", "e"]);
  sh("git", ["init", "-q", "--bare", path.join(s, ".git", "punk-crypt")]); // what punk checks to call a store encrypted
  const r = await new Punk(bin, s).run(["sync"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(syncProblem(r)?.kind, "age", r.stderr);
});
