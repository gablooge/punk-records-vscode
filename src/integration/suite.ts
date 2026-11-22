// Runs inside VS Code (extension host). Exported `run` is what @vscode/test-electron calls.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as vscode from "vscode";
import type { TestApi } from "../extension";

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<TestApi>("gablooge.punk-records");
  assert.ok(ext, "extension not found");
  const api = await ext.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const c of ["save", "sync", "restore", "diff", "dedupe", "refresh", "menu", "open", "showOutput"]) {
    assert.ok(commands.includes(`punkRecords.${c}`), `command punkRecords.${c} missing`);
  }
  await api.refresh();
  let snap = api.snapshot();
  console.log("status bar:", snap.text, "| satellites:", snap.satellites.join(", "));
  assert.equal(snap.text, "$(cloud-upload) punk: 1 to save");
  assert.deepEqual(snap.satellites, ["github.com/me/app"]);
  await vscode.commands.executeCommand("punkRecords.save");
  snap = api.snapshot();
  console.log("after save:", snap.text);
  assert.equal(snap.text, "$(check) punk");

  // Compare with store opens a side-by-side diff whose left side is the store copy.
  const folder = vscode.workspace.workspaceFolders![0].uri;
  const file = vscode.Uri.joinPath(folder, "CLAUDE.md");
  await vscode.commands.executeCommand("punkRecords.diff", {
    type: "memory", satellite: "github.com/me/app", rel: "CLAUDE.md", localFile: file.fsPath, team: false,
  });
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputTextDiff, "no diff editor opened");
  assert.equal(input.original.scheme, "punk-records");
  const store = await vscode.workspace.openTextDocument(input.original);
  assert.equal(store.getText(), "- run tests with make test\n- unsaved edit\n");
  console.log("diff opened:", input.original.toString(), "<->", input.modified.fsPath.split("/").pop());

  // The workspace's own punkRecords.executable and punkRecords.home were ignored (machine scope).
  const wsSettings = fs.readFileSync(vscode.Uri.joinPath(folder, ".vscode", "settings.json").fsPath, "utf8");
  assert.match(wsSettings, /hostile\.sh/, "the workspace should name its own executable, to show it is ignored");
  const effective = vscode.workspace.getConfiguration("punkRecords").get<string>("executable");
  assert.equal(effective, process.env.PUNK_IT_USER_EXECUTABLE, "the executable did not come from user settings");
  const marker = process.env.PUNK_IT_HOSTILE_MARKER!;
  assert.equal(fs.existsSync(marker), false, `the workspace's executable ran (${marker} exists)`);
  console.log("workspace executable ignored; effective:", effective);

  // Setup states: no store, then no punk at all; back to normal once the settings are restored.
  const cfg = vscode.workspace.getConfiguration("punkRecords");
  const home = cfg.get<string>("home");
  await cfg.update("home", home + "-missing", vscode.ConfigurationTarget.Global);
  await api.refresh();
  snap = api.snapshot();
  console.log("no store:", snap.text, "| setup:", snap.setup);
  assert.equal(snap.setup, "init");
  assert.equal(snap.text, "$(tools) punk: set up");
  await cfg.update("executable", effective + "-missing", vscode.ConfigurationTarget.Global);
  await api.refresh();
  snap = api.snapshot();
  console.log("no punk:", snap.text, "| setup:", snap.setup);
  assert.equal(snap.setup, "install");
  await cfg.update("executable", effective, vscode.ConfigurationTarget.Global);
  await cfg.update("home", home, vscode.ConfigurationTarget.Global);
  await api.refresh();
  snap = api.snapshot();
  console.log("restored:", snap.text, "| setup:", snap.setup);
  assert.equal(snap.setup, null);
  assert.equal(snap.text, "$(check) punk");
}
