# Security policy

The Punk Records extension runs the `punk` command from inside VS Code, so a mistake could let a
repository you open run a program of its choosing, or show files it should not. Reports are taken
seriously.

## Reporting a vulnerability

Please report privately through GitHub:
**[Report a vulnerability](https://github.com/gablooge/punk-records-vscode/security/advisories/new)**
(the Security tab of this repository, then "Report a vulnerability").

Do not open a public issue for a security problem. Include the extension version, the punk version
(`punk --version`), VS Code version, your OS, and the smallest steps that show the problem. You
should get a first reply within a week.

A problem in the `punk` command itself (what it writes, syncs or scans) belongs to
[gablooge/punk-records](https://github.com/gablooge/punk-records/security/advisories/new).

## Supported versions

Only the latest release gets security fixes. A published version is never replaced; a fix ships as
a new version.

## What is in scope

These guarantees must always hold. Breaking any of them is a vulnerability:

1. **A workspace cannot choose what runs.** `punkRecords.executable` and `punkRecords.home` are read
   from user settings only (machine scope). A repository's `.vscode/settings.json`, a workspace file
   or a folder setting must not change the program the extension starts or the store it points at.
2. **No shell.** punk is started directly with a fixed list of arguments, never through a shell, so
   file names, satellite ids and memory paths are never interpreted as commands.
3. **Off in untrusted workspaces.** The extension does not activate in Restricted Mode or in virtual
   workspaces.
4. **Store copies are read-only.** Documents opened from the store (the left side of a diff, team
   subscriptions) cannot be saved back; changes go through `punk` commands only.
5. **Writes go through punk.** The extension itself writes no files; saving, restoring, syncing and
   removing duplicates are done by `punk`, whose own guarantees are in
   [punk-records' SECURITY.md](https://github.com/gablooge/punk-records/blob/main/SECURITY.md).

## Out of scope

- The `punk` program you configured yourself in user settings. The extension runs what you tell it
  to.
- Anything that requires write access to your user settings, your machine or your store already.
