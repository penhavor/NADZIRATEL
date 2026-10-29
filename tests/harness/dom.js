'use strict';
/* Минимальный DOM: парсер HTML + живое дерево элементов.
   Достаточно, чтобы загрузить страницу игры и гонять headless-тесты интерфейса. */

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);
const RAW = new Set(['script', 'style', 'textarea']);

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  middot: '\u00b7',
  hellip: '\u2026',
  times: '\u00d7',
  deg: '\u00b0'
};

function decodeText(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const k = body.toLowerCase();
    return ENTITIES[k] !== undefined ? ENTITIES[k] : m;
  });
}

function encodeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function camel(s) {
  return String(s).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
}
function dashed(s) {
  return String(s).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

let UID = 0;

class ClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }
  _set(a) {
    this.el.setAttribute('class', a.join(' '));
  }
  get length() {
    return this._list().length;
  }
  get value() {
    return this._list().join(' ');
  }
  contains(c) {
    return this._list().indexOf(c) >= 0;
  }
  add(...cs) {
    const a = this._list();
    for (const c of cs) if (a.indexOf(c) < 0) a.push(c);
    this._set(a);
  }
  remove(...cs) {
    let a = this._list();
    for (const c of cs) a = a.filter(x => x !== c);
    this._set(a);
  }
  toggle(c, force) {
    const want = force === undefined ? !this.contains(c) : !!force;
    if (want) this.add(c);
    else this.remove(c);
    return want;
  }
  replace(a, b) {
    if (!this.contains(a)) return false;
    this.remove(a);
    this.add(b);
    return true;
  }
  item(i) {
    return this._list()[i] || null;
  }
  forEach(fn) {
    this._list().forEach(fn);
  }
  entries() {
    return this._list().entries();
  }
  [Symbol.iterator]() {
    return this._list()[Symbol.iterator]();
  }
  toString() {
    return this._list().join(' ');
  }
}

class Style {
  constructor(el, raw) {
    this.el = el;
    this._props = {};
    if (raw) this._parse(raw);
    return new Proxy(this, {
      get(t, k) {
        if (k === 'setProperty') return (n, v) => t._set(n, v);
        if (k === 'getPropertyValue') return n => t._get(n);
        if (k === 'removeProperty')
          return n => {
            const v = t._get(n);
            delete t._props[camel(n)];
            t._sync();
            return v;
          };
        if (typeof k === 'string') {
          if (k in t._props) return t._props[k];
          if (k.indexOf('-') >= 0) return t._props[camel(k)] || '';
        }
        return t[k];
      },
      set(t, k, v) {
        if (typeof k === 'string' && k !== 'el' && k !== '_props') {
          t._set(k, v);
          return true;
        }
        t[k] = v;
        return true;
      },
      has(t, k) {
        return (typeof k === 'string' && camel(k) in t._props) || k in t;
      },
      ownKeys(t) {
        return Object.keys(t._props);
      },
      getOwnPropertyDescriptor(t, k) {
        if (typeof k === 'string' && camel(k) in t._props)
          return { enumerable: true, configurable: true, value: t._props[camel(k)] };
        return Object.getOwnPropertyDescriptor(t, k);
      }
    });
  }
  _parse(raw) {
    for (const decl of String(raw).split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (name) this._props[camel(name)] = decl.slice(i + 1).trim();
    }
  }
  _set(name, v) {
    this._props[camel(name)] = v === null || v === undefined ? '' : String(v);
    this._sync();
  }
  _get(name) {
    return this._props[camel(name)] || '';
  }
  _sync() {
    this.el.setAttribute('style', this.cssText);
  }
  get cssText() {
    const parts = [];
    for (const k of Object.keys(this._props))
      if (this._props[k] !== '') parts.push(dashed(k) + ':' + this._props[k]);
    return parts.join(';');
  }
  set cssText(raw) {
    this._props = {};
    this._parse(raw);
    this._sync();
  }
}

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this.data = String(text);
    this.parentNode = null;
    this._uid = ++UID;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
  get nodeValue() {
    return this.data;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

class El {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.localName = String(tag || 'div').toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc || null;
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this._uid = ++UID;
    this._style = null;
    this._classList = null;
    this._ctx = {};
    if (this.localName === 'canvas') {
      this.width = 300;
      this.height = 150;
    }
    if (
      this.localName === 'input' ||
      this.localName === 'select' ||
      this.localName === 'textarea'
    ) {
      this.value = '';
    }
    if (this.localName === 'input') {
      this.checked = false;
      this.type = 'text';
    }
    if (this.localName === 'button') {
      this.type = 'submit';
    }
  }

  get style() {
    if (!this._style) this._style = new Style(this, this.attributes.style);
    return this._style;
  }
  get classList() {
    if (!this._classList) this._classList = new ClassList(this);
    return this._classList;
  }

  get id() {
    return this.attributes.id || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }
  get className() {
    return this.attributes.class || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get dataset() {
    const el = this;
    return new Proxy(
      {},
      {
        get: (t, k) => el.getAttribute('data-' + dashed(k)),
        set: (t, k, v) => (el.setAttribute('data-' + dashed(k), v), true),
        has: (t, k) => el.hasAttribute('data-' + dashed(k))
      }
    );
  }

  getAttribute(n) {
    const v = this.attributes[String(n).toLowerCase()];
    return v === undefined ? null : v;
  }
  setAttribute(n, v) {
    n = String(n).toLowerCase();
    this.attributes[n] = String(v);
    if (n === 'style' && this._style) {
      this._style._props = {};
      this._style._parse(this.attributes.style);
    }
    if (this.localName === 'canvas' && (n === 'width' || n === 'height')) {
      const num = parseInt(this.attributes[n], 10);
      if (Number.isFinite(num)) this[n] = num;
    }
    if (n === 'value') this.value = this.attributes.value;
    if (n === 'checked') this.checked = this.attributes.checked !== 'false';
    if (n === 'type' && this.localName === 'input') this.type = this.attributes.type;
    if (n === 'id' && this.ownerDocument && this.ownerDocument._byId)
      this.ownerDocument._indexId(this);
  }
  hasAttribute(n) {
    return Object.prototype.hasOwnProperty.call(this.attributes, String(n).toLowerCase());
  }
  removeAttribute(n) {
    delete this.attributes[String(n).toLowerCase()];
  }
  getAttributeNames() {
    return Object.keys(this.attributes);
  }

  get children() {
    return this.childNodes.filter(n => n.nodeType === 1);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] || null;
  }
  get childElementCount() {
    return this.children.length;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get nextSibling() {
    return this._sib(1);
  }
  get previousSibling() {
    return this._sib(-1);
  }
  get nextElementSibling() {
    const s = this._sib(1);
    return s && s.nodeType === 1 ? s : null;
  }
  _sib(d) {
    if (!this.parentNode) return null;
    const a = this.parentNode.childNodes,
      i = a.indexOf(this);
    return i < 0 ? null : a[i + d] || null;
  }

  appendChild(n) {
    if (n && n.nodeType === 11) {
      for (const c of n.childNodes.slice()) this.appendChild(c);
      return n;
    }
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    if (n.nodeType === 1 && this.ownerDocument) this.ownerDocument._indexTree(n);
    return n;
  }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.splice(i, 0, n);
    if (n.nodeType === 1 && this.ownerDocument) this.ownerDocument._indexTree(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      n.parentNode = null;
      if (this.ownerDocument) this.ownerDocument._deindex(n);
    }
    return n;
  }
  replaceChild(nw, old) {
    this.insertBefore(nw, old);
    return this.removeChild(old);
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }
  cloneNode(deep) {
    const c = new El(this.localName, this.ownerDocument);
    c.attributes = Object.assign({}, this.attributes);
    if (deep)
      for (const n of this.childNodes)
        c.appendChild(n.nodeType === 1 ? n.cloneNode(true) : new TextNode(n.data));
    return c;
  }

  get textContent() {
    let s = '';
    for (const n of this.childNodes) s += n.nodeType === 3 ? n.data : n.textContent || '';
    return s;
  }
  set textContent(v) {
    for (const n of this.childNodes.slice()) this.removeChild(n);
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new TextNode(v));
  }

  get innerHTML() {
    return this.childNodes.map(serialize).join('');
  }
  set innerHTML(html) {
    for (const n of this.childNodes.slice()) this.removeChild(n);
    const nodes = parseNodes(String(html), this.ownerDocument);
    for (const n of nodes) this.appendChild(n);
  }
  get outerHTML() {
    return serialize(this);
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this.listeners[type];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    return dispatch(this, ev);
  }
  click() {
    dispatch(this, makeEvent('click', {}));
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    dispatch(this, makeEvent('focus', {}));
  }
  blur() {
    dispatch(this, makeEvent('blur', {}));
  }
  select() {}
  setSelectionRange() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    const w = this.localName === 'canvas' ? this.width : 640;
    const h = this.localName === 'canvas' ? this.height : 480;
    return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h };
  }
  get offsetWidth() {
    return this.getBoundingClientRect().width;
  }
  get offsetHeight() {
    return this.getBoundingClientRect().height;
  }
  get clientWidth() {
    return this.getBoundingClientRect().width;
  }
  get clientHeight() {
    return this.getBoundingClientRect().height;
  }

  getContext(kind, opts) {
    if (!this._ctx[kind] && this.ownerDocument)
      this._ctx[kind] = this.ownerDocument._makeContext(this, kind, opts);
    return this._ctx[kind] || null;
  }
  requestPointerLock() {
    if (this.ownerDocument) this.ownerDocument.pointerLockElement = this;
    return Promise.resolve();
  }
  toDataURL() {
    return 'data:,';
  }

  matches(sel) {
    return matchSelector(this, sel);
  }
  querySelector(sel) {
    const r = queryAll(this, sel);
    return r.length ? r[0] : null;
  }
  querySelectorAll(sel) {
    return queryAll(this, sel);
  }
  closest(sel) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchSelector(n, sel)) return n;
    return null;
  }
  getElementsByTagName(t) {
    return queryAll(this, String(t).toLowerCase());
  }
  getElementsByClassName(c) {
    return queryAll(this, '.' + c);
  }
}

/* ---- события ---- */
function makeEvent(type, props) {
  return Object.assign(
    {
      type,
      defaultPrevented: false,
      _stop: false,
      bubbles: true,
      cancelable: true,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this._stop = true;
      },
      stopImmediatePropagation() {
        this._stop = true;
      }
    },
    props || {}
  );
}

let HANDLER_ERRORS = [];
function dispatch(target, ev) {
  ev.target = ev.target || target;
  const chain = [];
  for (let n = target; n; n = n.parentNode) chain.push(n);
  const doc = target.ownerDocument;
  if (doc && chain.indexOf(doc) < 0) chain.push(doc);
  if (doc && doc.defaultView && chain.indexOf(doc.defaultView) < 0) chain.push(doc.defaultView);
  for (const n of chain) {
    ev.currentTarget = n;
    const on = n['on' + ev.type];
    if (typeof on === 'function') {
      try {
        on.call(n, ev);
      } catch (e) {
        HANDLER_ERRORS.push({ where: 'on' + ev.type, err: e });
      }
    }
    const a = n.listeners && n.listeners[ev.type];
    if (a)
      for (const fn of a.slice()) {
        try {
          fn.call(n, ev);
        } catch (e) {
          HANDLER_ERRORS.push({ where: ev.type, err: e });
        }
      }
    if (ev._stop) break;
  }
  return !ev.defaultPrevented;
}

/* ---- сериализация ---- */
function serialize(n) {
  if (n.nodeType === 3) return encodeText(n.data);
  if (n.nodeType !== 1) return '';
  const tag = n.localName;
  let s = '<' + tag;
  for (const k of Object.keys(n.attributes))
    s += ' ' + k + '="' + n.attributes[k].replace(/"/g, '&quot;') + '"';
  if (VOID.has(tag)) return s + '>';
  s += '>';
  if (RAW.has(tag)) {
    for (const c of n.childNodes) s += c.nodeType === 3 ? c.data : '';
  } else for (const c of n.childNodes) s += serialize(c);
  return s + '</' + tag + '>';
}

/* ---- парсер HTML ---- */
function parseNodes(html, doc) {
  const root = new El('#fragment', doc);
  root.nodeType = 11;
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = html.length;

  const addText = s => {
    if (s) top().appendChild(new TextNode(decodeText(s)));
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const e = html.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const e = html.indexOf('>', lt);
      const name = html
        .slice(lt + 2, e < 0 ? n : e)
        .trim()
        .toLowerCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].localName === name) {
          stack.length = k;
          break;
        }
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<([a-zA-Z][-a-zA-Z0-9:]*)/.exec(html.slice(lt));
    if (!m) {
      addText('<');
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = lt + m[0].length;
    const attrs = {};
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(html[j])) j++;
      if (j >= n) break;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html[j] === '/' && html[j + 1] === '>') {
        selfClose = true;
        j += 2;
        break;
      }
      const am = /^([^\s=/>]+)\s*(=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/.exec(html.slice(j));
      if (!am) {
        j++;
        continue;
      }
      const key = am[1].toLowerCase();
      let val = '';
      if (am[2] !== undefined)
        val =
          am[4] !== undefined
            ? am[4]
            : am[5] !== undefined
              ? am[5]
              : am[6] !== undefined
                ? am[6]
                : '';
      attrs[key] = decodeText(val);
      j += am[0].length;
    }
    const el = new El(tag, doc);
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    top().appendChild(el);
    i = j;
    if (RAW.has(tag) && !selfClose) {
      const cm = new RegExp('</' + tag + '\\s*>', 'i').exec(html.slice(i));
      const rawEnd = cm ? i + cm.index : n;
      const text = html.slice(i, rawEnd);
      if (text) el.appendChild(new TextNode(text));
      i = cm ? rawEnd + cm[0].length : n;
      continue;
    }
    if (!selfClose && !VOID.has(tag)) stack.push(el);
  }
  return root.childNodes.slice();
}

function parseDocument(html, doc) {
  const nodes = parseNodes(html, doc);
  for (const nd of nodes) doc.appendChild(nd);
  return doc;
}

/* ---- селекторы: #id, .cls, tag, [a=b], a b, a>b, списки через запятую ---- */
function parseSelector(sel) {
  return String(sel)
    .split(',')
    .map(part => {
      const str = part.trim();
      const tokens = [];
      const re = /([>+~])|(\s+)|([#.]?[a-zA-Z_*][-a-zA-Z0-9_*]*(?:\[[^\]]+\])?|\[[^\]]+\]|[*])/g;
      let m,
        pending = null;
      while ((m = re.exec(str))) {
        if (m[1]) {
          pending = m[1];
          continue;
        }
        if (m[2]) {
          if (!pending) pending = ' ';
          continue;
        }
        tokens.push({ sel: m[3], comb: tokens.length ? pending || ' ' : null });
        pending = null;
      }
      return tokens;
    })
    .filter(t => t.length);
}

function matchSimple(el, s) {
  if (!el || el.nodeType !== 1) return false;
  const parts = String(s).split(/(?=[.#\[])/);
  for (const p of parts) {
    if (!p) continue;
    if (p === '*') continue;
    if (p[0] === '#') {
      if (el.id !== p.slice(1)) return false;
    } else if (p[0] === '.') {
      if (!el.classList.contains(p.slice(1))) return false;
    } else if (p[0] === '[') {
      const inner = p.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (!el.hasAttribute(inner.trim())) return false;
      } else {
        const name = inner.slice(0, eq).trim();
        const val = inner
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (el.getAttribute(name) !== val) return false;
      }
    } else if (el.localName !== p.toLowerCase()) return false;
  }
  return true;
}

/* сопоставление цепочки селекторов справа налево */
function matchChain(el, tokens, i) {
  if (!el || el.nodeType !== 1) return false;
  if (!matchSimple(el, tokens[i].sel)) return false;
  if (i === 0) return true;
  const comb = tokens[i].comb || ' ';
  if (comb === '>') return matchChain(el.parentElement, tokens, i - 1);
  if (comb === '+') return matchChain(el.previousSibling, tokens, i - 1);
  for (let p = el.parentElement; p && p.nodeType === 1; p = p.parentElement)
    if (matchChain(p, tokens, i - 1)) return true;
  return false;
}

function matchSelector(el, sel) {
  for (const tokens of parseSelector(sel))
    if (matchChain(el, tokens, tokens.length - 1)) return true;
  return false;
}

function queryAll(rootEl, sel) {
  const groups = parseSelector(sel);
  const out = [];
  const seen = new Set();
  const walk = el => {
    for (const c of el.childNodes) {
      if (c.nodeType !== 1) continue;
      for (const tokens of groups) {
        if (matchChain(c, tokens, tokens.length - 1)) {
          if (!seen.has(c._uid)) {
            seen.add(c._uid);
            out.push(c);
          }
          break;
        }
      }
      walk(c);
    }
  };
  walk(rootEl);
  return out;
}

module.exports = {
  El,
  TextNode,
  ClassList,
  Style,
  parseNodes,
  parseDocument,
  serialize,
  makeEvent,
  dispatch,
  matchSelector,
  queryAll,
  decodeText,
  encodeText,
  handlerErrors: HANDLER_ERRORS
};
