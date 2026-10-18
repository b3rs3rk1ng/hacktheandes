import { validateAlert } from './protocol.js';

export const STORAGE_KEY = 'onda:inbox:v1';
export const MAX_NOTICES = 100;

export function isForLocation(alert, location) {
  if (!location) return false;
  const codes = new Set([location.code, ...(location.areaCodes || [])]);
  return alert.areas.some(area => codes.has(area.code));
}

export function validity(alert, now = Date.now()) {
  if (Date.parse(alert.expiresAt) <= now) return 'expired';
  if (Date.parse(alert.issuedAt) > now + 5 * 60 * 1000) return 'future';
  return 'current';
}

export function mergeNotice(notices, incoming, receivedAt = new Date().toISOString()) {
  const alert = validateAlert(incoming);
  const existing = notices.find(notice => notice.alert.id === alert.id);
  if (existing) {
    if (JSON.stringify(existing.alert) !== JSON.stringify(alert)) {
      throw new Error('El identificador ya existe con otro contenido. Se conservó el aviso anterior.');
    }
    return { notices, duplicate: true };
  }
  return { notices: [{ alert, receivedAt }, ...notices].slice(0, MAX_NOTICES), duplicate: false };
}

export function loadInbox(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const found = new Set();
    return parsed.slice(0, MAX_NOTICES).flatMap(notice => {
      try {
        const alert = validateAlert(notice.alert);
        if (found.has(alert.id) || !Number.isFinite(Date.parse(notice.receivedAt))) return [];
        found.add(alert.id);
        return [{ alert, receivedAt: notice.receivedAt }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function saveInbox(storage, notices) {
  storage.setItem(STORAGE_KEY, JSON.stringify(notices.slice(0, MAX_NOTICES)));
}
