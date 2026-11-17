// Launches a downloaded VS Code with this extension and a throwaway punk store, then runs suite.ts inside it.
// PUNK_BIN: the punk command to use (default: `punk` on PATH).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  // Run from a VS Code terminal, these make the downloaded VS Code start as plain Node instead.
  for (const k of ["ELECTRON_RUN_AS_NODE", "VSCODE_IPC_HOOK_CLI", "VSCODE_PID"]) delete process.env[k];
  const bin = process.env.PUNK_BIN || "punk";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "punk-vscode-it-"));
  const env = { ...process.env, HOME: path.join(tmp, "home"), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
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
  fs.writeFileSync(path.join(app, ".vscode", "settings.json"),
    JSON.stringify({ "punkRecords.executable": bin, "punkRecords.home": store, "punkRecords.refreshSeconds": 0 }));
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, "..", ".."),
    extensionTestsPath: path.resolve(__dirname, "suite"),
    launchArgs: [app, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
    extensionTestsEnv: env,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
