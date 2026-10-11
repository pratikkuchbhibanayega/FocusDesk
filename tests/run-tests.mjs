import assert from 'node:assert/strict';
import { parseTimeInput, formatMinutes, projectProgress, sumRemainingMinutesDueOn } from '../src/utils/time.js';
import { isProjectOutlineDueTask, taskVisibleOnMyPad, todayISO } from '../src/utils/dates.js';
import { createTask } from '../src/models/task.js';
import { applyTaskFilter } from '../src/models/task.js';
import {
  myPadTaskIds,
  visibleProjectTaskIds,
  projectCardCanCollapse,
} from '../src/components/notepad-list.js';
import { createVoiceNote, formatVoiceNoteTitle } from '../src/models/voice-note.js';

function test(name, fn) {
  fn();
  console.log(`✓ ${name}`);
}

test('parseTimeInput', () => {
  assert.equal(parseTimeInput('30m'), 30);
  assert.equal(parseTimeInput('1h'), 60);
  assert.equal(parseTimeInput('1h 30m'), 90);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(90), '1h 30m');
});

test('sumRemainingMinutesDueOn', () => {
  const today = todayISO();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const tasks = {
    a: createTask({ dueDate: today, estimatedMinutes: 30, completed: false }),
    b: createTask({ dueDate: tomorrow, estimatedMinutes: 400, completed: false }),
    c: createTask({ dueDate: today, estimatedMinutes: 15, completed: true }),
    d: createTask({ dueDate: null, estimatedMinutes: 60, completed: false }),
  };
  assert.equal(sumRemainingMinutesDueOn(tasks, today), 30);
});

test('projectProgress', () => {
  const pid = 'p1';
  const tasks = {
    a: createTask({ projectId: pid, completed: true }),
    b: createTask({ projectId: pid, completed: false, estimatedMinutes: 30 }),
  };
  const p = projectProgress(tasks, pid);
  assert.equal(p.completed, 1);
  assert.equal(p.total, 2);
  assert.equal(p.percent, 50);
});

test('applyTaskFilter unassigned', () => {
  assert.equal(applyTaskFilter(createTask({ projectId: null }), 'unassigned'), true);
  assert.equal(applyTaskFilter(createTask({ projectId: 'x' }), 'unassigned'), false);
});

test('myPadTaskIds excludes assigned project tasks', () => {
  const data = {
    tasks: {
      a: createTask({ id: 'a', projectId: null, order: 1 }),
      b: createTask({ id: 'b', projectId: 'p1', order: 2 }),
    },
  };
  assert.deepEqual(myPadTaskIds(data), ['a']);
});

test('isProjectOutlineDueTask', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  assert.equal(isProjectOutlineDueTask(createTask({ dueDate: today })), true);
  assert.equal(isProjectOutlineDueTask(createTask({ dueDate: tomorrow })), false);
  assert.equal(isProjectOutlineDueTask(createTask({ dueDate: null })), false);
  assert.equal(
    isProjectOutlineDueTask(createTask({ dueDate: yesterday, completed: false })),
    true
  );
  assert.equal(
    isProjectOutlineDueTask(createTask({ dueDate: yesterday, completed: true })),
    false
  );
});

test('taskVisibleOnMyPad by date', () => {
  const today = todayISO();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const open = createTask({ projectId: null, completed: false });
  const doneToday = createTask({
    projectId: null,
    completed: true,
    completedAt: `${today}T15:00:00.000Z`,
  });
  const doneYesterday = createTask({
    projectId: null,
    completed: true,
    completedAt: `${yesterday}T15:00:00.000Z`,
  });
  assert.equal(taskVisibleOnMyPad(open, today), true);
  assert.equal(taskVisibleOnMyPad(doneToday, today), true);
  assert.equal(taskVisibleOnMyPad(doneYesterday, today), false);
  assert.equal(taskVisibleOnMyPad(doneYesterday, yesterday), true);
  assert.equal(taskVisibleOnMyPad(createTask({ projectId: 'p1', completed: false }), today), false);
});

test('visibleProjectTaskIds collapsed shows two active tasks', () => {
  const pid = 'proj-1';
  const tasks = {};
  for (let i = 0; i < 5; i += 1) {
    const t = createTask({ projectId: pid, title: `a${i}`, completed: false });
    tasks[t.id] = t;
  }
  const done = createTask({ projectId: pid, title: 'done', completed: true });
  tasks[done.id] = done;
  const data = { tasks, projects: { [pid]: { id: pid, name: 'P' } } };
  const visible = visibleProjectTaskIds(data, pid, { expanded: false });
  assert.equal(visible.length, 2);
  const activeIds = Object.values(tasks)
    .filter((t) => t.projectId === pid && !t.completed)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => t.id);
  assert.deepEqual(visible, activeIds.slice(-2));
  assert.equal(projectCardCanCollapse(data, pid), true);
  assert.equal(visibleProjectTaskIds(data, pid, { expanded: true }).length, 6);
});

test('createVoiceNote default title from date', () => {
  const d = new Date('2026-10-12T12:30:00');
  const note = createVoiceNote({ createdAt: d.toISOString(), durationMs: 1200 });
  assert.equal(note.title, formatVoiceNoteTitle(d));
  assert.equal(note.durationMs, 1200);
});

console.log('\nAll tests passed.');
