import * as fs from "node:fs";
import * as vscode from "vscode";
import { memoryFile } from "./memories";
import { Punk, PunkError, type Listing } from "./punk";
import { installCommand, nextStep, setupStatus, type Step } from "./setup";
import { StoreDocuments, SCHEME, storeUri } from "./storeDocs";
import { summarize } from "./summary";
import { afterSync, syncProblem, type SyncProblem } from "./syncProblem";
import { MemoriesTree, type Node } from "./tree";

let punk: Punk;
let listing: Listing | null = null;
let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let tree: MemoriesTree;
let refreshing: Promise<void> | null = null;
let queued: Promise<void> | null = null;
let step: Step | null = null;
let terminal: vscode.Terminal | undefined;
/** A lasting problem from the last `punk sync` (cannot merge the remote, age missing); null after one succeeds. */
let syncBlock: SyncProblem | null = null;
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
  if (punk && (punk.executable !== c.executable || punk.home !== c.home)) syncBlock = null; // about another store
  punk = new Punk(c.executable, c.home);
  if (timer) clearInterval(timer);
  timer = c.refreshSeconds > 0 ? setInterval(() => void refresh(), c.refreshSeconds * 1000) : undefined;
}

/**
 * One refresh at a time. A call during a running refresh queues one more run after it (shared by
 * every call in the meantime), so the result always reflects settings changed since that run began.
 */
function refresh(): Promise<void> {
  if (refreshing) {
    queued ??= refreshing.then(() => {
      queued = null;
      return refresh();
    });
    return queued;
  }
  refreshing = (async () => {
    try {
      const [status, list] = await Promise.all([punk.status(), punk.list()]);
      listing = list;
      tree.update(list, null, untrackedFolders(list));
      setStep(nextStep(null, list.satellites.filter((s) => s.kind !== "global").length));
      const s = step ? setupStatus(step, "") : summarize(status);
      const blocked = !step && syncBlock;
      statusItem.text = blocked ? blocked.text : s.text;
      statusItem.tooltip = blocked ? `${blocked.tooltip}\n\n${s.tooltip}` : s.tooltip;
      statusItem.backgroundColor =
        blocked || (!step && summarize(status).state === "conflict")
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
    } catch (e) {
      const msg = (e as Error).message;
      listing = null;
      const problem = e instanceof PunkError ? e.problem : "other";
      setStep(nextStep(problem, 0));
      if (step) {
        tree.setup();
        const s = setupStatus(step, msg);
        statusItem.text = s.text;
        statusItem.tooltip = s.tooltip;
      } else {
        tree.update(null, msg);
        statusItem.text = "$(circle-slash) punk";
        statusItem.tooltip = msg;
      }
      statusItem.backgroundColor = undefined;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function setStep(next: Step | null): void {
  step = next;
  statusItem.command = step ? "punkRecords.setup" : "punkRecords.menu";
  void vscode.commands.executeCommand("setContext", "punkRecords.setup", step ?? "");
}

function real(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** Workspace folders punk does not track yet. */
function untrackedFolders(list: Listing): { folder: string; name: string }[] {
  const tracked = new Set(list.satellites.map((s) => s.local_path).filter((p): p is string => !!p).map(real));
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((f) => f.uri.scheme === "file" && !tracked.has(real(f.uri.fsPath)))
    .map((f) => ({ folder: f.uri.fsPath, name: f.name }));
}

/** Install or upgrade punk in a terminal the user can see; the command text is fixed. */
async function installPunk(kind: "install" | "upgrade"): Promise<void> {
  if (!terminal || terminal.exitStatus !== undefined) terminal = vscode.window.createTerminal({ name: "Punk Records" });
  terminal.show();
  terminal.sendText(installCommand(kind));
  const pick = await vscode.window.showInformationMessage(
    `Punk Records: running \`${installCommand(kind)}\` in the terminal. Needs pipx (https://pipx.pypa.io). Refresh when it has finished.`,
    "Refresh",
  );
  if (pick) await refresh();
}

async function initStore(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "$(add) Create a new store", description: "on this machine; add a git remote later to sync", url: false },
      { label: "$(repo-clone) Use my existing store", description: "clone it from its git URL (another machine)", url: true },
    ],
    { placeHolder: "Punk Records needs a store for your memories" },
  );
  if (!choice) return;
  if (!choice.url) {
    await runPunk("creating the store", ["init"]);
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt: "Git URL of your Punk Records store",
    placeHolder: "git@github.com:you/my-punk-records.git",
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() ? "Enter a git URL" : /\s/.test(v.trim()) ? "A git URL has no spaces" : undefined),
  });
  if (url) await runPunk("cloning the store", ["init", url.trim()]);
}

async function track(folder?: string): Promise<void> {
  const folders = folder ? [folder] : (listing ? untrackedFolders(listing) : []).map((u) => u.folder);
  if (!folders.length) {
    vscode.window.showInformationMessage("Punk Records: every open folder is tracked already.");
    return;
  }
  if ((await runPunk("tracking", ["track", ...folders])) === 0) await runPunk("saving", ["save"]);
}

async function setup(): Promise<void> {
  if (step === "install" || step === "upgrade") await installPunk(step);
  else if (step === "init") await initStore();
  else if (step === "track") await track();
  else await menu();
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
  if (args[0] === "sync") syncBlock = afterSync(syncBlock, r);
  if (r.code === 0) {
    const first = r.stdout.trim().split("\n")[0];
    vscode.window.setStatusBarMessage(`$(check) punk ${args[0]}: ${first || "done"}`, 4000);
  } else {
    const problem = args[0] === "sync" ? syncProblem(r) : null; // this run's, not one kept from before
    const msg = problem
      ? problem.tooltip.split("\n")[0]
      : (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ") || `exit ${r.code}`;
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
  snapshot(): {
    text: string;
    tooltip: string;
    satellites: string[];
    subscriptions: string[];
    setup: string | null;
    syncProblem: string | null;
    warning: boolean;
  };
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
    reg("punkRecords.setup", () => setup()),
    reg("punkRecords.install", () => installPunk("install")),
    reg("punkRecords.upgrade", () => installPunk("upgrade")),
    reg("punkRecords.init", () => initStore()),
    reg("punkRecords.track", (folder?: string) => track(typeof folder === "string" ? folder : undefined)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
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
      setup: step,
      syncProblem: syncBlock?.kind ?? null,
      warning: statusItem.backgroundColor !== undefined,
    }),
  };
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
  for (const t of pendingSaves.values()) clearTimeout(t);
}
