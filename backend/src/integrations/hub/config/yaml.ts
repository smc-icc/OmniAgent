/**
 * 受限 YAML 子集：map / list / scalar / `#` 注释 / `${ENV}`。
 * 不用 eval、不加 yaml 依赖。
 */

export type YamlValue = null | boolean | number | string | YamlValue[] | { [k: string]: YamlValue };

function substituteEnv(text: string, env: NodeJS.ProcessEnv): string {
  return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => env[key] ?? '');
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i).trimEnd();
  }
  return line;
}

export function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTop(inner).map((p) => parseScalar(p));
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const obj: Record<string, YamlValue> = {};
    for (const part of splitTop(inner)) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (const c of s) {
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '[' || c === '{') depth += 1;
    if (c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

interface Line { indent: number; text: string }

function parseLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const indent = stripped.match(/^ */)?.[0].length ?? 0;
    lines.push({ indent, text: stripped.trim() });
  }
  return lines;
}

export function parseRestrictedYaml(text: string, env: NodeJS.ProcessEnv = process.env): YamlValue {
  const lines = parseLines(substituteEnv(text, env));
  if (!lines.length) return {};
  return parseBlock(lines, 0, lines[0].indent).value;
}

function parseBlock(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  if (start >= lines.length) return { value: {}, next: start };
  if (lines[start].text.startsWith('- ')) return parseList(lines, start, indent);
  return parseMap(lines, start, indent);
}

function parseList(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const arr: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
    const rest = lines[i].text.slice(2).trim();
    const nextIndent = i + 1 < lines.length ? lines[i + 1].indent : indent;
    if (!rest) {
      const child = parseBlock(lines, i + 1, Math.max(nextIndent, indent + 2));
      arr.push(child.value);
      i = child.next;
      continue;
    }
    if (rest.includes(':') && !rest.startsWith('{') && !rest.startsWith('[')) {
      const itemIndent = indent + 2;
      const itemLines: Line[] = [{ indent: itemIndent, text: rest }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        itemLines.push(lines[j]);
        j += 1;
      }
      arr.push(parseMap(itemLines, 0, itemIndent).value);
      i = j;
    } else {
      arr.push(parseScalar(rest));
      i += 1;
    }
  }
  return { value: arr, next: i };
}

function parseMap(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const obj: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const idx = lines[i].text.indexOf(':');
    if (idx < 0) { i += 1; continue; }
    const key = lines[i].text.slice(0, idx).trim();
    const rest = lines[i].text.slice(idx + 1).trim();
    if (rest) {
      obj[key] = parseScalar(rest);
      i += 1;
      continue;
    }
    if (i + 1 >= lines.length || lines[i + 1].indent <= indent) {
      obj[key] = null;
      i += 1;
      continue;
    }
    const child = parseBlock(lines, i + 1, lines[i + 1].indent);
    obj[key] = child.value;
    i = child.next;
  }
  return { value: obj, next: i };
}
