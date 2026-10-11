import { mountMyPadDateControl } from '../components/my-pad-date.js';
import {
  renderNotepadList,
  myPadTaskIds,
  focusMyPadLineFromClick,
  MY_PAD_MIN_LINES,
} from '../components/notepad-list.js';
import { todayISO, formatDueLabel } from '../utils/dates.js';
import { renderTasksNotesPanel } from './notes-view.js';

export function renderTasksView(container, ctx) {
  const { notesOpen } = ctx;
  if (notesOpen) {
    renderTasksNotesPanel(container, ctx);
    return;
  }

  const { data, focusTaskId, padViewDate, handlers } = ctx;
  const viewDate = padViewDate || todayISO();
  const isPadToday = viewDate === todayISO();
  const ids = myPadTaskIds(data, { viewDate });
  const padTasks = ids.map((id) => data.tasks[id]).filter(Boolean);
  const completed = padTasks.filter((t) => t.completed).length;
  const total = padTasks.length;
  const percent = total && isPadToday ? Math.round((completed / total) * 100) : completed ? 100 : 0;

  container.innerHTML = '';
  container.className = 'focus-view focus-view--tasks';

  const stack = document.createElement('div');
  stack.className = 'project-stack';

  const padCard = document.createElement('section');
  padCard.className = 'project-card';

  const head = document.createElement('header');
  head.className = 'project-card__head';

  const titleRow = document.createElement('div');
  titleRow.className = 'project-card__title-row';

  const title = document.createElement('h2');
  title.className = 'project-card__title';
  title.textContent = 'My Pad';

  const titleTools = document.createElement('div');
  titleTools.className = 'project-card__title-tools';
  mountMyPadDateControl(titleTools, {
    viewDate,
    onChange: handlers.onPadViewDate,
  });

  const stat = document.createElement('span');
  stat.className = 'project-card__stat';
  if (isPadToday) {
    stat.textContent = total > 0 ? `${completed}/${total} done` : 'Empty';
  } else {
    stat.textContent =
      completed > 0
        ? `${completed} done · ${formatDueLabel(viewDate, 'picker')}`
        : `None · ${formatDueLabel(viewDate, 'picker')}`;
  }

  titleRow.append(title, titleTools, stat);
  head.appendChild(titleRow);

  if (isPadToday && total > 0) {
    const progress = document.createElement('div');
    progress.className = 'project-card__progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-label', `${percent}% of tasks complete`);
    progress.innerHTML = `<div class="project-card__progress-fill" style="width:${percent}%"></div>`;
    head.appendChild(progress);
  }

  padCard.appendChild(head);

  const sheet = document.createElement('div');
  sheet.className = 'project-card__sheet my-pad-sheet focus-scroll';
  sheet.setAttribute('role', 'group');
  sheet.setAttribute(
    'aria-label',
    isPadToday ? 'Quick task notepad' : `Tasks completed on ${formatDueLabel(viewDate, 'picker')}`
  );

  const listHost = document.createElement('div');
  sheet.appendChild(listHost);
  padCard.appendChild(sheet);

  if (!isPadToday && total === 0) {
    listHost.innerHTML = `<p class="muted focus-empty my-pad-history-empty">No tasks completed on this date.</p>`;
  } else {
    renderNotepadList(listHost, {
      taskIds: ids,
      data,
      focusTaskId: isPadToday ? focusTaskId : null,
      padMode: true,
      padMinLines: isPadToday ? MY_PAD_MIN_LINES : Math.max(1, total),
      padTasksOnly: !isPadToday,
      showPadMeta: isPadToday,
      showPadProjectChip: true,
      onRequestFocus: handlers.onRequestFocus,
      onCreate: handlers.onCreate,
      onUpdate: handlers.onUpdate,
      onDelete: handlers.onDelete,
      onToggle: handlers.onToggle,
      placeholder: 'Type a task…',
      showMeta: true,
    });

    if (isPadToday) {
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('button, input, .focus-popover')) return;
        focusMyPadLineFromClick(sheet, e.clientY);
      });
    }
  }

  stack.appendChild(padCard);
  container.appendChild(stack);
}
