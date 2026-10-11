import { createTask } from '../models/task.js';
import { createProject } from '../models/project.js';
import { createVoiceNote } from '../models/voice-note.js';
import { createNotesPage } from '../models/notes-page.js';
import { storageGet, storageSet } from './storage-adapter.js';
import { deleteVoiceBlob, saveVoiceBlob } from './voice-notes-db.js';

const STORAGE_KEY = 'focusdesk_data';

const EMPTY = () => ({
  schemaVersion: 1,
  projects: {},
  tasks: {},
  settings: { dailyHourCap: 7 },
  notes: { text: '', updatedAt: null, voiceNotes: [], pages: [], activePageId: null },
});

function normalizeNotesPages(notes) {
  const base = EMPTY().notes;
  const merged = {
    ...base,
    ...(notes && typeof notes === 'object' ? notes : {}),
    text: typeof notes?.text === 'string' ? notes.text : '',
    voiceNotes: Array.isArray(notes?.voiceNotes)
      ? notes.voiceNotes.filter((n) => n && typeof n.id === 'string')
      : [],
  };

  let pages = Array.isArray(merged.pages)
    ? merged.pages
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => ({
          id: p.id,
          title: typeof p.title === 'string' ? p.title : '',
          content: typeof p.content === 'string' ? p.content : '',
          createdAt: p.createdAt ?? null,
          updatedAt: p.updatedAt ?? null,
        }))
    : [];

  if (!pages.length) {
    const first = createNotesPage({
      title: 'Page 1',
      content: merged.text || '',
    });
    pages = [first];
    merged.activePageId = first.id;
  }

  const activePageId = pages.some((p) => p.id === merged.activePageId)
    ? merged.activePageId
    : pages[0].id;

  const active = pages.find((p) => p.id === activePageId) ?? pages[0];
  merged.text = active.content;
  merged.pages = pages;
  merged.activePageId = activePageId;
  return merged;
}

function notesFromData(data) {
  return normalizeNotesPages(data.notes);
}

let cache = null;
const listeners = new Set();
let saveQueue = Promise.resolve();

function normalize(raw) {
  const base = EMPTY();
  if (!raw || typeof raw !== 'object') return base;
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    projects: raw.projects && typeof raw.projects === 'object' ? raw.projects : {},
    tasks: raw.tasks && typeof raw.tasks === 'object' ? raw.tasks : {},
    settings: { ...base.settings, ...(raw.settings || {}) },
    notes: normalizeNotesPages(raw.notes),
  };
}

function notify() {
  for (const fn of listeners) fn(getData());
}

function persist() {
  saveQueue = saveQueue.then(() => storageSet(STORAGE_KEY, cache));
  return saveQueue;
}

export async function initData() {
  if (cache) return cache;
  const raw = await storageGet(STORAGE_KEY);
  cache = normalize(raw);
  if (!raw) await persist();
  return cache;
}

export function getData() {
  return cache ?? EMPTY();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function mutate(mutator, { notify: shouldNotify = true } = {}) {
  const draft = structuredClone(getData());
  await mutator(draft);
  cache = draft;
  await persist();
  if (shouldNotify) notify();
  return cache;
}

export async function addTask(input = {}) {
  return addTaskRecord(createTask(input));
}

export async function addTaskRecord(task) {
  await mutate((data) => {
    data.tasks[task.id] = task;
  });
  return task;
}

export async function updateTask(id, patch, { notify = true } = {}) {
  await mutate(
    (data) => {
      const t = data.tasks[id];
      if (!t) return;
      const next = { ...t, ...patch };
      if (patch.completed === true && !t.completed) {
        next.completedAt = new Date().toISOString();
      }
      if (patch.completed === false) {
        next.completedAt = null;
      }
      if (patch.title !== undefined) next.title = patch.title;
      data.tasks[id] = next;
    },
    { notify }
  );
}

export async function deleteTask(id) {
  await mutate((data) => {
    delete data.tasks[id];
  });
}

export async function addProject(name) {
  const project = createProject({ name });
  await mutate((data) => {
    data.projects[project.id] = project;
  });
  return project;
}

export async function updateProject(id, patch) {
  await mutate((data) => {
    const p = data.projects[id];
    if (!p) return;
    data.projects[id] = {
      ...p,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() : p.name,
    };
  });
}

export async function deleteProject(id) {
  await mutate((data) => {
    delete data.projects[id];
    for (const t of Object.values(data.tasks)) {
      if (t.projectId === id) t.projectId = null;
    }
  });
}

export async function updateWorkspaceNotes(text, { pageId, notify = false } = {}) {
  await mutate(
    (data) => {
      data.notes = notesFromData(data);
      const id = pageId ?? data.notes.activePageId;
      const page = data.notes.pages.find((p) => p.id === id);
      if (!page) return;
      page.content = text;
      page.updatedAt = new Date().toISOString();
      data.notes.text = page.content;
      data.notes.updatedAt = page.updatedAt;
    },
    { notify }
  );
}

export async function setActiveNotesPage(pageId) {
  await mutate((data) => {
    data.notes = notesFromData(data);
    if (data.notes.pages.some((p) => p.id === pageId)) {
      data.notes.activePageId = pageId;
      const page = data.notes.pages.find((p) => p.id === pageId);
      data.notes.text = page?.content ?? '';
    }
  });
}

export async function addNotesPage() {
  let created = null;
  await mutate((data) => {
    data.notes = notesFromData(data);
    const n = data.notes.pages.length + 1;
    created = createNotesPage({ title: `Page ${n}`, content: '' });
    data.notes.pages.push(created);
    data.notes.activePageId = created.id;
    data.notes.text = '';
    data.notes.updatedAt = new Date().toISOString();
  });
  return created;
}

export async function reorderNotesPages(orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return;
  await mutate((data) => {
    data.notes = notesFromData(data);
    const byId = new Map(data.notes.pages.map((p) => [p.id, p]));
    if (orderedIds.length !== byId.size) return;
    if (!orderedIds.every((id) => byId.has(id))) return;
    data.notes.pages = orderedIds.map((id) => byId.get(id));
  });
}

export async function removeNotesPage(pageId) {
  let removed = false;
  await mutate((data) => {
    data.notes = notesFromData(data);
    const { pages } = data.notes;
    if (pages.length <= 1) return;
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx === -1) return;
    pages.splice(idx, 1);
    removed = true;
    if (data.notes.activePageId === pageId) {
      const next = pages[Math.min(idx, pages.length - 1)];
      data.notes.activePageId = next.id;
      data.notes.text = next.content;
      data.notes.updatedAt = next.updatedAt ?? new Date().toISOString();
    }
  });
  return removed;
}

export function getActiveNotesPage(data) {
  const notes = notesFromData(data);
  return notes.pages.find((p) => p.id === notes.activePageId) ?? notes.pages[0];
}

export async function addVoiceNote({ blob, mimeType, durationMs }) {
  const meta = createVoiceNote({ durationMs, mimeType });
  await saveVoiceBlob(meta.id, blob);
  await mutate((data) => {
    const prev = data.notes ?? EMPTY().notes;
    const voiceNotes = Array.isArray(prev.voiceNotes) ? [...prev.voiceNotes] : [];
    voiceNotes.unshift(meta);
    data.notes = { ...prev, voiceNotes };
  });
  return meta;
}

export async function updateVoiceNoteTitle(id, title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  await mutate((data) => {
    const list = data.notes?.voiceNotes;
    if (!Array.isArray(list)) return;
    const item = list.find((n) => n.id === id);
    if (item) item.title = trimmed;
  });
}

export async function deleteVoiceNote(id) {
  await deleteVoiceBlob(id);
  await mutate((data) => {
    if (!Array.isArray(data.notes?.voiceNotes)) return;
    data.notes.voiceNotes = data.notes.voiceNotes.filter((n) => n.id !== id);
  });
}
