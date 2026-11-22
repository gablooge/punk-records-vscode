// Runs inside VS Code (started by record.ts). Drives the extension through its own commands and
// captures the window over the Chrome DevTools protocol: still screenshots into docs/, GIF frames
// into PUNK_DEMO_FRAMES.
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { TestApi } from "../extension";

type Send = (method: string, params?: object) => Promise<any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function devtools(port: number): Promise<Send> {
  const targets: { type: string; url: string; webSocketDebuggerUrl: string }[] =
    (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any;
  const page = targets.find((t) => t.type === "page" && t.url.includes("workbench"));
  if (!page) throw new Error("no workbench page on the DevTools port");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const pending = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}

class Recorder {
  private frames: { file: string; t: number; end?: number }[] = [];
  private running = false;
  private loop: Promise<void> = Promise.resolve();
  constructor(private send: Send, private dir: string) {}

  start(): void {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const t = Date.now();
        const { data } = await this.send("Page.captureScreenshot", { format: "png" });
        const file = `${String(this.frames.length).padStart(4, "0")}.png`;
        fs.writeFileSync(path.join(this.dir, file), Buffer.from(data, "base64"));
        this.frames.push({ file, t });
        await sleep(Math.max(0, 100 - (Date.now() - t)));
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    if (this.frames.length) this.frames[this.frames.length - 1].end = Date.now(); // pauses are cut from the GIF
    const list = this.frames.map((f, i) => ({ file: f.file, ms: (f.end ?? this.frames[i + 1].t) - f.t }));
    fs.writeFileSync(path.join(this.dir, "index.json"), JSON.stringify(list));
  }
}

export async function run(): Promise<void> {
  const send = await devtools(Number(process.env.PUNK_DEMO_PORT));
  const docs = process.env.PUNK_DEMO_DOCS!;
  const frames = process.env.PUNK_DEMO_FRAMES!;
  const size = (scale: number) =>
    send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: scale, mobile: false });
  const still = async (name: string) => {
    await size(2);
    await sleep(400);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(docs, name), Buffer.from(data, "base64"));
    await size(1);
    await sleep(300);
  };
  const cmd = (id: string, ...args: unknown[]) => vscode.commands.executeCommand(id, ...args);

  const api = await vscode.extensions.getExtension<TestApi>("gablooge.punk-records")!.activate();
  await size(1);
  await cmd("notifications.clearAll");
  await cmd("workbench.action.closePanel");

  // Explorer with only the Punk Records view, every node expanded.
  for (const view of ["outline", "timeline"]) await cmd(`${view}.removeView`);
  // The file list cannot be removed, only collapsed: click its section header. And the title bar
  // shows "[Extension Development Host] app" in this test mode, which installed copies never do;
  // show just the folder name, as a normal window would.
  await send("Runtime.evaluate", { expression: `(() => {
    const h = [...document.querySelectorAll('.pane-header')].find((e) => e.getAttribute('aria-expanded') === 'true' && /\\bapp\\b/.test(e.textContent || ''));
    if (h) h.click();
    const s = document.createElement('style');
    s.textContent = '.window-title { font-size: 0 !important } .window-title::after { content: "app"; font-size: 13px }';
    document.head.appendChild(s);
  })()` });
  await cmd("punkRecords.memories.focus");
  await api.refresh();
  await sleep(500);
  await cmd("list.focusFirst");
  for (let i = 0; i < 16; i++) {
    await cmd("list.expand");
    await sleep(80);
    await cmd("list.focusDown");
  }
  await cmd("list.focusFirst");
  await sleep(300);

  const folder = vscode.workspace.workspaceFolders![0].uri;
  const file = vscode.Uri.joinPath(folder, "CLAUDE.md");
  const editor = await vscode.window.showTextDocument(file, { preview: false });
  await sleep(800);
  await still("overview.png");

  const rec = new Recorder(send, frames);
  rec.start();
  await sleep(1500);

  // Type a new lesson into CLAUDE.md and save the file: the status bar shows it waits to be saved.
  const doc = editor.document;
  const text = "- Deploy with `make release`; it tags and pushes.\n";
  editor.selection = new vscode.Selection(doc.lineCount - 1, 0, doc.lineCount - 1, 0);
  for (const ch of text) {
    await editor.edit((b) => b.insert(editor.selection.active, ch), { undoStopBefore: false, undoStopAfter: false });
    await sleep(35);
  }
  await doc.save();
  await api.refresh();
  await sleep(1800);

  // Compare with store: the store copy next to the local file.
  await cmd("punkRecords.diff", { type: "memory", satellite: "github.com/you/app", rel: "CLAUDE.md", localFile: file.fsPath, team: false });
  await sleep(2500);
  await rec.stop();
  await still("diff.png");
  rec.start();
  await sleep(300);
  await cmd("workbench.action.closeActiveEditor");
  await sleep(600);

  // Click the status bar: the actions menu. Pick "Save memories".
  void cmd("punkRecords.menu");
  await sleep(1800);
  await cmd("workbench.action.acceptSelectedQuickOpenItem");
  for (let i = 0; i < 50 && api.snapshot().text !== "$(check) punk"; i++) await sleep(100);
  await sleep(2500);
  await rec.stop();
  console.log("final status:", api.snapshot().text);
}
