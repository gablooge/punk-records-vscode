# Install punk

The extension shows and runs what the `punk` command does. Install it once per machine:

```bash
pipx install punk-records    # or: uv tool install punk-records
punk --version               # 0.4.0 or newer
```

If VS Code cannot find it, set **punkRecords.executable** in your user settings to the output of
`which punk`.
