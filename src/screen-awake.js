// Keep a visible screen awake while an operation is active. A wake lock is
// best-effort: unsupported browsers and device power policies may deny it.
export function createScreenAwake({ wakeLock = globalThis.navigator?.wakeLock,
  document = globalThis.document, onError = () => {} } = {}) {
  let active = false;
  let disposed = false;
  let lock = null;
  let pending = false;
  const wanted = () => active && !disposed && !document?.hidden;
  const report = error => { try { onError(error); } catch {} };

  function release(sentinel) {
    try { Promise.resolve(sentinel.release()).catch(report); }
    catch (error) { report(error); }
  }

  function reconcile() {
    if (!wanted()) {
      const previous = lock;
      lock = null;
      if (previous) release(previous);
      return;
    }
    if (lock || pending || !wakeLock?.request) return;
    pending = true;
    // Call request inside the initiating gesture; catch synchronous failures too.
    let request;
    try { request = wakeLock.request('screen'); }
    catch (error) { pending = false; report(error); return; }
    Promise.resolve(request).then(sentinel => {
      pending = false;
      // Stop, hide and dispose can all happen while acquisition is pending.
      if (!wanted()) { release(sentinel); return; }
      if (sentinel.released) return;
      lock = sentinel;
      sentinel.addEventListener('release', () => {
        if (lock === sentinel) lock = null;
      }, { once: true });
    }).catch(error => { pending = false; report(error); });
  }

  document?.addEventListener('visibilitychange', reconcile);
  return {
    setActive(value) { active = value === true; reconcile(); },
    dispose() {
      disposed = true;
      active = false;
      document?.removeEventListener('visibilitychange', reconcile);
      reconcile();
    },
  };
}
