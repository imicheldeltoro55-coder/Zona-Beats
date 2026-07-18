(() => {
  const audioEl = document.getElementById('audio-el');
  const playerBar = document.getElementById('player-bar');
  const playerCover = document.getElementById('player-cover');
  const playerTitle = document.getElementById('player-title');
  const playerGenre = document.getElementById('player-genre');
  const playBtn = document.getElementById('player-play-btn');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const progressTrack = document.getElementById('progress-track');
  const progressFill = document.getElementById('progress-fill');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const trackGrid = document.getElementById('track-grid');
  const emptyState = document.getElementById('empty-state');
  const trackCount = document.getElementById('track-count');

  const buyBtn = document.getElementById('player-buy-btn');
  const buyPriceLabel = document.getElementById('player-buy-price');
  const modalOverlay = document.getElementById('buy-modal-overlay');
  const modalClose = document.getElementById('modal-close-btn');
  const modalTrackTitle = document.getElementById('modal-track-title');
  const modalPrice = document.getElementById('modal-price');
  const modalAccounts = document.getElementById('modal-accounts');
  const modalWhatsappBtn = document.getElementById('modal-whatsapp-btn');

  let currentTrackId = null;
  let tracksData = [];
  let paymentInfo = { contactPhone: '', accounts: [] };

  // Bloquear atajos comunes de descarga/guardado/inspección (disuasión básica, no infalible)
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (
      (e.ctrlKey || e.metaKey) && ['s', 'u'].includes(k) ||
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k))
    ) {
      e.preventDefault();
    }
  });

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async function loadProfile() {
    const res = await fetch('/api/profile');
    const { profile } = await res.json();
    document.getElementById('dj-name').textContent = profile.dj_name || 'DJ';
    document.getElementById('dj-bio').textContent = profile.bio || '';
    document.title = `${profile.dj_name || 'DJ'} · Zona Beats`;
    if (profile.avatar_filename) {
      const avatarImg = document.getElementById('avatar');
      avatarImg.src = '/api/avatar?_=' + Date.now();
      avatarImg.style.display = 'block';
    }
  }

  async function loadTracks() {
    const res = await fetch('/api/tracks');
    const { tracks } = await res.json();
    tracksData = tracks;
    renderTracks(tracks);
  }

  async function loadPaymentInfo() {
    const res = await fetch('/api/payment-info');
    if (!res.ok) return;
    paymentInfo = await res.json();
  }

  function renderTracks(tracks) {
    trackGrid.innerHTML = '';
    trackCount.textContent = tracks.length ? `${tracks.length} PISTA${tracks.length === 1 ? '' : 'S'}` : '';
    emptyState.style.display = tracks.length ? 'none' : 'block';

    tracks.forEach((track) => {
      const card = document.createElement('button');
      card.className = 'track-card';
      card.dataset.id = track.id;
      card.setAttribute('aria-label', `Reproducir ${track.title}`);

      const coverHtml = track.cover_filename
        ? `<img src="/api/cover/${track.id}" alt="" oncontextmenu="return false;">`
        : `<div class="track-cover-fallback">${(track.title || '?').charAt(0).toUpperCase()}</div>`;

      card.innerHTML = `
        <div class="track-cover-wrap">
          ${coverHtml}
          <div class="play-overlay">
            <div class="play-btn-circle">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>
        <div class="track-title">${escapeHtml(track.title)}</div>
        <div class="track-meta">
          <span>${escapeHtml(track.genre || 'Set')}</span>
        </div>
        ${track.for_sale && track.price_label ? `<div class="track-price-tag">${escapeHtml(track.price_label)}</div>` : ''}
      `;
      card.addEventListener('click', () => playTrack(track));
      trackGrid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function markPlayingCard(trackId) {
    document.querySelectorAll('.track-card').forEach((card) => {
      card.classList.toggle('playing', Number(card.dataset.id) === Number(trackId));
    });
  }

  async function playTrack(track) {
    try {
      // Pide un token temporal de streaming justo antes de reproducir.
      // El audio nunca se sirve sin este token, y expira solo.
      const res = await fetch(`/api/tracks/${track.id}/token`, { method: 'POST' });
      if (!res.ok) throw new Error('No se pudo obtener acceso a la pista');
      const { token } = await res.json();

      currentTrackId = track.id;
      audioEl.src = `/api/stream/${track.id}?t=${token}`;
      audioEl.play();

      playerTitle.textContent = track.title;
      playerGenre.textContent = track.genre || 'Set';
      playerCover.src = track.cover_filename ? `/api/cover/${track.id}` : '';
      playerBar.classList.add('active');
      markPlayingCard(track.id);

      if (track.for_sale && track.price_label) {
        buyPriceLabel.textContent = track.price_label;
        buyBtn.style.display = 'inline-flex';
        buyBtn.onclick = () => openBuyModal(track);
      } else {
        buyBtn.style.display = 'none';
        buyBtn.onclick = null;
      }
    } catch (err) {
      console.error(err);
      alert('No se pudo reproducir esta pista. Intenta de nuevo.');
    }
  }

  playBtn.addEventListener('click', () => {
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  });

  audioEl.addEventListener('play', () => {
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
    document.getElementById('player-eq').style.animationPlayState = 'running';
  });

  audioEl.addEventListener('pause', () => {
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  });

  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    progressFill.style.width = `${pct}%`;
    timeCurrent.textContent = formatTime(audioEl.currentTime);
    timeTotal.textContent = formatTime(audioEl.duration);
  });

  audioEl.addEventListener('ended', () => {
    markPlayingCard(null);
    // Reproduce la siguiente pista de la lista, si existe
    const idx = tracksData.findIndex(t => t.id === currentTrackId);
    if (idx !== -1 && idx < tracksData.length - 1) {
      playTrack(tracksData[idx + 1]);
    }
  });

  progressTrack.addEventListener('click', (e) => {
    if (!audioEl.duration) return;
    const rect = progressTrack.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioEl.currentTime = pct * audioEl.duration;
  });

  // Si el token expira a mitad de reproducción (sets muy largos), renovar automáticamente.
  audioEl.addEventListener('error', async () => {
    if (currentTrackId == null) return;
    const track = tracksData.find(t => t.id === currentTrackId);
    if (!track) return;
    const wasTime = audioEl.currentTime;
    const res = await fetch(`/api/tracks/${track.id}/token`, { method: 'POST' });
    if (!res.ok) return;
    const { token } = await res.json();
    audioEl.src = `/api/stream/${track.id}?t=${token}`;
    audioEl.currentTime = wasTime;
    audioEl.play();
  });

  // ---------- Modal de compra ----------
  function openBuyModal(track) {
    modalTrackTitle.textContent = track.title;
    modalPrice.textContent = track.price_label;

    modalAccounts.innerHTML = '';
    if (!paymentInfo.accounts.length) {
      modalAccounts.innerHTML = '<div class="modal-no-accounts">El DJ aún no ha configurado sus cuentas de pago.</div>';
    } else {
      paymentInfo.accounts.forEach((acc) => {
        const row = document.createElement('div');
        row.className = 'modal-account-row';
        row.innerHTML = `
          <div>
            <div class="modal-account-bank">${escapeHtml(acc.bank)}</div>
            <div class="modal-account-number">${escapeHtml(acc.number)}</div>
          </div>
          <button class="modal-account-copy" type="button">Copiar</button>
        `;
        row.querySelector('.modal-account-copy').addEventListener('click', (e) => {
          navigator.clipboard.writeText(acc.number).then(() => {
            const btn = e.target;
            btn.textContent = '✓';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copiar'; btn.classList.remove('copied'); }, 1500);
          });
        });
        modalAccounts.appendChild(row);
      });
    }

    if (paymentInfo.contactPhone) {
      const message = encodeURIComponent(
        `Hola, quiero comprar la pista "${track.title}" (${track.price_label}). Ya hice la transferencia, adjunto el comprobante.`
      );
      const phoneDigits = paymentInfo.contactPhone.replace(/[^0-9]/g, '');
      modalWhatsappBtn.href = `https://wa.me/${phoneDigits}?text=${message}`;
      modalWhatsappBtn.style.display = 'block';
    } else {
      modalWhatsappBtn.style.display = 'none';
    }

    modalOverlay.classList.add('active');
  }

  function closeBuyModal() {
    modalOverlay.classList.remove('active');
  }

  modalClose.addEventListener('click', closeBuyModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeBuyModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBuyModal();
  });

  loadProfile();
  loadTracks();
  loadPaymentInfo();
})();
