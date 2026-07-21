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
  const receiptDrop = document.getElementById('receipt-drop');
  const receiptInput = document.getElementById('receipt-input');
  const receiptDropText = document.getElementById('receipt-drop-text');
  const receiptPreview = document.getElementById('receipt-preview');

  let currentTrackId = null;
  let tracksData = [];
  let paymentInfo = { contactPhone: '', accounts: [] };
  let activeModalTrack = null;

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
    document.getElementById('artist-name').textContent = profile.artist_name || '';
    document.getElementById('artist-bio').textContent = profile.bio || '';
    document.title = profile.artist_name ? `${profile.artist_name} · Zona Beats` : 'Zona Beats';
    if (profile.avatar_filename) {
      const avatarImg = document.getElementById('avatar');
      avatarImg.src = '/api/avatar?_=' + Date.now();
      avatarImg.style.display = 'block';
    }
  }

  // Íconos SVG inline (sin dependencias externas). 'generic' cubre cualquier red
  // futura que no reconozcamos por el dominio de su URL.
  const SOCIAL_ICONS = {
    spotify: '<svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 4.32-1.32 9.66-.66 13.32 1.621.361.181.54.78.421 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.18-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z"/></svg>',
    soundcloud: '<svg viewBox="0 0 24 24"><path d="M1.175 12.225c-.051 0-.094.046-.101.104l-.233 2.154.233 2.105c.007.058.05.104.101.104.05 0 .092-.046.099-.104l.267-2.105-.267-2.154c-.007-.058-.049-.104-.099-.104zm-.899.828c-.06 0-.091.037-.104.09L0 14.479l.172 1.308c.013.053.044.09.104.09.06 0 .097-.037.108-.09l.148-1.308-.148-1.336c-.011-.053-.048-.09-.108-.09zm1.83-1.229c-.06 0-.109.05-.116.113l-.219 2.542.219 2.457c.007.063.056.113.116.113.061 0 .11-.05.117-.115l.248-2.455-.248-2.543c-.007-.063-.056-.112-.117-.112zm.937-.238c-.069 0-.124.058-.13.129l-.202 2.752.202 2.657c.006.071.061.129.13.129.068 0 .124-.058.132-.13l.229-2.656-.229-2.753c-.008-.07-.064-.128-.132-.128zm.983-.135c-.077 0-.138.064-.144.144l-.187 2.882.187 2.766c.006.08.067.144.144.144.076 0 .138-.064.145-.145l.212-2.765-.212-2.883c-.007-.08-.069-.143-.145-.143zm1.06-.174c-.084 0-.153.071-.158.16l-.169 3.05.169 2.87c.005.089.074.159.158.159.085 0 .154-.071.16-.16l.191-2.869-.191-3.052c-.006-.088-.075-.159-.16-.159zm1.153 3.209l-.174 2.964c.005.098.081.174.174.174.093 0 .17-.076.175-.174l.196-2.964-.196-4.85c-.005-.097-.082-.174-.175-.174-.093 0-.169.076-.174.174zm1.243-5.222c-.006-.107-.09-.19-.192-.19-.104 0-.187.083-.192.19l-.177 5.038.177 2.938c.005.107.088.19.192.19.102 0 .186-.083.192-.19l.201-2.938-.201-5.038zm1.048-.398c-.005-.113-.099-.203-.209-.203-.111 0-.204.09-.208.204l-.16 5.435.16 2.907c.004.113.097.203.208.203.11 0 .204-.09.209-.204l.181-2.906-.181-5.436zm1.062-.31c0-.122-.107-.222-.226-.222-.121 0-.221.1-.224.222l-.145 5.744.145 2.867c.003.122.103.222.224.222.119 0 .226-.1.226-.223l.163-2.866-.163-5.744zm1.106.006c-.004-.13-.116-.238-.245-.238-.132 0-.24.108-.244.24l-.128 5.735.128 2.822c.004.132.112.24.244.24.129 0 .241-.108.245-.24l.144-2.822-.144-5.737zm.792-.462c-.14 0-.256.116-.259.257l-.113 6.198.113 2.767c.003.141.119.256.259.256.139 0 .254-.115.259-.258l.127-2.766-.127-6.2c-.005-.141-.12-.254-.259-.254zm2.937 1.096c-.297-.048-.591-.02-.868.079-.036-3.19-2.625-5.766-5.822-5.766-.752 0-1.483.146-2.146.404-.256.101-.324.204-.326.406v10.978c.003.208.166.377.372.395l.028.001h8.762c1.745 0 3.161-1.417 3.161-3.163 0-1.607-1.203-2.928-2.759-3.128"/></svg>',
    generic: '<svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
  };

  function detectPlatform(url) {
    const lower = url.toLowerCase();
    if (lower.includes('spotify.com')) return 'spotify';
    if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook';
    if (lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('music.youtube.com')) return 'youtube';
    if (lower.includes('instagram.com')) return 'instagram';
    if (lower.includes('tiktok.com')) return 'tiktok';
    if (lower.includes('soundcloud.com')) return 'soundcloud';
    return 'generic';
  }

  async function loadSocialLinks() {
    const container = document.getElementById('hero-social');
    try {
      const res = await fetch('/api/social-links');
      const { links } = await res.json();
      if (!links.length) {
        container.style.display = 'none';
        return;
      }
      container.innerHTML = links.map((link) => {
        const platform = detectPlatform(link.url);
        const icon = SOCIAL_ICONS[platform] || SOCIAL_ICONS.generic;
        const label = link.label || platform;
        return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</a>`;
      }).join('');
    } catch {
      container.style.display = 'none';
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
  const orderForm = document.getElementById('order-form');
  const buyerNameInput = document.getElementById('buyer-name-input');
  const buyerPhoneInput = document.getElementById('buyer-phone-input');
  const orderSubmitBtn = document.getElementById('order-submit-btn');
  const modalSuccess = document.getElementById('modal-success');

  let receiptFile = null;

  function openBuyModal(track) {
    activeModalTrack = track;
    modalTrackTitle.textContent = track.title;
    modalPrice.textContent = track.price_label;

    modalAccounts.innerHTML = '';
    if (!paymentInfo.accounts.length) {
      modalAccounts.innerHTML = '<div class="modal-no-accounts">Aún no se han configurado las cuentas de pago.</div>';
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

    // Reiniciar todo el formulario cada vez que se abre el modal, para que
    // cada compra empiece de cero (nombre, teléfono, foto y estado del botón).
    orderForm.reset();
    orderForm.style.display = 'block';
    modalSuccess.style.display = 'none';
    receiptFile = null;
    receiptDrop.classList.remove('has-receipt');
    receiptDropText.style.display = 'block';
    receiptPreview.style.display = 'none';
    receiptPreview.src = '';
    orderSubmitBtn.classList.add('disabled');
    updateSubmitButtonState();

    modalOverlay.classList.add('active');
  }

  function updateSubmitButtonState() {
    const ready = buyerNameInput.value.trim() && buyerPhoneInput.value.trim() && receiptFile;
    orderSubmitBtn.disabled = !ready;
    orderSubmitBtn.classList.toggle('disabled', !ready);
    orderSubmitBtn.textContent = ready
      ? 'Enviar comprobante'
      : 'Completa tus datos y el comprobante';
  }

  buyerNameInput.addEventListener('input', updateSubmitButtonState);
  buyerPhoneInput.addEventListener('input', updateSubmitButtonState);

  receiptDrop.addEventListener('click', () => receiptInput.click());
  receiptInput.addEventListener('change', () => {
    const file = receiptInput.files[0];
    if (!file) return;

    receiptFile = file;
    receiptDrop.classList.add('has-receipt');
    receiptDropText.style.display = 'none';

    const reader = new FileReader();
    reader.onload = (e) => {
      receiptPreview.src = e.target.result;
      receiptPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);

    updateSubmitButtonState();
  });

  orderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!receiptFile || !activeModalTrack) return;

    const buyerName = buyerNameInput.value.trim();
    const buyerPhone = buyerPhoneInput.value.trim();

    orderSubmitBtn.disabled = true;
    orderSubmitBtn.textContent = 'Enviando…';

    try {
      const formData = new FormData();
      formData.append('trackId', activeModalTrack.id);
      formData.append('buyerName', buyerName);
      formData.append('buyerPhone', buyerPhone);
      formData.append('receipt', receiptFile);

      const res = await fetch('/api/orders', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo enviar el comprobante');
      }

      // Comprobante ya guardado en el servidor: ahora sí se activa el botón de WhatsApp,
      // con un mensaje que usa el nombre que la persona acaba de escribir.
      orderForm.style.display = 'none';
      modalSuccess.style.display = 'block';

      if (paymentInfo.contactPhone) {
        const message = encodeURIComponent(
          `Hola, soy ${buyerName} 👋 Acabo de comprar "${activeModalTrack.title}"` +
          `${activeModalTrack.price_label ? ` (${activeModalTrack.price_label})` : ''}. ` +
          `Ya te envié el comprobante de mi transferencia a través de la plataforma. ¡Gracias!`
        );
        const phoneDigits = paymentInfo.contactPhone.replace(/[^0-9]/g, '');
        modalWhatsappBtn.href = `https://wa.me/${phoneDigits}?text=${message}`;
      } else {
        modalWhatsappBtn.style.display = 'none';
      }
    } catch (err) {
      showBuyError(err.message);
      orderSubmitBtn.disabled = false;
      updateSubmitButtonState();
    }
  });

  function showBuyError(msg) {
    // Reutiliza una alerta simple; si prefieres un toast dedicado, se puede añadir después.
    alert(msg);
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
  loadSocialLinks();
})();
