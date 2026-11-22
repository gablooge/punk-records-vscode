// Records the README screenshots and demo GIF: `npm run demo` (needs punk 0.4.0+ and ffmpeg).
// PUNK_BIN: the punk command to use (default: `punk` on PATH).
//
// Everything runs in a throwaway HOME, store and VS Code profile under /tmp/punk-demo (deleted
// first), so none of your real memories, paths, settings or extensions appear in the pictures.
// scenario.ts drives the extension inside VS Code and captures the window over the Chrome DevTools
// protocol; ffmpeg turns the frames into docs/demo.gif.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

const ROOT = "/tmp/punk-demo";
const PORT = 9339;

async function main(): Promise<void> {
  for (const k of ["ELECTRON_RUN_AS_NODE", "VSCODE_IPC_HOOK_CLI", "VSCODE_PID"]) delete process.env[k];
  const bin = process.env.PUNK_BIN || "punk";
  const repo = path.resolve(__dirname, "..", "..");
  const docs = path.join(repo, "docs");
  fs.rmSync(ROOT, { recursive: true, force: true });
  const home = path.join(ROOT, "home");
  const store = path.join(home, ".punk-records");
  const team = path.join(ROOT, "acme-store");
  const frames = path.join(ROOT, "frames");
  for (const d of [home, frames, path.join(home, ".claude")]) fs.mkdirSync(d, { recursive: true });
  const gitconfig = path.join(ROOT, "gitconfig");
  fs.writeFileSync(gitconfig, "");
  const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "you", GIT_AUTHOR_EMAIL: "you@example.com", GIT_COMMITTER_NAME: "you", GIT_COMMITTER_EMAIL: "you@example.com" };
  const run = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, env, encoding: "utf8" });
  const project = (dir: string, remote: string, files: Record<string, string>) => {
    fs.mkdirSync(dir, { recursive: true });
    run("git", ["init", "-q"], dir);
    run("git", ["remote", "add", "origin", remote], dir);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
  };

  const app = path.join(home, "code", "app");
  project(app, "git@github.com:you/app.git", {
    "CLAUDE.md": "# App\n\n- Run tests with `make test`; they need Docker running.\n- API handlers live in `src/api/`, one file per resource.\n- Never commit `.env`; copy `.env.example` instead.\n",
    "AGENTS.md": "# Agents\n\nRead CLAUDE.md first. Format with `make fmt` before every commit.\n",
  });
  project(path.join(home, "code", "api"), "git@github.com:you/api.git", {
    "CLAUDE.md": "# API\n\n- Migrations go in `db/migrations/`, never edit an applied one.\n",
  });
  fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "# Me\n\n- Prefer small pull requests.\n- Ask before adding a dependency.\n");
  const handbook = path.join(ROOT, "acme-handbook");
  project(handbook, "git@github.com:acme/handbook.git", {
    "CLAUDE.md": "# Acme handbook\n\n- Every service exposes `/healthz`.\n- Releases go out on Tuesdays.\n",
  });

  run(bin, ["--home", team, "init", "--no-global", "--machine", "acme"]);
  run(bin, ["--home", team, "track", handbook]);
  run(bin, ["--home", team, "save"]);
  run(bin, ["--home", store, "init", "--machine", "laptop"]);
  run(bin, ["--home", store, "track", app]);
  run(bin, ["--home", store, "track", path.join(home, "code", "api")]);
  run(bin, ["--home", store, "save"]);
  run(bin, ["--home", store, "subscribe", "acme", team]);

  const userData = path.join(ROOT, "user-data");
  fs.mkdirSync(path.join(userData, "User"), { recursive: true });
  fs.writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify({
    "punkRecords.executable": bin,
    "punkRecords.home": store,
    "punkRecords.refreshSeconds": 0,
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.layoutControl.enabled": false,
    "workbench.editor.enablePreview": false,
    "chat.disableAIFeatures": true,
    "window.title": "${rootName}",
    "window.commandCenter": false,
    "editor.minimap.enabled": false,
    "editor.fontSize": 14,
    "git.enabled": false,
    "update.mode": "none",
    "telemetry.telemetryLevel": "off",
    "extensions.ignoreRecommendations": true,
    "security.workspace.trust.enabled": false,
  }, null, 2));

  await runTests({
    extensionDevelopmentPath: repo,
    extensionTestsPath: path.resolve(__dirname, "scenario"),
    launchArgs: [app, "--disable-extensions", "--skip-welcome", "--skip-release-notes",
      `--user-data-dir=${userData}`, `--extensions-dir=${path.join(ROOT, "extensions")}`, `--remote-debugging-port=${PORT}`],
    extensionTestsEnv: { ...env, PUNK_DEMO_PORT: String(PORT), PUNK_DEMO_FRAMES: frames, PUNK_DEMO_DOCS: docs },
  });

  // frames/index.json: [{file, ms}] where ms is how long each frame stays on screen
  const list: { file: string; ms: number }[] = JSON.parse(fs.readFileSync(path.join(frames, "index.json"), "utf8"));
  const concat = list.map((f) => `file '${path.join(frames, f.file)}'\nduration ${(f.ms / 1000).toFixed(3)}`).join("\n")
    + `\nfile '${path.join(frames, list[list.length - 1].file)}'\n`;
  fs.writeFileSync(path.join(frames, "list.txt"), concat);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(frames, "list.txt"),
    "-vf", "fps=10,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop", "0", path.join(docs, "demo.gif")], { stdio: "inherit" });
  console.log(`wrote ${path.join(docs, "demo.gif")} from ${list.length} frames`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
