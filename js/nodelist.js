import { Data } from './data.js';
import { getState, isLit, isClaimed } from './store.js';
import { escapeHtml, trapFocus } from './util.js';

const statusLabel = { lit: '已点亮', claimed: '待验证', unlit: '未点亮' };

function statusOf(node) {
  if (isLit(node.id)) return 'lit';
  if (isClaimed(node.id)) return 'claimed';
  return 'unlit';
}

export function openNodeList({ onSelect } = {}) {
  const root = document.getElementById('modal-root');
  const previous = document.activeElement;
  const state = getState();
  const litCount = Object.keys(state.lit).length;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop nodelist-backdrop';
  overlay.innerHTML = `
    <div class="modal nodelist-modal" role="dialog" aria-modal="true" aria-labelledby="nl-title">
      <button class="modal-close" data-act="close" aria-label="关闭">✕</button>
      <header class="modal-head">
        <span class="eyebrow">节点清单</span>
        <h2 id="nl-title">全部知识点</h2>
        <p class="modal-sub">共 ${Data.nodes.length} 个节点 · 已点亮 ${litCount} · 支持搜索与键盘选择</p>
      </header>
      <div class="nl-tools">
        <input class="nl-search" id="nl-search" type="search" placeholder="搜索知识点 / 星系" aria-label="搜索知识点" autocomplete="off">
        <div class="nl-filters" role="group" aria-label="按状态筛选">
          <button class="nl-filter active" data-filter="all" aria-pressed="true">全部</button>
          <button class="nl-filter" data-filter="unlit" aria-pressed="false">未点亮</button>
          <button class="nl-filter" data-filter="claimed" aria-pressed="false">待验证</button>
          <button class="nl-filter" data-filter="lit" aria-pressed="false">已点亮</button>
        </div>
      </div>
      <div class="nl-body" id="nl-body"></div>
      <div class="nl-empty" id="nl-empty" hidden>没有匹配的知识点</div>
      <p class="nl-hint">↑↓ 移动焦点 · Enter 打开 · Esc 关闭</p>
    </div>`;
  root.appendChild(overlay);

  const body = overlay.querySelector('#nl-body');
  const empty = overlay.querySelector('#nl-empty');
  const search = overlay.querySelector('#nl-search');
  let filter = 'all';
  let query = '';

  function render() {
    const q = query.trim().toLowerCase();
    let shown = 0;
    const html = Data.galaxies.map(g => {
      const nodes = Data.nodes
        .filter(n => n.galaxy === g.id)
        .filter(n => filter === 'all' || statusOf(n) === filter)
        .filter(n => {
          if (!q) return true;
          return n.name.toLowerCase().includes(q)
            || g.name.toLowerCase().includes(q)
            || String(n.description || '').toLowerCase().includes(q);
        })
        .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name, 'zh'));

      if (!nodes.length) return '';
      shown += nodes.length;
      return `
        <section class="nl-group">
          <h3><i style="background:${g.color}"></i>${escapeHtml(g.name)}<em>${nodes.length}</em></h3>
          ${nodes.map(n => {
            const st = statusOf(n);
            return `<button class="nl-item ${st}" data-id="${escapeHtml(n.id)}">
              <span class="nl-dot" style="background:${g.color}"></span>
              <span class="nl-name">${escapeHtml(n.name)}</span>
              <span class="nl-imp" aria-label="重要度 ${n.importance} 级">★${n.importance}</span>
              <span class="nl-badge">${statusLabel[st]}</span>
            </button>`;
          }).join('')}
        </section>`;
    }).join('');

    body.innerHTML = html;
    body.hidden = shown === 0;
    empty.hidden = shown !== 0;
  }

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (previous && previous.focus) previous.focus();
  };

  const onKey = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...body.querySelectorAll('.nl-item')];
      if (!items.length) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement);
      const step = e.key === 'ArrowDown' ? 1 : items.length - 1;
      const next = index === -1 ? items[0] : items[(index + step) % items.length];
      next.focus();
      return;
    }
    trapFocus(overlay.querySelector('.nodelist-modal'), e);
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) {
      close();
      return;
    }
    const filterBtn = e.target.closest('.nl-filter');
    if (filterBtn) {
      filter = filterBtn.dataset.filter;
      overlay.querySelectorAll('.nl-filter').forEach(btn => {
        const on = btn === filterBtn;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
      return;
    }
    const item = e.target.closest('.nl-item');
    if (!item) return;
    const id = item.dataset.id;
    close();
    if (onSelect) onSelect(id);
  });

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const first = body.querySelector('.nl-item');
    if (!first) return;
    e.preventDefault();
    first.click();
  });

  document.addEventListener('keydown', onKey, true);
  render();
  requestAnimationFrame(() => search.focus());
}
