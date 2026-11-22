# Contributing to the Punk Records extension

Thanks for helping. Bug reports and fixes are welcome. Changes to what gets synced, scanned or
written belong in the `punk` command: [gablooge/punk-records](https://github.com/gablooge/punk-records).

## Setup

You need Node.js 22, git, and `punk` 0.4.0 or newer (`pipx install punk-records`).

```bash
git clone https://github.com/gablooge/punk-records-vscode
cd punk-records-vscode
npm ci
npm test               # unit tests; the ones that run punk skip if it is missing or too old
npm run test:vscode    # integration test in a downloaded VS Code (Linux CI uses xvfb-run)
npm run package        # builds the .vsix
```

`PUNK_BIN` points the tests at a specific punk (default: `punk` on your PATH). To try your build,
run `npm run compile`, then `code --extensionDevelopmentPath="$PWD"` opens a VS Code window with it
loaded.

CI runs the unit tests on Linux, macOS and Windows, and the integration test and packaging on Linux.

## Rules

- **No runtime dependencies.** The extension is packaged with `--no-dependencies`; it uses the VS
  Code API, Node's standard library and the `punk` command. Development tools go in
  `devDependencies`.
- **The extension drives punk, it does not reimplement it.** Read state with `punk status --json`
  and `punk list --json`, and change files only by running punk commands.
- **`src/punk.ts` has no VS Code imports**, so it can be tested with plain Node (`node --test`).
- **Tests isolate HOME and git config** and use a throwaway store; copy the setup in
  `src/test/punk.test.ts` rather than touching your real home directory.
- **Keep the security guarantees.** Read [SECURITY.md](SECURITY.md). Never start punk through a
  shell, and never let a workspace setting choose the executable or the store.

## Pull requests

Keep each pull request to one change. Describe what it fixes, how you reproduced the problem, and
how you tested it; the pull request template has the sections. Make sure `npm test` and
`npm run test:vscode` pass before you ask for review.

## Reporting bugs

Open an issue with the bug report form. Include the "Punk Records" output channel (command
"Punk Records: Show output"), with any private paths or memory text removed. Security problems go
through [SECURITY.md](SECURITY.md), not public issues.
