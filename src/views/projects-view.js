import { sortProjects } from '../models/project.js';
import { projectProgress, formatMinutes } from '../utils/time.js';
import {
  renderNotepadList,
  projectTaskIds,
  visibleProjectTaskIds,
  projectCardCanCollapse,
  PROJECT_COLLAPSED_ACTIVE_LIMIT,
  focusMyPadLineFromClick,
} from '../components/notepad-list.js';

const PROJECT_PAD_LINES = 5;

const CHEVRON_SVG = `<svg class="project-card__expand-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderProjectsView(container, ctx) {
  const { data, focusTaskId, focusProjectId, projectExpanded, handlers } = ctx;
  const projects = sortProjects(data.projects);

  container.innerHTML = '';
  container.className = 'focus-view focus-view--projects';

  const stack = document.createElement('div');
  stack.className = 'project-stack focus-scroll';

  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'projects-empty muted';
    empty.textContent = 'No projects yet — add one below.';
    stack.appendChild(empty);
  }

  for (const project of projects) {
    const card = document.createElement('section');
    card.className = 'project-card';
    card.dataset.projectId = project.id;
    const prog = projectProgress(data.tasks, project.id);

    const head = document.createElement('header');
    head.className = 'project-card__head';

    const titleRow = document.createElement('div');
    titleRow.className = 'project-card__title-row';

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'project-card__title project-card__title-input';
    title.value = project.name;
    title.setAttribute('aria-label', 'Project name');
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        title.blur();
      }
      if (e.key === 'Escape') {
        title.value = project.name;
        title.blur();
      }
    });
    title.addEventListener('blur', () => {
      const name = title.value.trim();
      if (!name) {
        title.value = project.name;
        return;
      }
      if (name !== project.name) handlers.onUpdateProject(project.id, { name });
    });

    const stat = document.createElement('span');
    stat.className = 'project-card__stat';
    if (prog.total > 0) {
      stat.textContent = `${prog.completed}/${prog.total} done`;
      if (prog.remainingMinutes) {
        stat.title = `${formatMinutes(prog.remainingMinutes)} remaining`;
      }
    } else {
      stat.textContent = 'No tasks';
    }

    const expanded = projectExpanded?.has(project.id) ?? false;
    const canCollapse = projectCardCanCollapse(data, project.id);

    titleRow.append(title, stat);

    if (canCollapse) {
      card.classList.toggle('project-card--expanded', expanded);
      card.classList.toggle('project-card--collapsed', !expanded);
    }
    head.appendChild(titleRow);

    const progress = document.createElement('div');
    progress.className = 'project-card__progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuenow', String(prog.percent));
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute(
      'aria-label',
      prog.total > 0 ? `${prog.percent}% of tasks complete` : 'No tasks'
    );
    progress.innerHTML = `<div class="project-card__progress-fill" style="width:${prog.percent}%"></div>`;
    head.appendChild(progress);

    card.appendChild(head);

    const sheet = document.createElement('div');
    sheet.className = 'project-card__sheet my-pad-sheet';
    sheet.setAttribute('role', 'group');
    sheet.setAttribute('aria-label', `${project.name} tasks`);

    const listHost = document.createElement('div');
    sheet.appendChild(listHost);
    card.appendChild(sheet);

    const ids = expanded
      ? projectTaskIds(data, project.id)
      : visibleProjectTaskIds(data, project.id, { expanded: false });
    const visibleRows = ids.length + 1;
    renderNotepadList(listHost, {
      taskIds: ids,
      data,
      focusTaskId: focusProjectId === project.id ? focusTaskId : null,
      draftProjectId: project.id,
      padMode: true,
      padMinLines: expanded
        ? PROJECT_PAD_LINES
        : Math.max(PROJECT_COLLAPSED_ACTIVE_LIMIT + 1, Math.min(PROJECT_PAD_LINES, visibleRows)),
      showPadMeta: true,
      showPadProjectChip: false,
      onRequestFocus: (taskId) => handlers.onRequestFocus({ projectId: project.id, taskId }),
      onCreate: (input) => handlers.onCreate({ ...input, projectId: project.id }),
      onUpdate: handlers.onUpdate,
      onDelete: handlers.onDelete,
      onToggle: handlers.onToggle,
      placeholder: 'Type a new task…',
      showMeta: false,
      promoteOnInput: false,
    });

    sheet.addEventListener('click', (e) => {
      if (e.target.closest('button, input, .focus-popover')) return;
      focusMyPadLineFromClick(sheet, e.clientY);
    });

    if (canCollapse) {
      const footer = document.createElement('div');
      footer.className = 'project-card__footer';
      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'project-card__expand';
      expandBtn.innerHTML = CHEVRON_SVG;
      expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      expandBtn.setAttribute(
        'aria-label',
        expanded ? 'Collapse task list' : 'Expand task list'
      );
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onToggleProjectExpanded(project.id);
      });
      footer.appendChild(expandBtn);
      card.appendChild(footer);
    }

    stack.appendChild(card);
  }

  const newProject = document.createElement('div');
  newProject.className = 'new-project';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'new-project__input';
  input.placeholder = 'New project name — press Enter';
  input.setAttribute('aria-label', 'New project name');
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (!name) return;
      await handlers.onCreateProject(name);
      input.value = '';
    }
  });
  newProject.appendChild(input);
  stack.appendChild(newProject);

  container.appendChild(stack);
}
