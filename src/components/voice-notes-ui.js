import { sortVoiceNotes } from '../models/voice-note.js';
import { getVoiceBlob } from '../storage/voice-notes-db.js';
import {
  discardRecording,
  getRecorderState,
  startRecording,
  stopForReview,
  subscribeRecorder,
  takePreviewBlob,
} from './voice-recorder.js';

const MIC_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.75"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extensionForMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  return 'webm';
}

function safeDownloadName(title) {
  const base = (title || 'voice-note')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return base || 'voice-note';
}

async function downloadVoiceNote(note) {
  const blob = await getVoiceBlob(note.id);
  if (!blob) return;
  const ext = extensionForMime(note.mimeType || blob.type);
  const filename = `${safeDownloadName(note.title)}.${ext}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountVoiceNotesUi(card, ctx) {
  const { data, handlers } = ctx;
  const clips = sortVoiceNotes(data.notes?.voiceNotes ?? []);

  const head = card.querySelector('.notes-card__head');
  if (!head) return;

  head.classList.add('notes-card__head--toolbar');

  const tools = document.createElement('div');
  tools.className = 'notes-voice__toolbar';

  const recordBtn = document.createElement('button');
  recordBtn.type = 'button';
  recordBtn.className = 'notes-voice__record-btn';
  recordBtn.setAttribute('aria-label', 'Start voice recording');
  recordBtn.innerHTML = MIC_ICON;
  tools.appendChild(recordBtn);
  head.appendChild(tools);

  const panel = document.createElement('div');
  panel.className = 'notes-voice';
  card.appendChild(panel);

  const statusBar = document.createElement('div');
  statusBar.className = 'notes-voice__status';
  statusBar.hidden = true;

  const statusText = document.createElement('span');
  statusText.className = 'notes-voice__status-text';
  const statusActions = document.createElement('div');
  statusActions.className = 'notes-voice__status-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'notes-voice__btn notes-voice__btn--primary';
  saveBtn.textContent = 'Save';

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'notes-voice__btn';
  discardBtn.textContent = 'Discard';

  statusActions.append(saveBtn, discardBtn);
  statusBar.append(statusText, statusActions);
  panel.appendChild(statusBar);

  const list = document.createElement('ul');
  list.className = 'notes-voice__list';
  list.setAttribute('role', 'list');
  panel.appendChild(list);

  function renderList() {
    const items = sortVoiceNotes(ctx.data?.notes?.voiceNotes ?? data.notes?.voiceNotes ?? []);
    list.innerHTML = '';
    for (const note of items) {
      list.appendChild(buildClipRow(note, handlers));
    }
    syncPanelLayout();
  }

  function syncPanelLayout() {
    const items = sortVoiceNotes(ctx.data?.notes?.voiceNotes ?? data.notes?.voiceNotes ?? []);
    const state = getRecorderState();
    const isRecording = state.status === 'recording';
    const hasClips = items.length > 0;
    panel.hidden = !isRecording && !hasClips;
    panel.classList.toggle('notes-voice--recording', isRecording);
    panel.classList.toggle('notes-voice--has-clips', hasClips);
    list.hidden = !hasClips;
  }

  function syncStatus() {
    const state = getRecorderState();
    const isRecording = state.status === 'recording';

    recordBtn.disabled = isRecording;
    recordBtn.classList.toggle('notes-voice__record-btn--active', isRecording);
    recordBtn.setAttribute('aria-pressed', isRecording ? 'true' : 'false');

    statusBar.classList.toggle('notes-voice__status--open', isRecording);
    statusActions.hidden = false;

    if (state.status === 'error') {
      statusBar.classList.add('notes-voice__status--open');
      statusText.textContent = state.error || 'Recording failed.';
      statusActions.hidden = true;
      panel.hidden = false;
      return;
    }

    if (isRecording) {
      statusText.innerHTML = `<span class="notes-voice__rec-dot" aria-hidden="true"></span> Recording ${formatElapsed(state.elapsedMs)}`;
    }

    syncPanelLayout();
  }

  recordBtn.addEventListener('click', async () => {
    const state = getRecorderState();
    if (state.status === 'recording') return;
    await startRecording();
    syncStatus();
  });

  saveBtn.addEventListener('click', async () => {
    const state = getRecorderState();
    if (state.status === 'recording') {
      await stopForReview();
      syncStatus();
      const preview = takePreviewBlob();
      if (preview) await handlers.onVoiceNoteSave(preview);
      renderList();
      return;
    }
    if (state.status === 'preview') {
      const preview = takePreviewBlob();
      if (preview) await handlers.onVoiceNoteSave(preview);
      renderList();
    }
    syncStatus();
  });

  discardBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    discardRecording();
  });

  const unsub = subscribeRecorder(() => {
    syncStatus();
  });
  card._voiceUnsub = unsub;

  syncStatus();
  renderList();
}

const PLAY_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7.5v9l7.5-4.5L9 7.5z" fill="currentColor"/></svg>';
const PAUSE_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7h3v10H8V7zm5 0h3v10h-3V7z" fill="currentColor"/></svg>';
const VOL_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** @type {HTMLAudioElement | null} */
let activeVoiceAudio = null;

function pauseOtherVoiceClips(except) {
  if (activeVoiceAudio && activeVoiceAudio !== except) {
    activeVoiceAudio.pause();
  }
  document.querySelectorAll('.notes-voice__play').forEach((btn) => {
    const row = btn.closest('.notes-voice__item');
    const a = row?._voiceAudio;
    if (a && a !== except && !a.paused) {
      a.pause();
      btn.innerHTML = PLAY_ICON;
      btn.setAttribute('aria-label', 'Play');
    }
  });
}

function buildClipRow(note, handlers) {
  const li = document.createElement('li');
  li.className = 'notes-voice__item';
  li.dataset.voiceId = note.id;

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'notes-voice__title-input';
  titleInput.value = note.title;
  titleInput.setAttribute('aria-label', 'Voice note title');
  titleInput.addEventListener('change', () => {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.value = note.title;
      return;
    }
    if (title !== note.title) handlers.onVoiceNoteRename(note.id, title);
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur();
  });

  const audio = document.createElement('audio');
  audio.className = 'notes-voice__audio';
  audio.preload = 'metadata';
  li._voiceAudio = audio;
  let objectUrl = null;

  const player = document.createElement('div');
  player.className = 'notes-voice__player';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'notes-voice__play';
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.innerHTML = PLAY_ICON;

  const seekWrap = document.createElement('div');
  seekWrap.className = 'notes-voice__seek-wrap';

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'notes-voice__seek';
  seek.min = '0';
  seek.max = '1000';
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Playback position');
  seekWrap.appendChild(seek);

  const time = document.createElement('span');
  time.className = 'notes-voice__time muted';
  const durationMs = note.durationMs || 0;
  time.textContent = `0:00 / ${formatElapsed(durationMs)}`;

  const volWrap = document.createElement('div');
  volWrap.className = 'notes-voice__volume-wrap';
  volWrap.innerHTML = VOL_ICON;
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.className = 'notes-voice__volume';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.05';
  vol.value = '1';
  vol.setAttribute('aria-label', 'Volume');
  volWrap.appendChild(vol);

  const actions = document.createElement('div');
  actions.className = 'notes-voice__actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'notes-voice__download';
  downloadBtn.setAttribute('aria-label', 'Download voice note');
  downloadBtn.textContent = 'Download';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'notes-voice__delete';
  del.setAttribute('aria-label', 'Delete voice note');
  del.textContent = 'Delete';

  actions.append(downloadBtn, del);

  let seeking = false;

  function durationLabel() {
    const ms = audio.duration && isFinite(audio.duration) ? audio.duration * 1000 : durationMs;
    return formatElapsed(ms);
  }

  function updateTimeLabel() {
    time.textContent = `${formatElapsed(audio.currentTime * 1000)} / ${durationLabel()}`;
  }

  function syncSeek() {
    if (!audio.duration || !isFinite(audio.duration)) return;
    if (!seeking) {
      seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    }
  }

  audio.addEventListener('loadedmetadata', () => {
    updateTimeLabel();
    syncSeek();
  });

  audio.addEventListener('timeupdate', () => {
    syncSeek();
    updateTimeLabel();
  });

  audio.addEventListener('ended', () => {
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
    if (activeVoiceAudio === audio) activeVoiceAudio = null;
  });

  audio.addEventListener('pause', () => {
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
  });

  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  seek.addEventListener('pointerup', () => {
    seeking = false;
  });
  seek.addEventListener('change', () => {
    seeking = false;
  });
  seek.addEventListener('input', () => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    updateTimeLabel();
  });

  vol.addEventListener('input', () => {
    audio.volume = Number(vol.value);
  });

  playBtn.addEventListener('click', async () => {
    if (!objectUrl && !audio.src) return;
    if (audio.paused) {
      pauseOtherVoiceClips(audio);
      try {
        await audio.play();
        activeVoiceAudio = audio;
        playBtn.innerHTML = PAUSE_ICON;
        playBtn.setAttribute('aria-label', 'Pause');
      } catch {
        /* autoplay policy */
      }
    } else {
      audio.pause();
      playBtn.innerHTML = PLAY_ICON;
      playBtn.setAttribute('aria-label', 'Play');
    }
  });

  downloadBtn.addEventListener('click', () => {
    void downloadVoiceNote({
      ...note,
      title: titleInput.value.trim() || note.title,
    });
  });

  del.addEventListener('click', () => {
    audio.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (activeVoiceAudio === audio) activeVoiceAudio = null;
    handlers.onVoiceNoteDelete(note.id);
  });

  void getVoiceBlob(note.id).then((blob) => {
    if (!blob || !audio.isConnected) return;
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
  });

  player.append(playBtn, seekWrap, time, volWrap, actions);
  li.append(titleInput, player, audio);
  return li;
}

export function teardownVoiceNotesUi(card) {
  card?._voiceUnsub?.();
  delete card?._voiceUnsub;
}
