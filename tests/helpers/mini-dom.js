'use strict';

// Minimal DOM used only by the tests. It parses well-formed HTML (the kind the
// Osler page produces) and implements the small API surface the userscript needs.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const decoded = ENTITIES[entity.toLowerCase()];
    return decoded === undefined ? match : decoded;
  });
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

class MiniNode {
  constructor(documentRef, nodeType) {
    this.ownerDocument = documentRef;
    this.nodeType = nodeType;
    this.parentNode = null;
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  get previousElementSibling() {
    let node = this.previousSibling;
    while (node && node.nodeType !== 1) node = node.previousSibling;
    return node;
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  replaceWith(replacement) {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index < 0) return;
    const nodes = Array.isArray(replacement) ? replacement : [replacement];
    siblings.splice(index, 1, ...nodes);
    nodes.forEach((node) => { node.parentNode = this.parentNode; });
    this.parentNode = null;
  }
}

class TextNode extends MiniNode {
  constructor(documentRef, data) {
    super(documentRef, 3);
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }

  cloneNode() {
    return new TextNode(this.ownerDocument, this.data);
  }

  serialize() {
    return escapeText(this.data);
  }
}

class Fragment extends MiniNode {
  constructor(documentRef) {
    super(documentRef, 11);
    this.childNodes = [];
  }

  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  querySelectorAll(selector) {
    return querySelectorAll(this, selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  serialize() {
    return this.childNodes.map((node) => node.serialize()).join('');
  }
}

class Element extends MiniNode {
  constructor(documentRef, tagName) {
    super(documentRef, 1);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = [];
    this.childNodes = [];
    this.style = { cssText: '' };
    this.dataset = {};
  }

  get localName() {
    return this.tagName.toLowerCase();
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get classList() {
    const element = this;
    const list = () => String(element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    return {
      contains(name) { return list().includes(name); },
      add(name) { element.setAttribute('class', [...new Set([...list(), name])].join(' ')); },
      remove(name) { element.setAttribute('class', list().filter((item) => item !== name).join(' ')); },
      get length() { return list().length; },
      toString() { return list().join(' '); },
    };
  }

  get className() {
    return String(this.getAttribute('class') || '');
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get id() {
    return String(this.getAttribute('id') || '');
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
    if (value !== '') this.appendChild(new TextNode(this.ownerDocument, value));
  }

  get innerHTML() {
    return this.childNodes.map((node) => node.serialize()).join('');
  }

  set innerHTML(value) {
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
    const fragment = parseFragment(String(value), this.ownerDocument);
    fragment.childNodes.slice().forEach((node) => this.appendChild(node));
  }

  get outerHTML() {
    return this.serialize();
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    const attribute = this.attributes.find((item) => item.name === key);
    return attribute ? attribute.value : null;
  }

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    const attribute = this.attributes.find((item) => item.name === key);
    if (attribute) attribute.value = String(value);
    else this.attributes.push({ name: key, value: String(value) });
  }

  removeAttribute(name) {
    const key = String(name).toLowerCase();
    this.attributes = this.attributes.filter((item) => item.name !== key);
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  getClientRects() {
    const style = `${this.style.cssText || ''} ${this.getAttribute('style') || ''}`;
    if (/display\s*:\s*none/i.test(style)) return [];
    return [{}];
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    let current = this;
    while (current && current.nodeType === 1) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    return querySelectorAll(this, selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  cloneNode(deep = false) {
    const clone = this.ownerDocument.createElement(this.localName);
    clone.attributes = this.attributes.map((attribute) => ({ ...attribute }));
    clone.style.cssText = this.style.cssText;
    clone.dataset = { ...this.dataset };
    if (deep) {
      this.childNodes.forEach((node) => clone.appendChild(node.cloneNode(true)));
    }
    return clone;
  }

  serialize() {
    const tag = this.localName;
    const attributes = this.attributes
      .map((attribute) => (attribute.value === ''
        ? ` ${attribute.name}`
        : ` ${attribute.name}="${escapeAttr(attribute.value)}"`))
      .join('');
    if (VOID_TAGS.has(tag)) return `<${tag}${attributes}>`;
    const content = this.childNodes.map((node) => node.serialize()).join('');
    return `<${tag}${attributes}>${content}</${tag}>`;
  }
}

class TemplateElement extends Element {
  constructor(documentRef) {
    super(documentRef, 'template');
    this.content = new Fragment(documentRef);
  }

  get innerHTML() {
    return this.content.serialize();
  }

  set innerHTML(value) {
    this.content.childNodes.forEach((node) => { node.parentNode = null; });
    this.content.childNodes = [];
    parseFragment(String(value), this.ownerDocument).childNodes.slice()
      .forEach((node) => this.content.appendChild(node));
  }

  cloneNode() {
    const clone = new TemplateElement(this.ownerDocument);
    clone.innerHTML = this.innerHTML;
    return clone;
  }
}

class Document {
  constructor() {
    this.nodeType = 9;
    this.ownerDocument = this;
    this.defaultView = { scrollTo() {} };
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    const tag = String(tagName).toLowerCase();
    return tag === 'template' ? new TemplateElement(this) : new Element(this, tag);
  }

  createTextNode(data) {
    return new TextNode(this, data);
  }

  get scrollingElement() {
    return this.documentElement;
  }

  getElementById(id) {
    return this.documentElement.querySelector(`#${cssEscape(id)}`);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

/* ------------------------------------------------------------------ parser */

function findTagEnd(html, start) {
  let quote = '';
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return html.length;
}

function parseAttributes(source, element) {
  const pattern = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(source);
  while (match) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    element.setAttribute(name, decodeEntities(value));
    match = pattern.exec(source);
  }
}

function parseFragment(html, documentRef) {
  const root = new Fragment(documentRef);
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (text) => {
    if (!text) return;
    top().appendChild(new TextNode(documentRef, decodeEntities(text)));
  };

  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    if (lt > index) pushText(html.slice(index, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    const raw = html.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].localName === name) {
          stack.length = depth;
          break;
        }
      }
      index = gt + 1;
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([a-zA-Z][\w-]*)/.exec(body);
    if (!nameMatch) {
      index = gt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    const element = documentRef.createElement(tag);
    parseAttributes(body.slice(nameMatch[1].length), element);
    top().appendChild(element);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(element);
    index = gt + 1;
  }

  return root;
}

/* ---------------------------------------------------------------- selector */

function parseCompound(source) {
  const compound = { tag: '', id: '', classes: [], attrs: [] };
  let rest = source;
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(rest);
  if (tagMatch) {
    compound.tag = tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[1].length);
  }
  const tokenPattern = /([.#][\w-]+)|\[([\w:-]+)(?:([*^$]?=)"([^"]*)"|([*^$]?=)'([^']*)'|([*^$]?=)([^\]\s]+))?\]/g;
  let match = tokenPattern.exec(rest);
  while (match) {
    if (match[1]) {
      if (match[1][0] === '.') compound.classes.push(match[1].slice(1));
      else compound.id = match[1].slice(1);
    } else {
      compound.attrs.push({
        name: match[2].toLowerCase(),
        op: match[3] || match[5] || match[7] || '',
        value: match[4] ?? match[6] ?? match[8] ?? '',
      });
    }
    match = tokenPattern.exec(rest);
  }
  return compound;
}

function parseSelector(selector) {
  return String(selector).split(',').map((group) => group.trim()).filter(Boolean).map((group) => {
    const parts = group.split(/\s+/).filter((part) => part !== '>');
    return parts.map(parseCompound);
  });
}

function matchesCompound(element, compound) {
  if (element.nodeType !== 1) return false;
  if (compound.tag && compound.tag !== '*' && element.localName !== compound.tag) return false;
  if (compound.id && element.getAttribute('id') !== compound.id) return false;
  if (!compound.classes.every((name) => element.classList.contains(name))) return false;
  return compound.attrs.every((attr) => {
    const value = element.getAttribute(attr.name);
    if (value === null) return false;
    if (!attr.op) return true;
    if (attr.op === '=') return value === attr.value;
    if (attr.op === '*=') return value.includes(attr.value);
    if (attr.op === '^=') return value.startsWith(attr.value);
    if (attr.op === '$=') return value.endsWith(attr.value);
    return false;
  });
}

function matchesComplex(element, parts) {
  if (!matchesCompound(element, parts[parts.length - 1])) return false;
  let current = element.parentNode;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    let found = false;
    while (current && current.nodeType === 1) {
      if (matchesCompound(current, parts[index])) {
        found = true;
        current = current.parentNode;
        break;
      }
      current = current.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function matchesSelector(element, selector) {
  return parseSelector(selector).some((parts) => matchesComplex(element, parts));
}

function querySelectorAll(root, selector) {
  const groups = parseSelector(selector);
  const results = [];
  const visit = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType !== 1) return;
      if (groups.some((parts) => matchesComplex(child, parts))) results.push(child);
      visit(child);
    });
  };
  visit(root);
  return results;
}

/* ------------------------------------------------------------------ public */

function parseDocument(html) {
  const documentRef = new Document();
  const fragment = parseFragment(html, documentRef);
  const htmlElement = fragment.children.find((element) => element.localName === 'html');
  if (!htmlElement) {
    documentRef.body.innerHTML = fragment.serialize();
    return documentRef;
  }
  documentRef.documentElement = htmlElement;
  htmlElement.parentNode = null;
  const find = (name) => {
    const descendant = htmlElement.querySelector(name);
    if (descendant) return descendant;
    const created = documentRef.createElement(name);
    htmlElement.appendChild(created);
    return created;
  };
  documentRef.head = find('head');
  documentRef.body = find('body');
  return documentRef;
}

module.exports = {
  Document,
  parseDocument,
  parseFragment,
  querySelectorAll,
  matchesSelector,
};
