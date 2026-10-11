import { mountVoiceNotesUi, teardownVoiceNotesUi } from '../components/voice-notes-ui.js';
import { notesPageLabel } from '../models/notes-page.js';
import { getActiveNotesPage } from '../storage/data-store.js';

let saveTimer = null;
let suppressPageTabClickId = null;

const PAGE_DRAG_THRESHOLD_PX = 6;

function clearNotesPageDropHints(scroll) {
  scroll.querySelectorAll('.notes-page-tab').forEach((tab) => {
    tab.classList.remove('notes-page-tab--drop-before', 'notes-page-tab--drop-after');
  });
}

function attachNotesPageReorder(scroll, editor, handlers) {
  let drag = null;

  const endDrag = () => {
    if (!drag) return;
    const { tab, pointerId } = drag;
    try {
      tab.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    tab.classList.remove('notes-page-tab--dragging');
    scroll.classList.remove('notes-pages-bar__scroll--reordering');
    clearNotesPageDropHints(scroll);
    drag = null;
  };

  scroll.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const tab = event.target.closest('.notes-page-tab');
    if (!tab || event.target.closest('.notes-page-tab__remove')) return;
    drag = {
      tab,
      pageId: tab.dataset.pageId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      insertBefore: null,
    };
    tab.setPointerCapture(event.pointerId);
  });

  scroll.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.dragging) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dx + dy < PAGE_DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      drag.tab.classList.add('notes-page-tab--dragging');
      scroll.classList.add('notes-pages-bar__scroll--reordering');
    }

    const tabs = [...scroll.querySelectorAll('.notes-page-tab')];
    let insertBefore = null;
    for (const candidate of tabs) {
      if (candidate === drag.tab) continue;
      const rect = candidate.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (event.clientX < midX) {
        insertBefore = candidate;
        break;
      }
    }
    drag.insertBefore = insertBefore;
    clearNotesPageDropHints(scroll);
    if (insertBefore) insertBefore.classList.add('notes-page-tab--drop-before');
    else if (tabs.length) tabs[tabs.length - 1].classList.add('notes-page-tab--drop-after');
  });

  const finishPointer = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.dragging) {
      const tabs = [...scroll.querySelectorAll('.notes-page-tab')];
      const ids = tabs.map((t) => t.dataset.pageId);
      const from = ids.indexOf(drag.pageId);
      if (from !== -1) {
        ids.splice(from, 1);
        let to = drag.insertBefore
          ? ids.indexOf(drag.insertBefore.dataset.pageId)
          : ids.length;
        if (to < 0) to = ids.length;
        ids.splice(to, 0, drag.pageId);
        clearTimeout(saveTimer);
        suppressPageTabClickId = drag.pageId;
        void handlers.onNotesPageReorder(editor.value, editor.dataset.pageId, ids);
      }
    }
    endDrag();
  };

  scroll.addEventListener('pointerup', finishPointer);
  scroll.addEventListener('pointercancel', finishPointer);
}

function mountNotesPageBar(card, ctx, editor) {
  const { data, handlers } = ctx;
  const pages = data.notes?.pages ?? [];
  const activeId = data.notes?.activePageId;

  const bar = document.createElement('div');
  bar.className = 'notes-pages-bar';

  const scroll = document.createElement('div');
  scroll.className = 'notes-pages-bar__scroll focus-scroll';
  scroll.setAttribute('role', 'tablist');
  scroll.setAttribute('aria-label', 'Note pages');

  const canRemovePage = pages.length > 1;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const label = notesPageLabel(page, i);
    const tab = document.createElement('div');
    tab.className = `notes-page-tab${page.id === activeId ? ' notes-page-tab--active' : ''}`;
    tab.dataset.pageId = page.id;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'notes-page-tab__label';
    selectBtn.setAttribute('role', 'tab');
    selectBtn.setAttribute('aria-selected', page.id === activeId ? 'true' : 'false');
    selectBtn.textContent = label;
    selectBtn.addEventListener('click', () => {
      if (suppressPageTabClickId === page.id) {
        suppressPageTabClickId = null;
        return;
      }
      if (page.id === activeId) return;
      clearTimeout(saveTimer);
      void handlers.onNotesPageSwitch(editor.value, editor.dataset.pageId, page.id);
    });
    tab.appendChild(selectBtn);

    if (canRemovePage) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'notes-page-tab__remove';
      removeBtn.setAttribute('aria-label', `Remove ${label}`);
      removeBtn.title = `Remove ${label}`;
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        clearTimeout(saveTimer);
        void handlers.onNotesPageRemove(editor.value, editor.dataset.pageId, page.id);
      });
      tab.appendChild(removeBtn);
    }

    scroll.appendChild(tab);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'notes-pages-bar__add';
  addBtn.setAttribute('aria-label', 'New page');
  addBtn.title = 'New page';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    clearTimeout(saveTimer);
    void handlers.onNotesPageAdd(editor.value, editor.dataset.pageId);
  });

  attachNotesPageReorder(scroll, editor, handlers);

  bar.append(scroll, addBtn);
  const head = card.querySelector('.notes-card__head');
  head?.after(bar);

  requestAnimationFrame(() => {
    const activeTab = scroll.querySelector('.notes-page-tab--active');
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/** Full-height notes panel on the Tasks tab (replaces My Pad while open). */
export function renderTasksNotesPanel(container, ctx) {
  const { data, handlers, notesDraft, notesSelection, notesFocusOnOpen } = ctx;
  const activePage = getActiveNotesPage(data);
  let initial = activePage?.content ?? '';
  if (notesDraft?.pageId === activePage?.id && notesDraft.value != null) {
    initial = notesDraft.value;
  }

  cleanupTasksNotesPanel(container);
  container.innerHTML = '';
  container.className = 'focus-view focus-view--tasks focus-view--tasks-notes-mode';

  const card = document.createElement('section');
  card.className = 'notes-card notes-card--full';

  const head = document.createElement('header');
  head.className = 'notes-card__head';
  const title = document.createElement('h2');
  title.className = 'notes-card__title';
  title.textContent = 'Notes';
  head.appendChild(title);
  card.appendChild(head);

  const editor = document.createElement('textarea');
  editor.className = 'notes-editor focus-scroll';
  editor.dataset.pageId = activePage.id;
  editor.setAttribute('aria-label', 'Workspace notes');
  editor.placeholder = 'Jot ideas, links, or reminders…';
  editor.spellcheck = true;
  editor.value = initial;

  editor.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void handlers.onNotesChange(editor.value, editor.dataset.pageId);
    }, 400);
  });

  editor.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    void handlers.onNotesChange(editor.value, editor.dataset.pageId);
  });

  mountNotesPageBar(card, ctx, editor);
  card.appendChild(editor);
  mountVoiceNotesUi(card, ctx);
  container.appendChild(card);

  if (notesSelection && notesDraft?.pageId === activePage.id) {
    requestAnimationFrame(() => {
      editor.focus();
      const len = editor.value.length;
      const start = Math.min(notesSelection.start, len);
      const end = Math.min(notesSelection.end, len);
      editor.setSelectionRange(start, end);
    });
  } else if (notesFocusOnOpen) {
    requestAnimationFrame(() => {
      editor.focus();
      const len = editor.value.length;
      editor.setSelectionRange(len, len);
    });
  }
}

export function cleanupTasksNotesPanel(container) {
  const card = container?.querySelector('.notes-card');
  if (card) teardownVoiceNotesUi(card);
}
