import { sortTasks, applyTaskFilter } from '../models/task.js';
import { timeButtonLabel, openTimePicker } from './time-picker.js';
import { openProjectPicker, openDuePicker, dueChipLabel } from './meta-picker.js';
import { isOverdue, taskVisibleOnMyPad, todayISO } from '../utils/dates.js';
import { closeOpenPopover } from './popover.js';

/** Ruled lines shown on My Pad (matches default CSS min height). */
export const MY_PAD_MIN_LINES = 7;

/** Debounced title saves keyed by task — cleared when a row re-mounts. */
const pendingTitleTimers = new Map();

function clearPendingTitleSave(taskId) {
  const t = pendingTitleTimers.get(taskId);
  if (t) {
    clearTimeout(t);
    pendingTitleTimers.delete(taskId);
  }
}

function readTaskTitleInput(taskId) {
  const row = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] .notepad-row__input`);
  return row?.value ?? null;
}

export function renderNotepadList(
  container,
  {
    taskIds,
    data,
    onCreate,
    onUpdate,
    onDelete,
    onToggle,
    placeholder = 'Type a task…',
    showMeta = true,
    focusTaskId = null,
    draftProjectId = null,
    onRequestFocus = null,
    padMode = false,
    showPadMeta = true,
    showPadProjectChip = true,
    padMinLines = MY_PAD_MIN_LINES,
    padTasksOnly = false,
    promoteOnInput = true,
  }
) {
  container.innerHTML = '';
  container.className = padMode
    ? `notepad-list notepad-list--pad${padTasksOnly ? ' notepad-list--pad-tasks-only' : ''}`
    : 'notepad-list';
  const list = document.createElement('ul');
  list.className = 'notepad-list__ul';
  list.setAttribute('role', 'list');

  function projectName(id) {
    return id ? data.projects[id]?.name : '';
  }

  function createPendingMeta() {
    return {
      dueDate: null,
      projectId: draftProjectId ?? null,
      estimatedMinutes: null,
    };
  }

  function appendRow(task, { isDraft = false, isSlot = false, slotIndex = null } = {}) {
    const li = document.createElement('li');
    li.className = 'notepad-row';
    const isEmptyLine = isDraft || isSlot;
    const pendingMeta = isEmptyLine ? createPendingMeta() : null;

    const syncPendingRowChrome = () => {
      if (!pendingMeta) return;
      const hasText = Boolean(input.value.trim());
      const hasMetaFields = Boolean(pendingMeta.dueDate || pendingMeta.projectId);
      li.classList.toggle('notepad-row--has-meta', hasMetaFields || hasText);
      li.classList.toggle('notepad-row--has-time', Boolean(pendingMeta.estimatedMinutes));
    };

    function mountDueChip(padStyle) {
      const dueBtn = document.createElement('button');
      dueBtn.type = 'button';
      dueBtn.className = padStyle
        ? 'notepad-row__chip notepad-row__chip--pad'
        : 'notepad-row__chip';
      const refresh = () => {
        const due = task?.dueDate ?? pendingMeta?.dueDate ?? null;
        const dueLabel = dueChipLabel(due);
        dueBtn.textContent = dueLabel || '+ date';
        dueBtn.classList.toggle('notepad-row__chip--muted', !dueLabel);
      };
      refresh();
      dueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDuePicker(dueBtn, {
          dueDate: task?.dueDate ?? pendingMeta?.dueDate ?? null,
          onSelect: (v) => {
            if (task) onUpdate(task.id, { dueDate: v });
            else if (pendingMeta) {
              pendingMeta.dueDate = v;
              refresh();
              syncPendingRowChrome();
            }
          },
        });
      });
      return dueBtn;
    }

    function mountProjectChip(padStyle) {
      const projBtn = document.createElement('button');
      projBtn.type = 'button';
      projBtn.className = padStyle
        ? 'notepad-row__chip notepad-row__chip--pad'
        : 'notepad-row__chip';
      const refresh = () => {
        const pid = task?.projectId ?? pendingMeta?.projectId ?? null;
        const pn = projectName(pid);
        projBtn.textContent = pn || '+ project';
        projBtn.classList.toggle('notepad-row__chip--muted', !pn);
      };
      refresh();
      projBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectPicker(projBtn, {
          data,
          task: task ?? { projectId: pendingMeta?.projectId ?? null },
          onSelect: (projectId) => {
            if (task) onUpdate(task.id, { projectId });
            else if (pendingMeta) {
              pendingMeta.projectId = projectId;
              refresh();
              syncPendingRowChrome();
            }
          },
        });
      });
      return projBtn;
    }
    if (task?.completed) li.classList.add('notepad-row--done');
    if (task && isOverdue(task.dueDate, task.completed)) li.classList.add('notepad-row--overdue');
    if (task && (task.dueDate || (showPadProjectChip && task.projectId))) {
      li.classList.add('notepad-row--has-meta');
    }
    if (task?.estimatedMinutes) li.classList.add('notepad-row--has-time');
    if (isDraft) {
      li.classList.add('notepad-row--draft');
      li.dataset.taskId = 'draft';
    }
    if (isSlot) {
      li.classList.add('notepad-row--slot');
      if (slotIndex != null) li.dataset.slotIndex = String(slotIndex);
    }

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'notepad-row__check';
    if (!isEmptyLine && task) {
      check.setAttribute('aria-label', task.completed ? 'Mark incomplete' : 'Mark complete');
      check.setAttribute('aria-pressed', task.completed ? 'true' : 'false');
      check.innerHTML = task.completed
        ? '<span class="notepad-row__check-icon notepad-row__check-icon--on" aria-hidden="true"></span>'
        : '<span class="notepad-row__check-icon" aria-hidden="true"></span>';
      check.addEventListener('click', () => onToggle(task.id, !task.completed));
    } else {
      check.disabled = true;
      check.classList.add('notepad-row__check--ghost');
      check.innerHTML = '<span class="notepad-row__check-icon" aria-hidden="true"></span>';
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'notepad-row__input';
    input.placeholder = isEmptyLine ? placeholder : '';
    input.value = task?.title ?? '';
    input.setAttribute(
      'aria-label',
      isDraft ? 'New task' : isSlot ? 'Empty line — add task' : 'Task title'
    );

    const meta = document.createElement('div');
    meta.className = 'notepad-row__meta';

    const showProjectMeta = !padMode && showMeta;
    const showPadMetaRow = padMode && showPadMeta;

    if (showProjectMeta && (task || isEmptyLine)) {
      meta.append(mountDueChip(false));
      meta.append(mountProjectChip(false));
    }

    if (showPadMetaRow && (task || isEmptyLine)) {
      const dueBtn = mountDueChip(true);
      if (showPadProjectChip) {
        meta.append(dueBtn, mountProjectChip(true));
      } else {
        meta.append(dueBtn);
      }
    }

    const timeBtn = document.createElement('button');
    timeBtn.type = 'button';
    timeBtn.className = 'notepad-row__time';
    if (!isEmptyLine && task) {
      timeBtn.textContent = timeButtonLabel(task.estimatedMinutes);
      timeBtn.classList.toggle('notepad-row__time--empty', !task.estimatedMinutes);
      timeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTimePicker(timeBtn, {
          minutes: task.estimatedMinutes,
          onSelect: (m) => onUpdate(task.id, { estimatedMinutes: m }),
        });
      });
    } else if (isEmptyLine && (showProjectMeta || showPadMetaRow)) {
      timeBtn.textContent = timeButtonLabel(pendingMeta.estimatedMinutes);
      timeBtn.classList.toggle('notepad-row__time--empty', !pendingMeta.estimatedMinutes);
      timeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTimePicker(timeBtn, {
          minutes: pendingMeta.estimatedMinutes,
          onSelect: (m) => {
            pendingMeta.estimatedMinutes = m;
            timeBtn.textContent = timeButtonLabel(m);
            timeBtn.classList.toggle('notepad-row__time--empty', !m);
            syncPendingRowChrome();
          },
        });
      });
    } else {
      timeBtn.classList.add('notepad-row__time--ghost');
      timeBtn.tabIndex = -1;
    }

    input.addEventListener('input', () => {
      syncPendingRowChrome();
      if (isEmptyLine) {
        if (promoteOnInput) void promoteEmptyLineIfNeeded();
        return;
      }
      if (task) {
        scheduleTitleSave();
      }
    });

    let promotePromise = null;

    function flushTitleSave({ notify = true } = {}) {
      if (!task) return;
      clearPendingTitleSave(task.id);
      const title = input.isConnected ? input.value : readTaskTitleInput(task.id);
      if (title == null) return;
      void onUpdate(task.id, { title }, { notify });
    }

    function scheduleTitleSave() {
      if (!task) return;
      clearPendingTitleSave(task.id);
      const taskId = task.id;
      pendingTitleTimers.set(
        taskId,
        setTimeout(() => {
          pendingTitleTimers.delete(taskId);
          const title = readTaskTitleInput(taskId);
          if (title == null) return;
          void onUpdate(taskId, { title }, { notify: false });
        }, 320)
      );
    }

    if (task?.id) clearPendingTitleSave(task.id);

    async function promoteEmptyLineIfNeeded() {
      if (!isEmptyLine || !onCreate) return null;
      if (!input.value) return null;
      if (promotePromise) return promotePromise;
      promotePromise = (async () => {
        const selection = { start: input.selectionStart, end: input.selectionEnd };
        return onCreate(
          {
            title: input.value,
            order: Date.now(),
            projectId: pendingMeta?.projectId ?? draftProjectId,
            dueDate: pendingMeta?.dueDate ?? null,
            estimatedMinutes: pendingMeta?.estimatedMinutes ?? null,
          },
          { selection }
        );
      })();
      try {
        return await promotePromise;
      } finally {
        promotePromise = null;
      }
    }

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        input.blur();
        closeOpenPopover();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isEmptyLine) {
          if (!input.value.trim()) return;
          await promoteEmptyLineIfNeeded();
          if (padTasksOnly || !onCreate) return;
          if (draftProjectId) {
            onRequestFocus?.({
              projectId: draftProjectId,
              taskId: 'draft',
              selectionStart: 0,
              selectionEnd: 0,
            });
            return;
          }
          const created = await onCreate({
            title: '',
            order: Date.now(),
            projectId: draftProjectId ?? null,
          });
          onRequestFocus?.(created.id);
          return;
        }
        await onUpdate(task.id, { title: input.value });
        flushTitleSave({ notify: true });
        if (padTasksOnly) return;
        const created = await onCreate({
          title: '',
          order: Date.now(),
          projectId: task.projectId,
        });
        onRequestFocus?.(created.id);
      }
      if (e.key === 'Backspace' && !input.value && !isEmptyLine) {
        e.preventDefault();
        const idx = taskIds.indexOf(task.id);
        await onDelete(task.id);
        const prevId = idx > 0 ? taskIds[idx - 1] : padTasksOnly ? taskIds[0] : 'draft';
        onRequestFocus?.(prevId);
      }
    });

    input.addEventListener('blur', () => {
      if (isEmptyLine) {
        void promoteEmptyLineIfNeeded();
        return;
      }
      const title = input.value.trim();
      if (!title) {
        clearPendingTitleSave(task.id);
        onDelete(task.id);
        return;
      }
      flushTitleSave({ notify: true });
    });

    li.append(check, input, meta, timeBtn);
    if (task?.id) li.dataset.taskId = task.id;
    list.appendChild(li);

    return input;
  }

  const padLineCount = padMode
    ? padTasksOnly
      ? Math.max(1, taskIds.length)
      : Math.max(padMinLines, taskIds.length + 1)
    : 0;

  for (const id of taskIds) {
    const task = data.tasks[id];
    if (task) appendRow(task);
  }

  if (padMode && !padTasksOnly) {
    appendRow(null, { isDraft: true });
    const rowCount = taskIds.length + 1;
    for (let i = rowCount; i < padLineCount; i += 1) {
      appendRow(null, { isSlot: true, slotIndex: i });
    }
    container.style.setProperty('--pad-min-lines', String(padLineCount));
    const sheet = container.closest('.my-pad-sheet');
    sheet?.style.setProperty('--pad-min-lines', String(padLineCount));
  } else if (padMode && padTasksOnly) {
    container.style.setProperty('--pad-min-lines', String(padLineCount));
    const sheet = container.closest('.my-pad-sheet');
    sheet?.style.setProperty('--pad-min-lines', String(padLineCount));
  } else {
    appendRow(null, { isDraft: true });
  }

  container.appendChild(list);
}

/** Focus the input on the ruled line nearest a click (My Pad). */
export function focusMyPadLineFromClick(sheet, clientY) {
  const rows = sheet.querySelectorAll('.notepad-row');
  if (!rows.length) return;
  const styles = getComputedStyle(sheet);
  const lineH = parseFloat(styles.getPropertyValue('--pad-line')) || 42;
  const padTop = parseFloat(styles.paddingTop) || 0;
  const rect = sheet.getBoundingClientRect();
  const y = clientY - rect.top - padTop;
  let idx = Math.floor(y / lineH);
  idx = Math.max(0, Math.min(idx, rows.length - 1));
  rows[idx].querySelector('.notepad-row__input')?.focus();
}

export function myPadTaskIds(data, { filter = 'all', viewDate = todayISO() } = {}) {
  return sortTasks(data.tasks)
    .filter((t) => taskVisibleOnMyPad(t, viewDate))
    .filter((t) => applyTaskFilter(t, filter))
    .map((t) => t.id);
}

export function projectTaskIds(data, projectId) {
  return sortTasks(data.tasks, { projectId }).map((t) => t.id);
}

const PROJECT_COLLAPSED_ACTIVE_LIMIT = 2;

/** Tasks shown on a project card when collapsed (active only, capped). */
export function visibleProjectTaskIds(data, projectId, { expanded = false } = {}) {
  const sorted = sortTasks(data.tasks, { projectId });
  if (expanded) return sorted.map((t) => t.id);
  const active = sorted.filter((t) => !t.completed);
  return active.slice(-PROJECT_COLLAPSED_ACTIVE_LIMIT).map((t) => t.id);
}

export function projectCardCanCollapse(data, projectId) {
  const sorted = sortTasks(data.tasks, { projectId });
  const active = sorted.filter((t) => !t.completed);
  const hasCompleted = sorted.some((t) => t.completed);
  return active.length > PROJECT_COLLAPSED_ACTIVE_LIMIT || hasCompleted;
}

export { PROJECT_COLLAPSED_ACTIVE_LIMIT };
