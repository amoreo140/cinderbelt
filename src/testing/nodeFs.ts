// Access to project files in tests – Vitest runs in Node, but the project has no Node types.
// The game does not use this module.

export interface NodeFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
}

/** The `node:fs` module (paths are relative to the project root, where Vitest is started from). */
export function nodeFs(): NodeFs {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs');
  if (!fs) throw new Error('node:fs is not available (tests running outside Node?)');
  return fs as NodeFs;
}

/** An environment variable (e.g. UPDATE_ASSET_DATA=1 when regenerating the data from models). */
export function envVar(name: string): string | undefined {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
