// Godot's text formats, read without the editor: scenes (.tscn), resources (.tres), import settings
// (.import) and project.godot share one grammar of sections and `key = value` lines, whose values are
// Godot variants written as text.
//
//   [tag attr=value attr=value]     a section header; .tscn/.tres start with gd_scene or gd_resource
//   key = value                     a property of the section above; a value may span lines
//   ; comment                       ConfigFile files only
//
// A value parses to plain JSON where it has one (numbers, strings, StringNames and NodePaths as strings,
// arrays, dictionaries, booleans, null) and to `{ call, args }` for a constructor such as
// Rect2(0, 0, 8, 8), ExtResource("1_ab") or PackedStringArray("a"). Object(Class, "key": value) keeps
// its pairs as `{ key, value }` arguments. A line that does not parse is kept as `{ raw }`, so one odd
// property never costs the rest of the file.

const SPACE = new Set([' ', '\t', '\r', '\n', '﻿']);
const WORD = /[A-Za-z0-9_]/;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

class Reader {
  constructor(text) {
    this.text = text;
    this.at = 0;
  }

  error(message) {
    const line = this.text.slice(0, this.at).split('\n').length;
    return new Error(`line ${line}: ${message}`);
  }

  space() {
    while (this.at < this.text.length && SPACE.has(this.text[this.at])) this.at++;
  }

  /** Spaces and tabs only: a header's attributes and a key stay on their line. */
  blank() {
    while (this.text[this.at] === ' ' || this.text[this.at] === '\t') this.at++;
  }

  word() {
    const start = this.at;
    while (this.at < this.text.length && WORD.test(this.text[this.at])) this.at++;
    return this.text.slice(start, this.at);
  }

  string() {
    // The opening quote is at this.at.
    this.at++;
    let out = '';
    for (;;) {
      if (this.at >= this.text.length) throw this.error('a string is not closed');
      const c = this.text[this.at++];
      if (c === '"') return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.text[this.at++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === 'u' || e === 'U') {
        const width = e === 'u' ? 4 : 6;
        out += String.fromCodePoint(Number.parseInt(this.text.slice(this.at, this.at + width), 16));
        this.at += width;
      } else out += e;
    }
  }

  list(close) {
    // The opening bracket is at this.at.
    this.at++;
    const items = [];
    for (;;) {
      this.space();
      if (this.text[this.at] === close) {
        this.at++;
        return items;
      }
      const item = this.value();
      this.space();
      if (this.text[this.at] === ':') {
        // Object(Class, "key": value, ...) writes its properties as pairs.
        this.at++;
        items.push({ key: item, value: this.value() });
        this.space();
      } else items.push(item);
      if (this.text[this.at] === ',') this.at++;
      else if (this.text[this.at] !== close) throw this.error(`expected , or ${close}`);
    }
  }

  dictionary() {
    this.at++;
    const out = {};
    for (;;) {
      this.space();
      if (this.text[this.at] === '}') {
        this.at++;
        return out;
      }
      const key = this.value();
      this.space();
      if (this.text[this.at] !== ':') throw this.error('expected : in a dictionary');
      this.at++;
      out[typeof key === 'string' ? key : JSON.stringify(key)] = this.value();
      this.space();
      if (this.text[this.at] === ',') this.at++;
      else if (this.text[this.at] !== '}') throw this.error('expected , or }');
    }
  }

  value() {
    this.space();
    const c = this.text[this.at];
    if (c === undefined) throw this.error('a value is missing');
    if (c === '"') return this.string();
    if ((c === '&' || c === '^') && this.text[this.at + 1] === '"') {
      this.at++;
      return this.string();
    }
    if (c === '[') return this.list(']');
    if (c === '{') return this.dictionary();
    NUMBER.lastIndex = this.at;
    const number = NUMBER.exec(this.text);
    if (number !== null) {
      this.at += number[0].length;
      return Number(number[0]);
    }
    if (c === '-' && this.text.startsWith('inf', this.at + 1)) {
      this.at += 4;
      return -Infinity;
    }
    const name = this.word();
    if (name === '') throw this.error(`unexpected ${JSON.stringify(c)}`);
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null' || name === 'nil') return null;
    if (name === 'inf') return Infinity;
    if (name === 'inf_neg') return -Infinity;
    if (name === 'nan') return Number.NaN;
    this.blank();
    // A typed container, Array[Texture2D]([...]) or Dictionary[String, int]({...}): the type is dropped.
    if (this.text[this.at] === '[' && (name === 'Array' || name === 'Dictionary')) {
      this.list(']');
      this.blank();
      if (this.text[this.at] !== '(') throw this.error(`expected ( after ${name}[...]`);
      const [inner] = this.list(')');
      return inner;
    }
    if (this.text[this.at] !== '(') return { call: name, args: [] };
    return { call: name, args: this.list(')') };
  }
}

/** Skips to the start of the next line that begins a header or a key: what follows a value that failed. */
function recover(reader) {
  const next = reader.text.indexOf('\n', reader.at);
  reader.at = next === -1 ? reader.text.length : next + 1;
  while (reader.at < reader.text.length) {
    const c = reader.text[reader.at];
    if (c === '[' || WORD.test(c) || c === '"') return;
    const end = reader.text.indexOf('\n', reader.at);
    reader.at = end === -1 ? reader.text.length : end + 1;
  }
}

/**
 * Every section of a Godot text file, in order: `{ tag, attrs, props }`. Properties before the first
 * header (a ConfigFile's global keys) go to a first section whose tag is null.
 */
export function parseGodotText(text) {
  const reader = new Reader(text);
  const sections = [];
  let current = { tag: null, attrs: {}, props: {} };
  sections.push(current);
  for (;;) {
    reader.space();
    if (reader.at >= text.length) break;
    const c = text[reader.at];
    if (c === ';' || c === '#') {
      const end = text.indexOf('\n', reader.at);
      reader.at = end === -1 ? text.length : end + 1;
      continue;
    }
    const start = reader.at;
    try {
      if (c === '[') {
        reader.at++;
        reader.blank();
        const tag = reader.word();
        const attrs = {};
        for (;;) {
          reader.blank();
          if (text[reader.at] === ']') {
            reader.at++;
            break;
          }
          const key = reader.word();
          if (key === '') throw reader.error(`a header attribute is malformed in [${tag}]`);
          reader.blank();
          if (text[reader.at] !== '=') throw reader.error(`expected = after ${key} in [${tag}]`);
          reader.at++;
          attrs[key] = reader.value();
        }
        current = { tag, attrs, props: {} };
        sections.push(current);
        continue;
      }
      let key;
      if (c === '"') key = reader.string();
      else {
        const end = text.indexOf('=', reader.at);
        const newline = text.indexOf('\n', reader.at);
        if (end === -1 || (newline !== -1 && newline < end)) throw reader.error('expected key = value');
        key = text.slice(reader.at, end).trim();
        reader.at = end;
      }
      reader.blank();
      if (text[reader.at] !== '=') throw reader.error(`expected = after ${key}`);
      reader.at++;
      const valueStart = reader.at;
      try {
        current.props[key] = reader.value();
      } catch {
        reader.at = valueStart;
        const end = text.indexOf('\n', valueStart);
        current.props[key] = { raw: text.slice(valueStart, end === -1 ? text.length : end).trim() };
        recover(reader);
      }
    } catch {
      reader.at = start;
      recover(reader);
    }
  }
  if (sections[0].tag === null && Object.keys(sections[0].props).length === 0) sections.shift();
  return sections;
}

export const isCall = (value, name) => value !== null && typeof value === 'object' && !Array.isArray(value) && value.call === name;

/** The numbers of a Rect2(x, y, w, h) or Rect2i, or null. */
export function rectOf(value) {
  if (!(isCall(value, 'Rect2') || isCall(value, 'Rect2i')) || value.args.length !== 4) return null;
  return value.args.every((n) => typeof n === 'number' && Number.isFinite(n)) ? value.args : null;
}

/**
 * A scene or resource file as its parts: the header, external and sub resources by id, the nodes, and
 * the [resource] section's properties.
 */
export function readResourceText(text) {
  const sections = parseGodotText(text);
  const header = sections.find((section) => section.tag === 'gd_scene' || section.tag === 'gd_resource') ?? null;
  const external = new Map();
  const sub = new Map();
  const nodes = [];
  let resource = null;
  for (const section of sections) {
    if (section.tag === 'ext_resource') external.set(String(section.attrs.id), { type: section.attrs.type, path: section.attrs.path, uid: section.attrs.uid });
    else if (section.tag === 'sub_resource') sub.set(String(section.attrs.id), { type: section.attrs.type, props: section.props });
    else if (section.tag === 'node') nodes.push({ ...section.attrs, props: section.props });
    else if (section.tag === 'resource') resource = section.props;
  }
  return { header, external, sub, nodes, resource };
}

/** The id an ExtResource("id") or SubResource("id") value names, or null. */
export function referenceId(value, kind) {
  return isCall(value, kind) && value.args.length >= 1 ? String(value.args[0]) : null;
}
