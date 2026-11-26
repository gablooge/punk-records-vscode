# Changelog

## Unreleased

- Getting started: when punk is missing, too old or has no store, the Punk Records view and the status
  bar (`punk: set up`) offer the next step (install or upgrade with pipx in a terminal, create or clone
  a store, track the open folder), plus a walkthrough with the same steps
- Untracked workspace folders appear as "Track <folder>" at the top of the view
- A refresh asked for while another runs now runs again afterwards, so it reflects settings changed
  in between
- A sync that stays blocked until you act is shown in the status bar (warning background) until a
  sync succeeds, instead of only a warning that is gone once closed: `punk: sync blocked` (the store
  and its remote both changed the same files), `punk: wrong remote` (not a Punk Records store,
  punk 0.6.2+) or `punk: needs age` (encrypted store, `age` not installed). The tooltip says what to
  do, then punk's own message. A remote that cannot be reached stays a one-off warning
- The warning after a failed command no longer holds up the status bar refresh until it is closed
- `npm run test:vscode` works when started from inside VS Code: every `VSCODE_*` and `ELECTRON_*`
  variable is dropped, not only three

## 0.1.0 - 2026-11-22

First version. Needs punk-records 0.4.0 or newer.

- Status bar: in sync, memories to save, memories to restore, or conflicts; click for actions
- Commands: Save, Sync, Restore, Compare with store, Remove duplicate lines, Refresh
- Conflicts and edits open in VS Code's side-by-side diff (store copy vs local file)
- "Punk Records" view in the Explorer: satellites, memory files, read-only team subscriptions
- Optional: run `punk save` when you save a memory file (`punkRecords.saveOnFileSave`)
- `punkRecords.executable` and `punkRecords.home` are user settings only; a workspace cannot set them. Off in untrusted workspaces
