/** In-memory capture session (survives notes re-renders until save/discard). */

let session = null;
let tickTimer = null;
const listeners = new Set();

function pickMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function notify() {
  for (const fn of listeners) fn(getRecorderState());
}

export function subscribeRecorder(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRecorderState() {
  if (!session || session.status === 'discarding') {
    return { status: 'idle', elapsedMs: 0, error: null };
  }
  return {
    status: session.status,
    elapsedMs: session.status === 'recording' ? Date.now() - session.startedAt : session.elapsedMs,
    error: session.error ?? null,
  };
}

export function isRecordingActive() {
  return session?.status === 'recording';
}

export async function startRecording() {
  if (session?.status === 'recording' || session?.status === 'discarding') {
    return getRecorderState();
  }
  if (session?.status === 'preview') {
    discardRecording();
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    session = { status: 'error', error: 'Microphone not supported in this browser.', elapsedMs: 0 };
    notify();
    return getRecorderState();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) chunks.push(e.data);
    });

    session = {
      status: 'recording',
      stream,
      recorder,
      chunks,
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: Date.now(),
      elapsedMs: 0,
      error: null,
    };
    recorder.start(250);
    clearInterval(tickTimer);
    tickTimer = setInterval(notify, 500);
    notify();
    return getRecorderState();
  } catch (e) {
    session = {
      status: 'error',
      error: e?.message || 'Could not access microphone.',
      elapsedMs: 0,
    };
    notify();
    return getRecorderState();
  }
}

export function stopForReview() {
  if (!session || session.status !== 'recording') return getRecorderState();
  return new Promise((resolve) => {
    const { recorder, chunks, mimeType, startedAt } = session;
    const elapsedMs = Date.now() - startedAt;
    recorder.addEventListener(
      'stop',
      () => {
        clearInterval(tickTimer);
        tickTimer = null;
        session.stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        session = {
          status: 'preview',
          blob,
          mimeType,
          elapsedMs,
          error: null,
        };
        notify();
        resolve(getRecorderState());
      },
      { once: true }
    );
    recorder.stop();
  });
}

function finishDiscard() {
  clearInterval(tickTimer);
  tickTimer = null;
  const stream = session?.stream;
  session = null;
  stream?.getTracks().forEach((t) => t.stop());
  notify();
}

export function discardRecording() {
  if (!session) {
    notify();
    return;
  }
  clearInterval(tickTimer);
  tickTimer = null;

  const { recorder, status } = session;
  if (status === 'recording' && recorder && recorder.state !== 'inactive') {
    session.status = 'discarding';
    notify();
    recorder.addEventListener('stop', () => finishDiscard(), { once: true });
    try {
      recorder.stop();
    } catch {
      finishDiscard();
    }
    return;
  }

  finishDiscard();
}

export function takePreviewBlob() {
  if (session?.status !== 'preview' || !session.blob) return null;
  const { blob, mimeType, elapsedMs } = session;
  session = null;
  notify();
  return { blob, mimeType, durationMs: elapsedMs };
}
