// Runs the real punk CLI in a throwaway store. PUNK_BIN points at it (default: `punk` on PATH);
// the tests skip when no punk with --json support (0.4.0+) is available.
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { before, test } from "node:test";
import { Punk, PunkError } from "../punk";

const bin = process.env.PUNK_BIN || "punk";
let available = false;
try {
  available = execFileSync(bin, ["status", "--help"], { encoding: "utf8" }).includes("--json");
} catch {
  available = false;
}
const skip = available ? false : `no punk with --json at '${bin}' (set PUNK_BIN)`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "punk-vscode-"));
const env = {
  ...process.env, HOME: path.join(tmp, "home"), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
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
  await assert.rejects(new Punk(bin, path.join(tmp, "missing")).status(), /run `punk init` first/);
});

test("a missing punk executable is a readable error", async () => {
  await assert.rejects(new Punk(path.join(tmp, "no-such-punk")).status(), /pipx install punk-records/);
});

test("an unknown JSON version is refused, not misread", { skip: process.platform === "win32" ? "uses a POSIX shell script" : false }, async () => {
  const fake = path.join(tmp, "fake-punk");
  fs.writeFileSync(fake, '#!/bin/sh\necho \'{"version": 2, "save": [], "restore": [], "remote": null}\'\n', { mode: 0o755 });
  await assert.rejects(new Punk(fake).status(), /version 2 is not supported/);
  fs.writeFileSync(fake, "#!/bin/sh\necho 'local changes: none'\n", { mode: 0o755 });
  await assert.rejects(new Punk(fake).status(), /did not return JSON; punk 0.4.0 or newer/);
});
