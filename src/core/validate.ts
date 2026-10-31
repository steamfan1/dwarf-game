/**
 * Small helper for checking untrusted JSON (game content now, save files later).
 *
 * Each check records a readable problem instead of throwing straight away, so one run
 * reports every mistake in a content file at once, e.g.
 *   tiles.json: tiles[4].mapColor must be a colour like "#a1b2c3", got "red"
 * Call `throwIfProblems()` at the end.
 */
export class Validator {
  readonly problems: string[] = [];
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  problem(message: string): void {
    this.problems.push(message);
  }

  throwIfProblems(): void {
    if (this.problems.length === 0) return;
    const list = this.problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(`${this.source} has ${this.problems.length} problem(s):\n${list}`);
  }

  object(value: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    this.problem(`${path || 'root'} must be an object`);
    return undefined;
  }

  array(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.problem(`${path} must be a list`);
    return [];
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string' && value.length > 0) return value;
    this.problem(`${path} must be a non-empty string`);
    return '';
  }

  /** snake_case ids such as "copper_ore". */
  identifier(value: unknown, path: string): string {
    if (typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value)) return value;
    this.problem(`${path} must be a snake_case id like "copper_ore", got ${JSON.stringify(value)}`);
    return '';
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value === 'boolean') return value;
    this.problem(`${path} must be true or false`);
    return false;
  }

  number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) return value;
    this.problem(`${path} must be a number between ${min} and ${max}, got ${JSON.stringify(value)}`);
    return Number.isFinite(min) ? min : 0;
  }

  /** A [min, max] pair of numbers with min <= max. */
  range(value: unknown, path: string, min = -Infinity, max = Infinity): [number, number] {
    if (Array.isArray(value) && value.length === 2) {
      const a = this.number(value[0], `${path}[0]`, min, max);
      const b = this.number(value[1], `${path}[1]`, min, max);
      if (a > b) this.problem(`${path} must be [min, max] with min <= max`);
      return [a, b];
    }
    this.problem(`${path} must be a [min, max] pair`);
    return [0, 0];
  }

  color(value: unknown, path: string): string {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
    this.problem(`${path} must be a colour like "#a1b2c3", got ${JSON.stringify(value)}`);
    return '#ff00ff';
  }

  oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T | undefined {
    if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T;
    this.problem(`${path} must be one of ${options.map((o) => `"${o}"`).join(', ')}, got ${JSON.stringify(value)}`);
    return undefined;
  }

  unique(values: readonly string[], what: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) this.problem(`duplicate ${what} "${value}"`);
      seen.add(value);
    }
  }
}
