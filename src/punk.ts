// Runs the `punk` CLI. No VS Code imports, so it can be tested with plain Node.
import { execFile } from "node:child_process";

export const SUPPORTED_JSON_VERSION = 1;

export interface Action {
  kind: string; // add | update | delete | conflict | blocked | stale | missing | skipped
  satellite: string;
  path: string;
  note: string;
}

export interface Status {
  version: number;
  save: Action[];
  restore: Action[];
  remote: { kind: string; url: string } | null;
}

export interface Satellite {
  id: string;
  kind: string;
  name: string;
  local_path: string | null;
  memories: string[];
}

export interface Subscription {
  name: string;
  url: string;
  satellites: { id: string; memories: string[] }[];
}

export interface Listing {
  version: number;
  satellites: Satellite[];
  subscriptions: Subscription[];
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Killed (timeout or signal) before punk exited: `code` is then 1, not punk's own exit code. */
  killed?: boolean;
}

/** What a setup problem needs: install punk, upgrade it, or create a store. "other" is any other failure. */
export type Problem = "missing" | "old" | "nostore" | "other";

export class PunkError extends Error {
  constructor(message: string, readonly problem: Problem = "other") {
    super(message);
  }
}

const NO_STORE = /no store at .* run `punk init` first/;

export class Punk {
  constructor(
    readonly executable: string,
    readonly home?: string,
    readonly timeoutMs = 120_000,
  ) {}

  /** Run `punk [--home H] ...args`. Resolves with the exit code; rejects only if punk cannot start. */
  run(args: string[], cwd?: string): Promise<RunResult> {
    const full = this.home ? ["--home", this.home, ...args] : args;
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        full,
        {
          cwd,
          timeout: this.timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
          if (e && e.code === "ENOENT") {
            reject(
              new PunkError(
                `'${this.executable}' was not found. Install it with \`pipx install punk-records\`, ` +
                  "or set punkRecords.executable to its full path (`which punk`).",
                "missing",
              ),
            );
            return;
          }
          const exit = e ? (e.code as unknown) : 0;
          const killed = typeof exit !== "number"; // a timeout or signal: no exit code
          const code = typeof exit === "number" ? exit : 1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr), killed });
        },
      );
    });
  }

  private async json<T extends { version: number }>(args: string[]): Promise<T> {
    const r = await this.run([...args, "--json"]);
    if (r.code !== 0) {
      if (/unrecognized arguments: --json/.test(r.stderr)) {
        throw new PunkError(`punk ${args[0]} has no --json; punk 0.4.0 or newer is needed (pipx upgrade punk-records)`, "old");
      }
      const msg = (r.stderr || r.stdout).trim().replace(/^punk: /, "") || `punk ${args[0]} failed`;
      throw new PunkError(msg, NO_STORE.test(msg) ? "nostore" : "other");
    }
    let data: T;
    try {
      data = JSON.parse(r.stdout) as T;
    } catch {
      throw new PunkError(`punk ${args[0]} --json did not return JSON; punk 0.4.0 or newer is needed`, "old");
    }
    if (data.version !== SUPPORTED_JSON_VERSION) {
      throw new PunkError(
        `punk ${args[0]} --json version ${data.version} is not supported (expected ${SUPPORTED_JSON_VERSION}); ` +
          "update the extension or punk",
      );
    }
    return data;
  }

  status(): Promise<Status> {
    return this.json<Status>(["status"]);
  }

  list(): Promise<Listing> {
    return this.json<Listing>(["list"]);
  }

  /** The store copy of a memory; `satellite` may be `@team/<id>` for a subscription. */
  async show(satellite: string, path: string): Promise<string> {
    const r = await this.run(["show", satellite, path]);
    if (r.code !== 0) {
      throw new PunkError((r.stderr || r.stdout).trim().replace(/^punk: /, ""));
    }
    return r.stdout;
  }

  async version(): Promise<string> {
    const r = await this.run(["--version"]);
    return r.stdout.trim().replace(/^punk /, "");
  }
}
