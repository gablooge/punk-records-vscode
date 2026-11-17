// The "Punk Records" view in the Explorer: satellites, their memories, and read-only team subscriptions.
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Listing } from "./punk";

export type Node =
  | { type: "satellite"; id: string; localPath: string | null; memories: string[] }
  | { type: "subscription"; name: string; url: string; satellites: { id: string; memories: string[] }[] }
  | { type: "teamSatellite"; team: string; id: string; memories: string[] }
  | { type: "memory"; satellite: string; rel: string; localFile: string | null; team: boolean }
  | { type: "message"; text: string };

export class MemoriesTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private listing: Listing | null = null;
  private error: string | null = null;

  update(listing: Listing | null, error: string | null = null): void {
    this.listing = listing;
    this.error = error;
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      if (this.error) return [{ type: "message", text: this.error }];
      if (!this.listing) return [{ type: "message", text: "Loading..." }];
      const sats: Node[] = this.listing.satellites.map((s) => ({
        type: "satellite", id: s.id, localPath: s.local_path, memories: s.memories,
      }));
      const subs: Node[] = this.listing.subscriptions.map((s) => ({
        type: "subscription", name: s.name, url: s.url, satellites: s.satellites,
      }));
      const all = [...sats, ...subs];
      return all.length ? all : [{ type: "message", text: "Nothing tracked yet: run `punk track <folder>`" }];
    }
    if (node.type === "satellite") {
      return node.memories.map((rel) => {
        const local = node.localPath ? path.join(node.localPath, ...rel.split("/")) : null;
        return { type: "memory", satellite: node.id, rel, localFile: local && fs.existsSync(local) ? local : null, team: false };
      });
    }
    if (node.type === "subscription") {
      return node.satellites.map((s) => ({ type: "teamSatellite", team: node.name, id: s.id, memories: s.memories }));
    }
    if (node.type === "teamSatellite") {
      return node.memories.map((rel) => ({
        type: "memory", satellite: `@${node.team}/${node.id}`, rel, localFile: null, team: true,
      }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    switch (node.type) {
      case "message":
        return new vscode.TreeItem(node.text, C.None);
      case "satellite": {
        const item = new vscode.TreeItem(node.id, C.Collapsed);
        item.description = node.localPath ?? "not on this machine";
        item.iconPath = new vscode.ThemeIcon(node.id === "global" ? "home" : "repo");
        item.tooltip = `${node.memories.length} memory file(s)`;
        return item;
      }
      case "subscription": {
        const item = new vscode.TreeItem(`@${node.name}`, C.Collapsed);
        item.description = "read-only";
        item.tooltip = node.url;
        item.iconPath = new vscode.ThemeIcon("organization");
        return item;
      }
      case "teamSatellite": {
        const item = new vscode.TreeItem(node.id, C.Collapsed);
        item.iconPath = new vscode.ThemeIcon("repo");
        return item;
      }
      case "memory": {
        const item = new vscode.TreeItem(node.rel, C.None);
        item.iconPath = new vscode.ThemeIcon(node.team ? "lock" : "note");
        item.description = node.team ? "team" : node.localFile ? undefined : "store only";
        item.contextValue = node.localFile ? "memory-local" : "memory-store";
        item.command = { command: "punkRecords.open", title: "Open", arguments: [node] };
        return item;
      }
    }
  }
}
