import * as vscode from "vscode";
import { memoryFile } from "./memories";
import { Punk, PunkError, type Listing } from "./punk";
import { StoreDocuments, SCHEME, storeUri } from "./storeDocs";
import { summarize } from "./summary";
import { MemoriesTree, type Node } from "./tree";

let punk: Punk;
let listing: Listing | null = null;
let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let tree: MemoriesTree;
let refreshing: Promise<void> | null = null;
const pendingSaves = new Map<string, NodeJS.Timeout>();

function config() {
  const c = vscode.workspace.getConfiguration("punkRecords");
  return {
    executable: c.get<string>("executable") || "punk",
    home: c.get<string>("home") || undefined,
    saveOnFileSave: c.get<boolean>("saveOnFileSave") ?? false,
    refreshSeconds: c.get<number>("refreshSeconds") ?? 60,
  };
}

function configure(): void {
  const c = config();
  punk = new Punk(c.executable, c.home);
  if (timer) clearInterval(timer);
  timer = c.refreshSeconds > 0 ? setInterval(() => void refresh(), c.refreshSeconds * 1000) : undefined;
}

async function refresh(): Promise<void> {
  if (refreshing) return refreshing; // one refresh at a time
  refreshing = (async () => {
    try {
      const [status, list] = await Promise.all([punk.status(), punk.list()]);
      listing = list;
      tree.update(list);
      const s = summarize(status);
      statusItem.text = s.text;
      statusItem.tooltip = s.tooltip;
      statusItem.backgroundColor =
        s.state === "conflict" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    } catch (e) {
      const msg = (e as Error).message;
      listing = null;
      tree.update(null, msg);
      statusItem.text = "$(circle-slash) punk";
      statusItem.tooltip = msg;
      statusItem.backgroundColor = undefined;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Run a punk command with a progress notification; show output and problems. */
async function runPunk(title: string, args: string[]): Promise<number> {
  const r = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Punk Records: ${title}` },
    () => punk.run(args),
  );
  output.appendLine(`$ punk ${args.join(" ")}`);
  if (r.stdout) output.append(r.stdout);
  if (r.stderr) output.append(r.stderr);
  output.appendLine(`(exit ${r.code})`);
  if (r.code === 0) {
    const first = r.stdout.trim().split("\n")[0];
    vscode.window.setStatusBarMessage(`$(check) punk ${args[0]}: ${first || "done"}`, 4000);
  } else {
    const msg = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ") || `exit ${r.code}`;
    const pick = await vscode.window.showWarningMessage(`punk ${args[0]}: ${msg}`, "Show output");
    if (pick) output.show(true);
  }
  await refresh();
  return r.code;
}

async function pickMemory(prompt: string, onlyLocal: boolean): Promise<{ satellite: string; rel: string; file?: string } | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor && listing && editor.document.uri.scheme === "file") {
    const hit = memoryFile(listing, editor.document.uri.fsPath);
    if (hit) return { ...hit, file: editor.document.uri.fsPath };
  }
  if (!listing) await refresh();
  const items = (listing?.satellites ?? []).flatMap((s) =>
    s.memories
      .filter(() => !onlyLocal || s.local_path)
      .map((rel) => ({ label: rel, description: s.id, satellite: s.id, rel, base: s.local_path })),
  );
  const chosen = await vscode.window.showQuickPick(items, { placeHolder: prompt, matchOnDescription: true });
  if (!chosen) return undefined;
  return { satellite: chosen.satellite, rel: chosen.rel, file: chosen.base ? vscode.Uri.joinPath(vscode.Uri.file(chosen.base), chosen.rel).fsPath : undefined };
}

async function diff(node?: Node): Promise<void> {
  let target: { satellite: string; rel: string; file?: string } | undefined;
  if (node && node.type === "memory") target = { satellite: node.satellite, rel: node.rel, file: node.localFile ?? undefined };
  else target = await pickMemory("Compare which memory with its store copy?", true);
  if (!target) return;
  if (!target.file) {
    vscode.window.showInformationMessage(`${target.rel} has no local copy on this machine.`);
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    storeUri(target.satellite, target.rel),
    vscode.Uri.file(target.file),
    `${target.rel} (store ↔ local)`,
  );
}

async function dedupe(): Promise<void> {
  const r = await punk.run(["dedupe"]);
  if (r.code === 0) {
    vscode.window.showInformationMessage("Punk Records: no duplicate lines.");
    return;
  }
  if (r.code !== 1) {
    vscode.window.showWarningMessage(`punk dedupe: ${(r.stderr || r.stdout).trim()}`);
    return;
  }
  output.appendLine("$ punk dedupe");
  output.append(r.stdout);
  output.show(true);
  const summary = r.stdout.trim().split("\n").pop() ?? "";
  const ok = await vscode.window.showWarningMessage(
    `Punk Records: ${summary.split(";")[0]}. Remove them (the first copy of each line is kept)?`,
    { modal: true },
    "Remove",
  );
  if (ok === "Remove") await runPunk("removing duplicate lines", ["dedupe", "--apply"]);
}

async function open(node: Node): Promise<void> {
  if (node.type !== "memory") return;
  const uri = node.localFile ? vscode.Uri.file(node.localFile) : storeUri(node.satellite, node.rel);
  await vscode.window.showTextDocument(uri, { preview: true });
}

async function menu(): Promise<void> {
  const actions: [string, string][] = [
    ["$(cloud-upload) Save memories", "punkRecords.save"],
    ["$(sync) Sync", "punkRecords.sync"],
    ["$(cloud-download) Restore memories", "punkRecords.restore"],
    ["$(diff) Compare with store", "punkRecords.diff"],
    ["$(filter) Remove duplicate lines", "punkRecords.dedupe"],
    ["$(output) Show output", "punkRecords.showOutput"],
  ];
  const pick = await vscode.window.showQuickPick(actions.map(([label, command]) => ({ label, command })), {
    placeHolder: statusItem.tooltip?.toString().split("\n")[0],
  });
  if (pick) await vscode.commands.executeCommand(pick.command);
}

function onSave(doc: vscode.TextDocument): void {
  if (!config().saveOnFileSave || doc.uri.scheme !== "file" || !listing) return;
  const hit = memoryFile(listing, doc.uri.fsPath);
  if (!hit) return;
  clearTimeout(pendingSaves.get(hit.satellite));
  pendingSaves.set(
    hit.satellite,
    setTimeout(async () => {
      pendingSaves.delete(hit.satellite);
      const r = await punk.run(["save", hit.satellite]);
      output.appendLine(`$ punk save ${hit.satellite}  (on file save)`);
      output.append(r.stdout + r.stderr);
      if (r.code !== 0) {
        const pick = await vscode.window.showWarningMessage(`punk save ${hit.satellite}: needs attention`, "Show output");
        if (pick) output.show(true);
      }
      await refresh();
    }, 1500),
  );
}

/** Returned from activate() so the integration test can see what the user would see. */
export interface TestApi {
  refresh(): Promise<void>;
  snapshot(): { text: string; tooltip: string; satellites: string[]; subscriptions: string[] };
}

export function activate(context: vscode.ExtensionContext): TestApi {
  output = vscode.window.createOutputChannel("Punk Records");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = "punkRecords.menu";
  statusItem.text = "$(sync~spin) punk";
  statusItem.show();
  tree = new MemoriesTree();
  configure();
  const store = new StoreDocuments(() => punk);

  const reg = (id: string, fn: (...a: any[]) => unknown) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(
    output,
    statusItem,
    vscode.window.registerTreeDataProvider("punkRecords.memories", tree),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, store),
    reg("punkRecords.save", () => runPunk("saving", ["save"])),
    reg("punkRecords.sync", () => runPunk("syncing", ["sync"])),
    reg("punkRecords.restore", () => runPunk("restoring", ["restore"])),
    reg("punkRecords.diff", (node?: Node) => diff(node)),
    reg("punkRecords.dedupe", () => dedupe()),
    reg("punkRecords.refresh", () => refresh()),
    reg("punkRecords.menu", () => menu()),
    reg("punkRecords.open", (node: Node) => open(node)),
    reg("punkRecords.showOutput", () => output.show(true)),
    vscode.workspace.onDidSaveTextDocument(onSave),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("punkRecords")) {
        configure();
        void refresh();
      }
    }),
    { dispose: () => timer && clearInterval(timer) },
  );
  void refresh().catch((e) => output.appendLine(`refresh failed: ${(e as PunkError).message}`));
  return {
    refresh,
    snapshot: () => ({
      text: statusItem.text,
      tooltip: String(statusItem.tooltip ?? ""),
      satellites: (listing?.satellites ?? []).map((s) => s.id),
      subscriptions: (listing?.subscriptions ?? []).map((s) => s.name),
    }),
  };
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
  for (const t of pendingSaves.values()) clearTimeout(t);
}
