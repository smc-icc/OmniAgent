/** 受限 when 表达式：字段路径、比较、&&/||/in、括号。禁止 eval。 */

export class WhenExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhenExprError';
  }
}

type TokKind = 'num' | 'str' | 'id' | 'op' | 'lp' | 'rp' | 'lb' | 'rb' | 'comma' | 'eof';
interface Tok { kind: TokKind; v: string }

const OPS = ['||', '&&', '==', '!=', '>=', '<=', '>', '<', 'in'] as const;

function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i += 1; continue; }
    if (c === '(') { tokens.push({ kind: 'lp', v: c }); i += 1; continue; }
    if (c === ')') { tokens.push({ kind: 'rp', v: c }); i += 1; continue; }
    if (c === '[') { tokens.push({ kind: 'lb', v: c }); i += 1; continue; }
    if (c === ']') { tokens.push({ kind: 'rb', v: c }); i += 1; continue; }
    if (c === ',') { tokens.push({ kind: 'comma', v: c }); i += 1; continue; }
    const two = src.slice(i, i + 2);
    if (OPS.includes(two as (typeof OPS)[number])) {
      tokens.push({ kind: 'op', v: two });
      i += 2;
      continue;
    }
    if (OPS.includes(c as (typeof OPS)[number])) {
      tokens.push({ kind: 'op', v: c });
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let buf = '';
      while (j < src.length && src[j] !== q) { buf += src[j]; j += 1; }
      if (j >= src.length) throw new WhenExprError('未闭合的字符串');
      tokens.push({ kind: 'str', v: buf });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      tokens.push({ kind: 'num', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j += 1;
      const ident = src.slice(i, j);
      if (ident === 'in' || ident === 'true' || ident === 'false' || ident === 'null') {
        if (ident === 'in') tokens.push({ kind: 'op', v: 'in' });
        else if (ident === 'true' || ident === 'false') tokens.push({ kind: 'id', v: ident });
        else tokens.push({ kind: 'id', v: ident });
      } else {
        tokens.push({ kind: 'id', v: ident });
      }
      i = j;
      continue;
    }
    throw new WhenExprError(`非法字符: ${c}`);
  }
  tokens.push({ kind: 'eof', v: '' });
  return tokens;
}

function lookup(ctx: unknown, path: string): unknown {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

class Parser {
  constructor(private tokens: Tok[], private ctx: unknown) {}
  i = 0;
  peek() { return this.tokens[this.i]; }
  eat(kind?: TokKind, v?: string): Tok {
    const t = this.peek();
    if (kind && t.kind !== kind) throw new WhenExprError(`期望 ${kind}，得到 ${t.kind}`);
    if (v !== undefined && t.v !== v) throw new WhenExprError(`期望 ${v}`);
    this.i += 1;
    return t;
  }

  parse(): unknown {
    const v = this.parseOr();
    if (this.peek().kind !== 'eof') throw new WhenExprError(`意外的 token: ${this.peek().v}`);
    return v;
  }

  parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek().kind === 'op' && this.peek().v === '||') {
      this.eat('op');
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  parseAnd(): unknown {
    let left = this.parseCmp();
    while (this.peek().kind === 'op' && this.peek().v === '&&') {
      this.eat('op');
      const right = this.parseCmp();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  parseCmp(): unknown {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t.kind !== 'op' || t.v === '&&' || t.v === '||') return left;
    const op = this.eat('op').v;
    if (op === 'in') {
      const right = this.parsePrimary();
      if (!Array.isArray(right)) throw new WhenExprError('in 右侧必须是数组');
      return right.some((x) => x === left);
    }
    const right = this.parsePrimary();
    const ln = toNum(left);
    const rn = toNum(right);
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return ln > rn;
      case '<': return ln < rn;
      case '>=': return ln >= rn;
      case '<=': return ln <= rn;
      default: throw new WhenExprError(`不支持的运算符: ${op}`);
    }
  }

  parsePrimary(): unknown {
    const t = this.peek();
    if (t.kind === 'lp') {
      this.eat('lp');
      const v = this.parseOr();
      this.eat('rp');
      return v;
    }
    if (t.kind === 'lb') {
      this.eat('lb');
      const arr: unknown[] = [];
      if (this.peek().kind !== 'rb') {
        arr.push(this.parsePrimary());
        while (this.peek().kind === 'comma') {
          this.eat('comma');
          arr.push(this.parsePrimary());
        }
      }
      this.eat('rb');
      return arr;
    }
    if (t.kind === 'num') return Number(this.eat('num').v);
    if (t.kind === 'str') return this.eat('str').v;
    if (t.kind === 'id') return lookup(this.ctx, this.eat('id').v);
    throw new WhenExprError(`非法主键: ${t.kind} ${t.v}`);
  }
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return NaN;
}

export function evalWhen(expr: string, ctx: unknown): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  const parser = new Parser(tokenize(trimmed), ctx);
  return Boolean(parser.parse());
}
