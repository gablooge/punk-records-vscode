# Sync across machines

Create a **private** repository (GitHub, GitLab, a bare repo on your NAS) and add it as the store's
remote, once, in a terminal:

```bash
punk git remote add origin git@github.com:you/my-punk-records.git
```

Then **Sync** (status bar, or the command palette) saves, pulls, pushes and restores. For an
untrusted host, `punk encrypt` keeps only an encrypted bundle on the remote.
