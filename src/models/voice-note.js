import { generateId } from '../utils/ids.js';

export function formatVoiceNoteTitle(date = new Date()) {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function createVoiceNote(input = {}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const created = new Date(createdAt);
  return {
    id: input.id ?? generateId('voice'),
    title: input.title ?? formatVoiceNoteTitle(created),
    createdAt,
    durationMs: input.durationMs ?? 0,
    mimeType: input.mimeType ?? 'audio/webm',
  };
}

export function sortVoiceNotes(notes) {
  return [...notes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
