// Runs inside VS Code (extension host). Exported `run` is what @vscode/test-electron calls.
import * as assert from "node:assert/strict";
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
}
