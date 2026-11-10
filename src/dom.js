// Tiny DOM helper: h('div', { class: 'x', onclick }, child, ...). null / false children are skipped.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

// Replaces el's content. Like h(): arrays are flattened, null / false are skipped.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

let toastT = null;
export function toast(text, kind = '') {
  let el = document.querySelector('.toast');
  if (!el) document.body.append((el = h('div', { class: 'toast', role: 'status' })));
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), kind === 'warn' ? 6000 : 2600);
}

// A small centred sheet (works the same with a mouse and on a phone). Returns close().
export function sheet(title, body) {
  const close = () => wrap.remove();
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => e.target === wrap && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      body));
  document.body.append(wrap);
  return close;
}
