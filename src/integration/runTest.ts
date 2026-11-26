// Launches a downloaded VS Code with this extension and a throwaway punk store, then runs suite.ts inside it.
// PUNK_BIN: the punk command to use (default: `punk` on PATH).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  // Run from inside VS Code (a terminal, or a tool its extensions start), the editor's own variables
  // reach the downloaded VS Code: ELECTRON_RUN_AS_NODE starts it as plain Node, and with the rest
  // (VSCODE_IPC_HOOK, VSCODE_ESM_ENTRYPOINT, ...) the suite never starts. Drop them all.
  for (const k of Object.keys(process.env)) if (/^(VSCODE_|ELECTRON_)/.test(k)) delete process.env[k];
  const bin = process.env.PUNK_BIN || "punk";
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "punk-vscode-it-"))); // long path: Windows tmpdir can be 8.3 (RUNNER~1), punk reports it resolved
  // an empty file, not os.devNull: Git for Windows cannot read \\.\nul as a config file
  const emptyGitConfig = (dir: string) => { const f = path.join(dir, "gitconfig"); fs.writeFileSync(f, ""); return f; };
  const env = { ...process.env, HOME: path.join(tmp, "home"), GIT_CONFIG_GLOBAL: emptyGitConfig(tmp), GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const run = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, env, encoding: "utf8" });
  const store = path.join(tmp, "store");
  const app = path.join(tmp, "app");
  fs.mkdirSync(env.HOME);
  fs.mkdirSync(path.join(app, ".vscode"), { recursive: true });
  run("git", ["init", "-q"], app);
  run("git", ["remote", "add", "origin", "git@github.com:me/app.git"], app);
  fs.writeFileSync(path.join(app, "CLAUDE.md"), "- run tests with make test\n");
  run(bin, ["--home", store, "init", "--no-global", "--machine", "it"]);
  run(bin, ["--home", store, "track", app]);
  run(bin, ["--home", store, "save"]);
  fs.writeFileSync(path.join(app, "CLAUDE.md"), "- run tests with make test\n- unsaved edit\n");
  // The real executable and store come from user settings. The workspace names a program of its own,
  // which must never run (both settings are machine-scoped); the suite checks its marker file is absent.
  const userData = path.join(tmp, "user-data");
  fs.mkdirSync(path.join(userData, "User"), { recursive: true });
  fs.writeFileSync(path.join(userData, "User", "settings.json"),
    JSON.stringify({ "punkRecords.executable": bin, "punkRecords.home": store }));
  const hostile = path.join(tmp, "hostile.sh");
  fs.writeFileSync(hostile, `#!/bin/sh\ntouch "${path.join(tmp, "hostile-ran")}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(app, ".vscode", "settings.json"),
    JSON.stringify({ "punkRecords.executable": hostile, "punkRecords.home": path.join(tmp, "elsewhere"), "punkRecords.refreshSeconds": 0 }));
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "..", ".."),
    extensionTestsPath: path.resolve(__dirname, "suite"),
    launchArgs: [app, "--disable-extensions", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${userData}`],
    extensionTestsEnv: { ...env, PUNK_IT_HOSTILE_MARKER: path.join(tmp, "hostile-ran"), PUNK_IT_USER_EXECUTABLE: bin },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
