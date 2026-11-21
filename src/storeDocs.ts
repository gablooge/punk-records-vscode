// Read-only documents with a memory's store copy: punk-records:/<satellite>/<path>
import * as vscode from "vscode";
import type { Punk } from "./punk";

export const SCHEME = "punk-records";

export function storeUri(satellite: string, rel: string): vscode.Uri {
  // The satellite id contains slashes (github.com/me/app), so it is one encoded path segment.
  return vscode.Uri.from({ scheme: SCHEME, path: `/${encodeURIComponent(satellite)}/${rel}` });
}

export function parseStoreUri(uri: vscode.Uri): { satellite: string; rel: string } {
  const [, first, ...rest] = uri.path.split("/");
  return { satellite: decodeURIComponent(first), rel: rest.join("/") };
}

export class StoreDocuments implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  constructor(private punk: () => Punk) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { satellite, rel } = parseStoreUri(uri);
    try {
      return await this.punk().show(satellite, rel);
    } catch (e) {
      return `(not in the store: ${(e as Error).message})`;
    }
  }

  refresh(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }
}
