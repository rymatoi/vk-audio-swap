// ==UserScript==
// @name         VK Audio Swap
// @namespace    https://github.com/vk-audio-swap
// @version      3.1.0
// @description  Swap VK video audio with a custom track and keep sync after ads.
// @match        https://vk.com/*
// @match        https://vkvideo.ru/*
// @match        https://m.vk.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  const BTN_ID = 'vk_audio_swap_btn';
  const MENU_ID = 'vk_audio_swap_menu';

  const DB_NAME = 'vkAudioSwapDB';
  const DB_VER = 1;

  GM_addStyle(`
    #${MENU_ID}{
      position: fixed;
      z-index: 2147483647;
      min-width: 240px;
      max-width: 340px;
      background: rgba(20,20,20,.95);
      color: #fff;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 10px;
      padding: 6px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      font: 13px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial;
    }
    #${MENU_ID} .row{
      display:flex; align-items:center; gap:8px;
      padding: 8px 10px; border-radius: 8px;
      cursor:pointer; user-select:none;
    }
    #${MENU_ID} .row:hover{ background: rgba(255,255,255,.08); }
    #${MENU_ID} .left{ width:16px; text-align:center; flex:0 0 16px; opacity:.95; }
    #${MENU_ID} .title{ flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #${MENU_ID} .danger{ color:#ffb4b4; }
  `);

  function getVideoKey() {
    const u = new URL(location.href);
    u.hash = '';
    return u.origin + u.pathname + u.search;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tracks = db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
        tracks.createIndex('byVideo', 'videoKey', { unique: false });
        db.createObjectStore('state', { keyPath: 'videoKey' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getTracks(videoKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tracks', 'readonly');
      const idx = tx.objectStore('tracks').index('byVideo');
      const req = idx.getAll(videoKey);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function addTrack(videoKey, name, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').add({ videoKey, name, blob, addedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function deleteTrack(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getSelected(videoKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const req = tx.objectStore('state').get(videoKey);
      req.onsuccess = () => resolve(req.result?.selectedId ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function setSelected(videoKey, selectedId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put({ videoKey, selectedId: selectedId ?? null });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  function findVideo(root = document) {
    let v = root.querySelector?.('video');
    if (v) return v;

    const player = root.querySelector?.('vk-video-player');
    if (player?.shadowRoot) {
      v = player.shadowRoot.querySelector('video');
      if (v) return v;
    }

    const all = root.querySelectorAll?.('*') || [];
    for (const n of all) {
      if (n.shadowRoot) {
        v = findVideo(n.shadowRoot);
        if (v) return v;
      }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function closeMenu() {
    document.getElementById(MENU_ID)?.remove();
  }

  function row(icon, title, onClick, cls = '') {
    const d = document.createElement('div');
    d.className = `row ${cls}`.trim();
    d.innerHTML = `<div class="left">${icon}</div><div class="title">${escapeHtml(title)}</div>`;
    d.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await onClick(); } finally { closeMenu(); }
    });
    return d;
  }

  const S = {
    selectedId: null,
    selectedName: 'Original',
    selectedBlob: null,
    video: null,
    audio: null,
    audioUrl: null,
    wiredToVideo: null,
    handlers: null,
  };

  function setBtnLabel(text) {
    const b = document.getElementById(BTN_ID);
    if (!b) return;
    const lab = b.querySelector('.vkvas-label');
    if (lab) lab.textContent = text;
    b.title = text;
    b.setAttribute('aria-label', text);
  }

  function ensureAudioObject() {
    if (S.selectedId === null || !S.selectedBlob) return null;
    if (!S.audio) {
      S.audioUrl = URL.createObjectURL(S.selectedBlob);
      S.audio = new Audio(S.audioUrl);
      S.audio.preload = 'auto';
    }
    return S.audio;
  }

  function stopAudio() {
    if (S.audio) {
      try { S.audio.pause(); } catch {}
    }
  }

  function cleanupAudio() {
    stopAudio();
    if (S.audio) {
      try { S.audio.src = ''; } catch {}
    }
    S.audio = null;
    if (S.audioUrl) {
      try { URL.revokeObjectURL(S.audioUrl); } catch {}
    }
    S.audioUrl = null;
  }

  function mirrorVolume() {
    if (!S.video || !S.audio) return;
    try {
      S.audio.volume = S.video.volume;
      S.audio.muted = (S.video.volume === 0);
    } catch {}
  }

  function enforceMuteIfCustom() {
    if (!S.video) return;
    if (S.selectedId !== null) {
      try { S.video.muted = true; } catch {}
    }
  }

  async function tryPlayAudioSync() {
    if (!S.video) return;
    if (S.selectedId === null || !S.selectedBlob) return;
    if (S.video.paused) return;

    const a = ensureAudioObject();
    if (!a) return;

    enforceMuteIfCustom();
    mirrorVolume();

    const vt = S.video.currentTime || 0;
    try {
      const drift = Math.abs((a.currentTime || 0) - vt);
      if (drift > 0.25) a.currentTime = vt;
    } catch {}

    try { a.playbackRate = S.video.playbackRate; } catch {}

    if (a.paused) {
      try { await a.play(); } catch {}
    }
  }

  function wireToVideo(v) {
    if (!v) return;
    if (S.wiredToVideo === v) return;

    if (S.wiredToVideo && S.handlers) {
      const old = S.wiredToVideo;
      const h = S.handlers;
      old.removeEventListener('play', h.onPlay);
      old.removeEventListener('playing', h.onPlaying);
      old.removeEventListener('pause', h.onPause);
      old.removeEventListener('waiting', h.onWaiting);
      old.removeEventListener('stalled', h.onStalled);
      old.removeEventListener('seeking', h.onSeeking);
      old.removeEventListener('timeupdate', h.onTimeupdate);
      old.removeEventListener('ratechange', h.onRate);
      old.removeEventListener('volumechange', h.onVol);
      old.removeEventListener('ended', h.onEnded);
      old.removeEventListener('emptied', h.onEmptied);
    }

    S.video = v;
    S.wiredToVideo = v;

    const handlers = {
      onPlay: () => { tryPlayAudioSync(); },
      onPlaying: () => { tryPlayAudioSync(); },
      onPause: () => { stopAudio(); },
      onWaiting: () => { stopAudio(); },
      onStalled: () => { stopAudio(); },
      onSeeking: () => {
        if (!S.audio) return;
        stopAudio();
        try { S.audio.currentTime = S.video.currentTime; } catch {}
      },
      onTimeupdate: () => { tryPlayAudioSync(); },
      onRate: () => {
        if (S.audio) {
          try { S.audio.playbackRate = S.video.playbackRate; } catch {}
        }
      },
      onVol: () => { mirrorVolume(); },
      onEnded: () => { stopAudio(); },
      onEmptied: () => { stopAudio(); },
    };

    S.handlers = handlers;

    v.addEventListener('play', handlers.onPlay);
    v.addEventListener('playing', handlers.onPlaying);
    v.addEventListener('pause', handlers.onPause);
    v.addEventListener('waiting', handlers.onWaiting);
    v.addEventListener('stalled', handlers.onStalled);
    v.addEventListener('seeking', handlers.onSeeking);
    v.addEventListener('timeupdate', handlers.onTimeupdate);
    v.addEventListener('ratechange', handlers.onRate);
    v.addEventListener('volumechange', handlers.onVol);
    v.addEventListener('ended', handlers.onEnded);
    v.addEventListener('emptied', handlers.onEmptied);

    tryPlayAudioSync();
  }

  async function selectOriginal() {
    S.selectedId = null;
    S.selectedName = 'Original';
    S.selectedBlob = null;

    cleanupAudio();
    if (S.video) {
      try { S.video.muted = false; } catch {}
    }
    setBtnLabel('Original');
  }

  async function selectCustom(trackId, name, blob) {
    S.selectedId = trackId;
    S.selectedName = name || 'Custom';
    S.selectedBlob = blob;

    cleanupAudio();
    setBtnLabel(S.selectedName);
    wireToVideo(findVideo());
    await tryPlayAudioSync();
  }

  let fileInput = null;
  function pickAudioFile() {
    return new Promise((resolve) => {
      if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';
        document.documentElement.appendChild(fileInput);
      }
      fileInput.value = '';
      fileInput.onchange = () => resolve(fileInput.files?.[0] || null);
      fileInput.click();
    });
  }

  async function toggleMenu(anchorBtn) {
    const existing = document.getElementById(MENU_ID);
    if (existing) { existing.remove(); return; }

    const videoKey = getVideoKey();
    const tracks = await getTracks(videoKey);
    const selectedId = await getSelected(videoKey);

    const m = document.createElement('div');
    m.id = MENU_ID;
    m.style.visibility = 'hidden';
    document.body.appendChild(m);

    m.appendChild(row(selectedId === null ? '●' : '○', 'Original', async () => {
      await setSelected(videoKey, null);
      await selectOriginal();
    }));

    for (const t of tracks.sort((a, b) => a.addedAt - b.addedAt)) {
      const isSel = selectedId === t.id;
      m.appendChild(row(isSel ? '●' : '○', t.name || `Track #${t.id}`, async () => {
        await setSelected(videoKey, t.id);
        await selectCustom(t.id, t.name, t.blob);
      }));
    }

    m.appendChild(row('➕', 'Add audio…', async () => {
      const f = await pickAudioFile();
      if (!f) return;
      await addTrack(videoKey, f.name, f);

      const refreshed = await getTracks(videoKey);
      const newest = refreshed.sort((a, b) => b.addedAt - a.addedAt)[0];
      if (newest) {
        await setSelected(videoKey, newest.id);
        await selectCustom(newest.id, newest.name, newest.blob);
      }
    }));

    if (selectedId !== null) {
      m.appendChild(row('🗑️', 'Delete current', async () => {
        await deleteTrack(selectedId);
        await setSelected(videoKey, null);
        await selectOriginal();
      }, 'danger'));
    }

    const r = anchorBtn.getBoundingClientRect();
    const menuH = m.offsetHeight || 260;
    const gap = 8;
    const below = window.innerHeight - r.bottom - gap;
    const above = r.top - gap;

    const top = (below >= menuH || below >= above)
      ? Math.min(window.innerHeight - menuH - 10, r.bottom + gap)
      : Math.max(10, r.top - menuH - gap);

    const left = Math.min(window.innerWidth - m.offsetWidth - 10, Math.max(10, r.left));

    m.style.top = `${top}px`;
    m.style.left = `${left}px`;
    m.style.visibility = 'visible';

    const onDoc = (ev) => { if (!m.contains(ev.target) && ev.target !== anchorBtn) closeMenu(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc, { capture: true, once: true }), 0);
  }

  function isShare(el) {
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
    return t === 'поделиться' || t.includes('поделиться') || t.includes('share');
  }

  function findShare() {
    const nodes = document.querySelectorAll('button, a, div[role="button"]');
    for (const el of nodes) if (isShare(el)) return el;
    return null;
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const share = findShare();
    if (!share) return;

    const container = share.parentElement;
    if (!container) return;

    const btn = share.cloneNode(true);
    btn.id = BTN_ID;
    btn.textContent = '';

    const icon = document.createElement('span');
    icon.textContent = '🎧';
    icon.style.marginRight = '6px';

    const lab = document.createElement('span');
    lab.className = 'vkvas-label';
    lab.textContent = 'Original';

    btn.appendChild(icon);
    btn.appendChild(lab);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await toggleMenu(btn);
    }, true);

    container.insertBefore(btn, share.nextSibling);

    refreshFromCacheSilent().catch(() => {});
  }

  async function refreshFromCacheSilent() {
    const videoKey = getVideoKey();
    const selectedId = await getSelected(videoKey);

    wireToVideo(findVideo());

    if (selectedId === null) {
      await selectOriginal();
      return;
    }

    const tracks = await getTracks(videoKey);
    const t = tracks.find((x) => x.id === selectedId);
    if (!t) {
      await setSelected(videoKey, null);
      await selectOriginal();
      return;
    }

    S.selectedId = t.id;
    S.selectedName = t.name || 'Custom';
    S.selectedBlob = t.blob;
    setBtnLabel(S.selectedName);

    await tryPlayAudioSync();
  }

  const moBtn = new MutationObserver(() => ensureButton());
  moBtn.observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();

  const moVid = new MutationObserver(() => {
    const v = findVideo();
    if (v && v !== S.wiredToVideo) {
      wireToVideo(v);
    }
  });
  moVid.observe(document.documentElement, { childList: true, subtree: true });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      closeMenu();
      cleanupAudio();
      refreshFromCacheSilent().catch(() => {});
    }
  }, 700);
})();
