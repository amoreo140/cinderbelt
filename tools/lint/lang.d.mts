/** One finding of lint:lang. */
export interface LangProblem {
  line: number;
  what: 'comment' | 'test title' | 'internal doc link';
  text: string;
}

/** Problems in one file (path decides the parser: JS/TS, Python, CSS, HTML). */
export function scanSource(file: string, text: string): LangProblem[];
