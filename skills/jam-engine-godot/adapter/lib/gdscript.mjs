const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;
const TYPE = /[A-Za-z_][A-Za-z0-9_.]*(?:[ \t]*\[[A-Za-z0-9_., \t]+\])?/;
const STRING = /[&r]?(?:(?<triple>"""|''')(?:\\[\s\S]|(?!\k<triple>)[^\\])*\k<triple>|"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*')/;
const COMMENT = /#[^\r\n]*/;
const NUMBER = /\d+(?:\.\d+)?/;
const DECLARATIONS = new RegExp(
  String.raw`^\uFEFF?const[ \t]+(${IDENTIFIER.source})[ \t]*(?::=|(?::[ \t]*${TYPE.source}[ \t]*)?=)|${STRING.source}|${COMMENT.source}`,
  'gm',
);
const EXPRESSION = new RegExp(
  [STRING, COMMENT, /\\(?:\r\n|\r|\n)|[ \t]+|\r\n|\r|\n/, NUMBER, IDENTIFIER, /\+\+|--|[\s\S]/]
    .map((pattern) => pattern.source).join('|'),
  'gy',
);
const CLOSERS = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
const CONSTRUCTORS = new Map([['Vector2', 2], ['Vector2i', 2], ['Rect2', 4], ['Rect2i', 4]]);
const ESCAPES = new Map([
  ['n', '\n'], ['t', '\t'], ['r', '\r'], ['a', '\u0007'], ['b', '\b'], ['f', '\f'], ['v', '\v'],
  ['"', '"'], ["'", "'"], ['\\', '\\'],
]);

function expressionTokens(text, start) {
  EXPRESSION.lastIndex = start;
  const tokens = [];
  const closers = [];
  for (let match; (match = EXPRESSION.exec(text)) !== null;) {
    const token = match[0];
    // A line break within a collection or call is expression whitespace.
    if (/^[\r\n]/.test(token)) {
      if (closers.length === 0) break;
      continue;
    }
    if (/^[ \t#]/.test(token) || /^\\[\r\n]/.test(token)) continue;
    if (CLOSERS.has(token)) closers.push(CLOSERS.get(token));
    else if (token === closers.at(-1)) closers.pop();
    tokens.push(token);
  }
  return tokens;
}

function readString(token) {
  const start = token[0] === '&' || token[0] === 'r' ? 1 : 0;
  const quote = token[start];
  const width = token.startsWith(quote.repeat(3), start) ? 3 : 1;
  const body = token.slice(start + width, -width);
  if (token[0] === 'r') return body;

  let valid = true;
  const value = body.replace(/\\(?:u[\da-fA-F]{4}|U[\da-fA-F]{6}|[\s\S])/g, (match) => {
    const escape = match.slice(1);
    if (ESCAPES.has(escape)) return ESCAPES.get(escape);
    const codepoint = escape.length > 1 ? Number.parseInt(escape.slice(1), 16) : NaN;
    if (codepoint <= 0x10ffff) return String.fromCodePoint(codepoint);
    valid = false;
    return '';
  });
  return valid ? value : null;
}

/**
 * @typedef {string | number | boolean | ConstantValue[] | Map<string | number, ConstantValue>} ConstantValue
 */

/**
 * Read top-level constant names and their values from GDScript source without running Godot.
 * Missing constants and expressions outside the supported subset evaluate to null.
 * @param {string} text
 * @returns {{ names: string[], value: (name: string) => ConstantValue | null }}
 */
export function scriptConstants(text) {
  const expressions = new Map();
  for (const match of text.matchAll(DECLARATIONS)) {
    // The other matches consume comments and strings before their contents can look like code.
    if (match[1] !== undefined) {
      expressions.set(match[1], expressionTokens(text, match.index + match[0].length));
    }
  }
  const cache = new Map();

  const evaluate = (name, seen) => {
    if (cache.has(name)) return cache.get(name);
    const tokens = expressions.get(name);
    if (tokens === undefined || seen.has(name)) return null;
    const inner = new Set([...seen, name]);
    let at = 0;

    const take = (token) => {
      if (tokens[at] !== token) return false;
      at++;
      return true;
    };

    const list = (end, readItem) => {
      const items = [];
      while (!take(end)) {
        const item = readItem();
        if (item === null) return null;
        items.push(item);
        if (!take(',')) return take(end) ? items : null;
      }
      return items;
    };

    const entry = () => {
      const key = ternary();
      if ((typeof key !== 'string' && typeof key !== 'number') || !take(':')) return null;
      const value = ternary();
      return value === null ? null : [key, value];
    };

    const atom = () => {
      const token = tokens[at++];
      if (token === undefined) return null;
      if (token.length > 1 && /^[&r]?["']/.test(token)) return readString(token);
      if (/^\d/.test(token)) {
        const number = Number(token);
        return Number.isFinite(number) ? number : null;
      }
      if (token === 'true' || token === 'false') return token === 'true';
      if (token === '-') {
        const next = atom();
        return typeof next === 'number' ? -next : null;
      }
      if (token === '(') {
        const value = ternary();
        return take(')') ? value : null;
      }
      if (token === '[') return list(']', ternary);
      if (token === '{') {
        const entries = list('}', entry);
        if (entries === null) return null;
        const values = new Map(entries);
        return values.size === entries.length ? values : null;
      }
      if (tokens[at] === '(' && (token === 'preload' || CONSTRUCTORS.has(token))) {
        at++;
        const args = list(')', ternary);
        if (args === null) return null;
        if (token === 'preload') return args.length === 1 && typeof args[0] === 'string' ? args[0] : null;
        if (args.length !== CONSTRUCTORS.get(token) || !args.every((arg) => typeof arg === 'number')) return null;
        if (token !== 'Rect2i') return args;
        const integers = args.map((arg) => Math.trunc(arg) + 0);
        return integers.every((arg) => arg >= -(2 ** 31) && arg < 2 ** 31) ? integers : null;
      }
      return evaluate(token, inner);
    };

    const product = () => {
      let value = atom();
      while (tokens[at] === '*' || tokens[at] === '/') {
        const op = tokens[at++];
        const next = atom();
        if (typeof value !== 'number' || typeof next !== 'number') return null;
        value = op === '*' ? value * next : value / next;
        if (!Number.isFinite(value)) return null;
      }
      return value;
    };

    const sum = () => {
      let value = product();
      while (tokens[at] === '+' || tokens[at] === '-') {
        const op = tokens[at++];
        const next = product();
        if (typeof value === 'string' && typeof next === 'string' && op === '+') {
          value += next;
        } else if (typeof value === 'number' && typeof next === 'number') {
          value = op === '+' ? value + next : value - next;
          if (!Number.isFinite(value)) return null;
        } else {
          return null;
        }
      }
      return value;
    };

    const ternary = () => {
      const value = sum();
      if (!take('if')) return value;
      const condition = sum();
      if (!take('else')) return null;
      const otherwise = ternary();
      if (value === null || otherwise === null || typeof condition !== 'boolean') return null;
      return condition ? value : otherwise;
    };

    const value = ternary();
    const result = at === tokens.length ? value : null;
    cache.set(name, result);
    return result;
  };

  return { names: [...expressions.keys()], value: (name) => evaluate(name, new Set()) };
}
