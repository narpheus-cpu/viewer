/* Android integration only. The original reader UI, databases and pagination stay intact. */
(function () {
  'use strict';
  window.__androidCheckpoint = function (record) {
    if (!window.AndroidReader || restoreInProgress || readerState.initializing) return;
    try {
      const open = record ? !!record.isOpen : viewerOverlay.classList.contains('active');
      const index = Math.min(Math.max(0, pageIndex), Math.max(0, pageAnchors.length - 1));
      AndroidReader.savePosition(JSON.stringify({
        recentId: activeRecentId || '',
        isOpen: open,
        pageIndex: pageIndex,
        pageAnchor: pageAnchors.length ? readerAnchor() : 0,
        pageContext: readerState.context,
        layoutSignature: pages.length ? readerState.layout : '',
        updatedAt: Date.now()
      }));
    } catch (error) { console.error('Android checkpoint:', error.message); }
  };

  window.__androidRecoverReading = async function (reading) {
    if (!window.AndroidReader) return reading;
    try {
      const raw = AndroidReader.readPosition();
      if (!raw) return reading;
      const saved = JSON.parse(raw);
      if (!(Number(saved.updatedAt) >= Number(reading?.updatedAt || 0)))
        return reading;
      if (!saved.isOpen) {
        return reading ? { ...reading, isOpen: false } : reading;
      }
      if (!saved.recentId) return reading;
      const book = readerState.hydratedBook?.id === saved.recentId ? readerState.hydratedBook.book : await getRecentBook(saved.recentId);
      if (book) readerState.hydratedBook = { id: saved.recentId, book };
      if (book && typeof book.text === 'string') {
        // The full text remains in IndexedDB; native storage carries only the small current position.
        return { ...saved, text: book.text, chapters: book.meta?.chapters || [], fileName: book.meta?.fileName || '' };
      }
    } catch (error) { console.error('Android position recovery:', error.message); }
    return reading;
  };

  window.__androidRecentMeta = function (meta) {
    if (!window.AndroidReader) return meta;
    try {
      const saved = JSON.parse(AndroidReader.readPosition() || 'null');
      if (saved?.recentId === meta.id && Number(saved.updatedAt) >= Number(meta.updatedAt || 0))
        return { ...meta, pageIndex: saved.pageIndex, pageAnchor: saved.pageAnchor, pageContext: saved.pageContext || meta.pageContext,
          layoutSignature: saved.layoutSignature || meta.layoutSignature };
    } catch (error) { console.error('Android history position:', error.message); }
    return meta;
  };

  window.__androidFlushState = async function () {
    if (typeof flushReadingSessionSave !== 'function' || restoreInProgress || readerState.initializing) return;
    flushReadingSessionSave(viewerOverlay.classList.contains('active'));
    clearTimeout(recentSaveTimer);
    recentSaveTimer = 0;
    await saveActiveRecentPosition();
    const reading = parseReadingRecord(localStorage.getItem(READING_STORAGE));
    if (reading) await saveReadingSessionDB(reading);
    await readerState.pendingCache;
  };

  window.__androidBack = function () {
    if (typeof viewerOverlay === 'undefined') return false;
    if (readerGPTIsOpen()) { readerGPTClose(); return true; }
    if (readerNoteIsOpen()) { readerCloseNote(); return true; }
    if (readerSearchIsOpen()) { readerHideSearch(); return true; }
    if (viewerOverlay.classList.contains('active')) { closeViewer(); return true; }
    if (recentOverlay.classList.contains('active')) { hideRecentHistory(); return true; }
    return false;
  };
})();
