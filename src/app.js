import {
  initData,
  getData,
  subscribe,
  addTaskRecord,
  updateTask,
  deleteTask,
  addProject,
  updateProject,
  updateWorkspaceNotes,
  setActiveNotesPage,
  addNotesPage,
  removeNotesPage,
  reorderNotesPages,
  addVoiceNote,
  updateVoiceNoteTitle,
  deleteVoiceNote,
} from './storage/data-store.js';
import { discardRecording } from './components/voice-recorder.js';
import { createTask } from './models/task.js';
import { renderViewTabs } from './components/view-tabs.js';
import { renderTasksView } from './views/tasks-view.js';
import { renderProjectsView } from './views/projects-view.js';
import { sumRemainingMinutesDueOn, formatMinutes } from './utils/time.js';
import { isDevBrowserMode } from './storage/storage-adapter.js';
import { todayISO } from './utils/dates.js';

const ui = {
  tab: 'tasks',
  focus: null,
  focusProjectId: null,
  focusSelection: null,
  padViewDate: null,
  /** @type {Set<string>} */
  projectExpanded: new Set(),
  notesOpen: false,
  notesFocusOnOpen: false,
};

function buildShell(root) {
  root.innerHTML = `
    <div class="app-bg" aria-hidden="true"></div>
    <div class="app-viewport">
      <div class="glass-chassis glass-chassis--focus">
        <div class="focus-app">
          <header class="focus-header">
            <span class="focus-brand">FocusDesk${isDevBrowserMode() ? ' · dev' : ''}</span>
          </header>
          <div class="focus-body">
            <div id="view-tabs-host" class="focus-tab-bar"></div>
            <div id="focus-main" class="focus-main focus-panel"></div>
            <button type="button" id="focus-notes-fab" class="focus-notes-fab" hidden aria-label="Open notes">
              <svg class="focus-notes-fab__icon focus-notes-fab__icon--notes" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v14l-4-2.5L11 19V5a2 2 0 0 1 2-2H7z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9 7h6M9 11h4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
              <svg class="focus-notes-fab__icon focus-notes-fab__icon--tasks" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M5 6h.01M5 12h.01M5 18h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    <footer class="focus-footer" aria-live="polite">
      <div class="focus-footer__pill" id="workload-footer">Remaining work —</div>
    </footer>
  `;
}

function taskHandlers() {
  return {
    onCreate: async (input, opts = {}) => {
      const task = createTask(input);
      const projectId = input.projectId ?? null;
      ui.focusProjectId = projectId;
      const collapsedProject =
        projectId && ui.tab === 'projects' && !ui.projectExpanded.has(projectId);
      if (opts.focusAfterCreate === false) {
        ui.focus = null;
        ui.focusSelection = null;
      } else if (collapsedProject) {
        ui.focus = 'draft';
        ui.focusSelection = { start: 0, end: 0 };
      } else {
        ui.focus = task.id;
        ui.focusSelection = opts.selection ?? null;
      }
      await addTaskRecord(task);
      return task;
    },
    onUpdate: (id, patch, opts) => updateTask(id, patch, opts),
    onDelete: (id) => deleteTask(id),
    onToggle: (id, completed) => updateTask(id, { completed }),
    onRequestFocus: (id) => {
      if (typeof id === 'object') {
        ui.focus = id.taskId;
        ui.focusProjectId = id.projectId ?? null;
        ui.focusSelection =
          id.selectionStart != null
            ? { start: id.selectionStart, end: id.selectionEnd ?? id.selectionStart }
            : null;
      } else {
        ui.focus = id;
        ui.focusProjectId = null;
        ui.focusSelection = null;
      }
      render();
    },
    onCreateProject: async (name) => {
      await addProject(name);
      ui.tab = 'projects';
      render();
    },
    onUpdateProject: (id, patch) => updateProject(id, patch),
    onPadViewDate: (dateISO) => {
      ui.padViewDate = dateISO;
      render();
    },
    onToggleProjectExpanded: (projectId) => {
      if (ui.projectExpanded.has(projectId)) ui.projectExpanded.delete(projectId);
      else ui.projectExpanded.add(projectId);
      render();
    },
    onNotesChange: (text, pageId) => updateWorkspaceNotes(text, { pageId, notify: false }),
    onNotesPageSwitch: async (currentText, fromPageId, toPageId) => {
      if (fromPageId) {
        await updateWorkspaceNotes(currentText, { pageId: fromPageId, notify: false });
      }
      await setActiveNotesPage(toPageId);
      ui.notesFocusOnOpen = true;
    },
    onNotesPageAdd: async (currentText, fromPageId) => {
      if (fromPageId) {
        await updateWorkspaceNotes(currentText, { pageId: fromPageId, notify: false });
      }
      await addNotesPage();
      ui.notesFocusOnOpen = true;
    },
    onNotesPageRemove: async (currentText, fromPageId, pageId) => {
      if (fromPageId) {
        await updateWorkspaceNotes(currentText, { pageId: fromPageId, notify: false });
      }
      await removeNotesPage(pageId);
      ui.notesFocusOnOpen = true;
    },
    onNotesPageReorder: async (currentText, fromPageId, orderedPageIds) => {
      if (fromPageId) {
        await updateWorkspaceNotes(currentText, { pageId: fromPageId, notify: false });
      }
      await reorderNotesPages(orderedPageIds);
      ui.notesFocusOnOpen = true;
    },
    onVoiceNoteSave: (preview) =>
      addVoiceNote({
        blob: preview.blob,
        mimeType: preview.mimeType,
        durationMs: preview.durationMs,
      }),
    onVoiceNoteRename: (id, title) => updateVoiceNoteTitle(id, title),
    onVoiceNoteDelete: (id) => deleteVoiceNote(id),
  };
}

function render() {
  const data = getData();
  const tabsHost = document.getElementById('view-tabs-host');
  const main = document.getElementById('focus-main');
  const footer = document.getElementById('workload-footer');
  if (!tabsHost || !main) return;

  let notesDraft;
  let notesSelection;
  if (ui.tab === 'tasks' && ui.notesOpen) {
    const notesEditor = main.querySelector('.notes-editor');
    if (notesEditor) {
      notesDraft = {
        pageId: notesEditor.dataset.pageId,
        value: notesEditor.value,
      };
      if (document.activeElement === notesEditor) {
        notesSelection = {
          start: notesEditor.selectionStart,
          end: notesEditor.selectionEnd,
        };
      }
    }
  }

  if (!ui.focus) {
    const activeInput = main.querySelector('.notepad-row__input:focus');
    if (activeInput) {
      const row = activeInput.closest('.notepad-row');
      const tid = row?.dataset?.taskId;
      if (row?.classList.contains('notepad-row--draft') || tid === 'draft') {
        ui.focus = 'draft';
      } else if (tid) {
        ui.focus = tid;
      }
      ui.focusSelection = {
        start: activeInput.selectionStart,
        end: activeInput.selectionEnd,
      };
    }
  }

  renderViewTabs(tabsHost, {
    active: ui.tab,
    onChange: (tab) => {
      ui.tab = tab;
      ui.focus = null;
      ui.focusProjectId = null;
      if (tab !== 'tasks') {
        ui.notesOpen = false;
        discardRecording();
      }
      render();
    },
  });

  const notesFab = document.getElementById('focus-notes-fab');
  if (notesFab) {
    const onTasks = ui.tab === 'tasks';
    notesFab.hidden = !onTasks;
    notesFab.classList.toggle('focus-notes-fab--notes-mode', onTasks && ui.notesOpen);
    notesFab.setAttribute('aria-pressed', onTasks && ui.notesOpen ? 'true' : 'false');
    notesFab.setAttribute(
      'aria-label',
      ui.notesOpen ? 'Back to tasks' : 'Open notes'
    );
  }

  const handlers = taskHandlers();
  const padViewDate = ui.padViewDate || todayISO();
  const ctx = {
    data,
    focusTaskId: ui.focus,
    padViewDate,
    handlers,
  };

  main.className = 'focus-main focus-panel focus-panel--workspace';
  if (ui.tab === 'tasks') {
    renderTasksView(main, {
      ...ctx,
      notesDraft,
      notesSelection,
      notesOpen: ui.notesOpen,
      notesFocusOnOpen: ui.notesFocusOnOpen,
    });
    ui.notesFocusOnOpen = false;
  } else if (ui.tab === 'projects') {
    renderProjectsView(main, {
      ...ctx,
      focusTaskId: ui.focus,
      focusProjectId: ui.focusProjectId,
      projectExpanded: ui.projectExpanded,
    });
  }

  const cap = data.settings?.dailyHourCap ?? 7;
  const capMinutes = cap * 60;
  const today = todayISO();
  const remaining = sumRemainingMinutesDueOn(data.tasks, today);
  const remLabel = remaining ? formatMinutes(remaining) : '0m';
  if (footer) {
    footer.textContent = `${remLabel} / ${cap} Hours`;
    const overCap = remaining > capMinutes;
    footer.classList.toggle('focus-footer__pill--over-cap', overCap);
    footer.dataset.overCap = overCap ? 'true' : 'false';
  }

  const focus = ui.focus;
  const focusSelection = ui.focusSelection;
  const focusProjectId = ui.focusProjectId;
  ui.focus = null;
  ui.focusSelection = null;
  if (focus) {
    requestAnimationFrame(() => {
      const projectDraftSel = focusProjectId
        ? `[data-project-id="${CSS.escape(focusProjectId)}"] .notepad-row--draft .notepad-row__input`
        : null;
      let row =
        focus === 'draft' && projectDraftSel
          ? main.querySelector(projectDraftSel)
          : focus === 'draft'
            ? main.querySelector('.notepad-row--draft .notepad-row__input')
            : main.querySelector(`[data-task-id="${CSS.escape(focus)}"] .notepad-row__input`);
      if (!row && projectDraftSel) {
        row = main.querySelector(projectDraftSel);
      }
      if (!row) return;
      row.focus();
      if (focusSelection) {
        const len = row.value.length;
        const start = Math.min(focusSelection.start, len);
        const end = Math.min(focusSelection.end, len);
        row.setSelectionRange(start, end);
      } else if (focus !== 'draft') {
        row.setSelectionRange(row.value.length, row.value.length);
      }
    });
  }
}

async function bootstrap() {
  const root = document.getElementById('app');
  try {
    await initData();
    buildShell(root);
    document.getElementById('focus-notes-fab')?.addEventListener('click', () => {
      if (ui.tab !== 'tasks') return;
      if (ui.notesOpen) discardRecording();
      ui.notesOpen = !ui.notesOpen;
      if (ui.notesOpen) {
        ui.notesFocusOnOpen = true;
        ui.focus = null;
        ui.focusProjectId = null;
      }
      render();
    });
    subscribe(() => render());
    render();
  } catch (e) {
    root.innerHTML = `<div class="app-error"><h2>Could not load FocusDesk</h2><p>${e.message}</p></div>`;
  }
}

bootstrap();
