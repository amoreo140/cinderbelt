// Minimal typed access to Node built-ins for the bot CLI (the project has no Node typings – same
// approach as src/testing/nodeFs.ts). The game never imports this module.

interface Proc {
  getBuiltinModule(id: string): unknown;
  execPath: string;
  env: Record<string, string | undefined>;
  stdout: { write(s: string): boolean };
}

interface ChildProcess {
  stdout: { on(event: 'data', cb: (d: { toString(): string }) => void): void };
  on(event: 'error', cb: (e: unknown) => void): void;
  on(event: 'close', cb: (code: number | null) => void): void;
}

export interface NodeApi {
  fs: {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: 'utf8'): string;
    writeFileSync(path: string, data: string): void;
    mkdirSync(path: string, options: { recursive: boolean }): void;
  };
  path: { dirname(p: string): string; resolve(...p: string[]): string };
  os: { cpus(): unknown[] };
  childProcess: { spawn(cmd: string, args: string[], options: { stdio: unknown[] }): ChildProcess };
  process: Proc;
}

let cached: NodeApi | null = null;

export function node(): NodeApi {
  if (cached) return cached;
  const proc = (globalThis as unknown as { process?: Proc }).process;
  if (!proc?.getBuiltinModule) throw new Error('The balance bot runs in Node only.');
  cached = {
    fs: proc.getBuiltinModule('node:fs') as NodeApi['fs'],
    path: proc.getBuiltinModule('node:path') as NodeApi['path'],
    os: proc.getBuiltinModule('node:os') as NodeApi['os'],
    childProcess: proc.getBuiltinModule('node:child_process') as NodeApi['childProcess'],
    process: proc,
  };
  return cached;
}

/** Environment variable (undefined outside Node). */
export function envVar(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}
