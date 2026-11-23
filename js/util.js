export const TAU = Math.PI * 2;
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const nowSec = () => (reduceMotion ? 0 : performance.now() / 1000);

export function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function starsHtml(value, max = 5) {
  let out = '';
  for (let i = 0; i < max; i++) out += `<i class="${i < value ? 'on' : ''}"></i>`;
  return `<span class="mini-stars" aria-label="重要度 ${value} / ${max}">${out}</span>`;
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 280);
  }, 2400);
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const items = [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function confirmDialog({ title, message, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop confirm-backdrop';
    overlay.innerHTML = `
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cf-title">
        <h2 id="cf-title">${escapeHtml(title)}</h2>
        <p class="confirm-text">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    root.appendChild(overlay);

    const finish = ok => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous && previous.focus) previous.focus();
      resolve(ok);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else trapFocus(overlay.querySelector('.confirm-modal'), e);
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(false);
      const act = e.target.closest('[data-act]');
      if (act) finish(act.dataset.act === 'ok');
    });
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      const target = overlay.querySelector('[data-act="ok"]');
      if (target) target.focus();
    });
  });
}
