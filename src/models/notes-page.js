import { generateId } from '../utils/ids.js';

export function createNotesPage({ title, content } = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId('page'),
    title: title ?? '',
    content: content ?? '',
    createdAt: now,
    updatedAt: now,
  };
}

export function notesPageLabel(page, index) {
  const custom = page.title?.trim();
  if (custom) return custom;
  return `Page ${index + 1}`;
}
