# Changelog

## 0.1.0 - 2026-11-22

First version. Needs punk-records 0.4.0 or newer.

- Status bar: in sync, memories to save, memories to restore, or conflicts; click for actions
- Commands: Save, Sync, Restore, Compare with store, Remove duplicate lines, Refresh
- Conflicts and edits open in VS Code's side-by-side diff (store copy vs local file)
- "Punk Records" view in the Explorer: satellites, memory files, read-only team subscriptions
- Optional: run `punk save` when you save a memory file (`punkRecords.saveOnFileSave`)
- `punkRecords.executable` and `punkRecords.home` are user settings only; a workspace cannot set them. Off in untrusted workspaces
