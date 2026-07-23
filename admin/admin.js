(() => {
  const loginScreen = document.getElementById('login-screen');
  const adminShell = document.getElementById('admin-shell');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  const uploadForm = document.getElementById('upload-form');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadProgressWrap = document.getElementById('upload-progress-wrap');
  const uploadProgressFill = document.getElementById('upload-progress-fill');
  const uploadProgressLabel = document.getElementById('upload-progress-label');
  const titleInput = document.getElementById('title-input');
  const genreInput = document.getElementById('genre-input');
  const descriptionInput = document.getElementById('description-input');
  const isPlaylistInput = document.getElementById('is-playlist-input');
  const artistCreditInput = document.getElementById('artist-credit-input');
  const playlistOnlyFields = document.getElementById('playlist-only-fields');
  const catalogOnlyFields = document.getElementById('catalog-only-fields');
  const forSaleInput = document.getElementById('for-sale-input');
  const isExclusiveInput = document.getElementById('is-exclusive-input');
  const priceInput = document.getElementById('price-input');
  const audioInput = document.getElementById('audio-input');
  const coverInput = document.getElementById('cover-input');
  const audioDrop = document.getElementById('audio-drop');
  const coverDrop = document.getElementById('cover-drop');

  const trackList = document.getElementById('track-list');

  const ordersList = document.getElementById('orders-list');
  const ordersCount = document.getElementById('orders-count');
  const receiptModalOverlay = document.getElementById('receipt-modal-overlay');
  const receiptModalImg = document.getElementById('receipt-modal-img');
  const receiptModalClose = document.getElementById('receipt-modal-close');

  const paymentForm = document.getElementById('payment-form');
  const contactPhoneInput = document.getElementById('contact-phone-input');
  const accountsList = document.getElementById('accounts-list');
  const addAccountBtn = document.getElementById('add-account-btn');

  const watermarkVoiceInput = document.getElementById('watermark-voice-input');
  const watermarkVoiceDrop = document.getElementById('watermark-voice-drop');
  const watermarkVoiceDropLabel = document.getElementById('watermark-voice-drop-label');
  const watermarkIntervalInput = document.getElementById('watermark-interval-input');
  const watermarkVolumeInput = document.getElementById('watermark-volume-input');
  const watermarkSaveBtn = document.getElementById('watermark-save-btn');
  const watermarkPreviewBtn = document.getElementById('watermark-preview-btn');
  const watermarkRemoveBtn = document.getElementById('watermark-remove-btn');
  const watermarkPreviewAudio = document.getElementById('watermark-preview-audio');
  const watermarkStatusBadge = document.getElementById('watermark-status-badge');

  const profileForm = document.getElementById('profile-form');
  const artistNameInput = document.getElementById('artist-name-input');
  const artistBioInput = document.getElementById('artist-bio-input');
  const avatarInput = document.getElementById('avatar-input');
  const avatarDrop = document.getElementById('avatar-drop');

  const socialLinksList = document.getElementById('social-links-list');
  const addSocialLinkBtn = document.getElementById('add-social-link-btn');
  const socialLinksSaveBtn = document.getElementById('social-links-save-btn');

  const exchangeRatesForm = document.getElementById('exchange-rates-form');
  const exchangeRatesList = document.getElementById('exchange-rates-list');

  const siteConfigForm = document.getElementById('site-config-form');
  const promoActiveInput = document.getElementById('promo-active-input');
  const promoTextInput = document.getElementById('promo-text-input');
  const scheduleTextInput = document.getElementById('schedule-text-input');

  const toast = document.getElementById('toast');

  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 3000);
  }

  function setUploadProgress(pct, label) {
    uploadProgressFill.style.width = `${pct}%`;
    uploadProgressLabel.textContent = label;
  }

  function showApp() {
    loginScreen.style.display = 'none';
    adminShell.style.display = 'block';
    loadTracks();
    loadProfile();
    loadPaymentInfo();
    loadOrders();
    loadWatermarkConfig();
    loadSocialLinks();
    loadExchangeRates();
    loadSiteConfig();
  }

  function showLogin() {
    loginScreen.style.display = 'flex';
    adminShell.style.display = 'none';
  }

  async function checkAuth() {
    const res = await fetch('/api/admin/check');
    const { authenticated } = await res.json();
    if (authenticated) showApp(); else showLogin();
  }

  loginBtn.addEventListener('click', async () => {
    loginError.style.display = 'none';
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (res.ok) {
      passwordInput.value = '';
      showApp();
    } else {
      loginError.style.display = 'block';
    }
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ---------- Drag/drop visual feedback ----------
  // El <label class="file-drop"> ya envuelve al <input type="file"> y lo abre de forma
  // nativa al tocarlo. No agregamos un .click() manual aquí: en varios navegadores
  // móviles eso dispara el selector dos veces y termina bloqueando el diálogo entero
  // (por eso "no hacía nada" al tocar en el teléfono).
  function wireFileDrop(dropEl, inputEl, labelEl, defaultLabel) {
    inputEl.addEventListener('change', () => {
      if (inputEl.files.length > 0) {
        labelEl.textContent = inputEl.files[0].name;
        dropEl.classList.add('has-file');
      } else {
        labelEl.textContent = defaultLabel;
        dropEl.classList.remove('has-file');
      }
    });
  }
  wireFileDrop(audioDrop, audioInput, document.getElementById('audio-drop-label'), 'MP3, WAV, M4A, OGG o FLAC · máx 150MB');
  wireFileDrop(coverDrop, coverInput, document.getElementById('cover-drop-label'), 'JPG, PNG o WEBP · máx 8MB');
  wireFileDrop(avatarDrop, avatarInput, document.getElementById('avatar-drop-label'), 'JPG, PNG o WEBP · máx 8MB');

  // Playlist (gratis, con colaboradores) y Catálogo (venta, con precio/exclusividad)
  // son mutuamente excluyentes en el formulario de subida.
  isPlaylistInput.addEventListener('change', () => {
    const isPlaylist = isPlaylistInput.checked;
    playlistOnlyFields.style.display = isPlaylist ? 'block' : 'none';
    catalogOnlyFields.style.display = isPlaylist ? 'none' : 'block';
    if (isPlaylist) {
      forSaleInput.checked = false;
      isExclusiveInput.checked = false;
      priceInput.value = '';
    }
  });

  // ---------- Subida de pista ----------
  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!audioInput.files.length) {
      showToast('Selecciona un archivo de audio.', true);
      return;
    }

    const MAX_AUDIO_MB = 150;
    if (audioInput.files[0].size > MAX_AUDIO_MB * 1024 * 1024) {
      showToast(`El audio pesa más de ${MAX_AUDIO_MB}MB. Comprime el archivo o usa un formato con compresión (MP3/FLAC).`, true);
      return;
    }

    const formData = new FormData();
    formData.append('title', titleInput.value);
    formData.append('genre', genreInput.value);
    formData.append('description', descriptionInput.value);
    formData.append('isPlaylist', isPlaylistInput.checked ? '1' : '0');
    formData.append('artistCredit', artistCreditInput.value);
    formData.append('forSale', forSaleInput.checked ? '1' : '0');
    formData.append('isExclusive', isExclusiveInput.checked ? '1' : '0');
    formData.append('priceCup', priceInput.value);
    formData.append('audio', audioInput.files[0]);
    if (coverInput.files.length) formData.append('cover', coverInput.files[0]);

    uploadBtn.disabled = true;
    uploadProgressWrap.style.display = 'block';
    setUploadProgress(0, 'Subiendo… 0%');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/tracks');

    xhr.upload.addEventListener('progress', (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      setUploadProgress(pct, pct < 100 ? `Subiendo… ${pct}%` : 'Procesando en el servidor…');
    });

    xhr.onload = () => {
      uploadBtn.disabled = false;
      uploadProgressWrap.style.display = 'none';

      let response = {};
      try { response = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }

      if (xhr.status >= 200 && xhr.status < 300) {
        showToast('Pista publicada correctamente.');
        uploadForm.reset();
        forSaleInput.checked = false;
        isExclusiveInput.checked = false;
        isPlaylistInput.checked = false;
        playlistOnlyFields.style.display = 'none';
        catalogOnlyFields.style.display = 'block';
        priceInput.value = '';
        document.getElementById('audio-drop-label').textContent = 'MP3, WAV, M4A, OGG o FLAC · máx 150MB';
        document.getElementById('cover-drop-label').textContent = 'JPG, PNG o WEBP · máx 8MB';
        audioDrop.classList.remove('has-file');
        coverDrop.classList.remove('has-file');
        loadTracks();
      } else if (xhr.status === 413) {
        showToast('El archivo es demasiado grande (máx 150MB de audio).', true);
      } else {
        showToast(response.error || `Error al subir (código ${xhr.status}).`, true);
      }
    };

    xhr.onerror = () => {
      uploadBtn.disabled = false;
      uploadProgressWrap.style.display = 'none';
      showToast('Se perdió la conexión durante la subida. Revisa tu internet e intenta de nuevo.', true);
    };

    xhr.ontimeout = () => {
      uploadBtn.disabled = false;
      uploadProgressWrap.style.display = 'none';
      showToast('La subida tardó demasiado y se agotó el tiempo de espera. Intenta con mejor conexión.', true);
    };

    xhr.timeout = 10 * 60 * 1000; // 10 minutos, igual que el servidor
    xhr.send(formData);
  });

  // ---------- Catálogo (con tabs: catálogo / playlist / vip) ----------
  let currentAdminListSection = 'catalog';

  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentAdminListSection = tab.dataset.listSection;
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
      loadTracks();
    });
  });

  async function loadTracks() {
    const res = await fetch(`/api/admin/tracks?type=${currentAdminListSection}`);
    if (!res.ok) return;
    const { tracks } = await res.json();
    renderTrackList(tracks);
  }

  function renderTrackList(tracks) {
    trackList.innerHTML = '';
    if (!tracks.length) {
      const hints = {
        catalog: 'Todavía no has subido ninguna pista al catálogo.',
        playlist: 'Todavía no has subido ninguna colaboración gratuita.',
        vip: 'Todavía no se ha vendido ninguna pista exclusiva.',
      };
      trackList.innerHTML = `<div class="empty-hint">${hints[currentAdminListSection]}</div>`;
      return;
    }
    tracks.forEach((track) => {
      const item = document.createElement('div');
      item.className = 'track-list-item';
      const coverSrc = track.cover_filename ? `/api/cover/${track.id}` : '';
      const metaExtra = track.artist_credit ? ` · ${escapeHtml(track.artist_credit)}` : '';

      let priceEditHtml = '';
      if (currentAdminListSection === 'catalog') {
        priceEditHtml = `
          <div class="price-edit">
            <label class="checkbox-label">
              <input type="checkbox" class="track-for-sale" ${track.for_sale ? 'checked' : ''}>
              <span>En venta</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" class="track-exclusive" ${track.is_exclusive ? 'checked' : ''}>
              <span>Exclusiva</span>
            </label>
            <input type="text" class="track-price" placeholder="Precio en CUP" value="${track.price_cup || ''}">
            <button type="button" class="btn-save-price" data-id="${track.id}">Guardar</button>
          </div>
        `;
      } else if (currentAdminListSection === 'vip') {
        priceEditHtml = `<div class="vip-sold-tag">Vendida · ${escapeHtml(track.price_label || '')}</div>`;
      }

      item.innerHTML = `
        ${coverSrc ? `<img src="${coverSrc}" alt="">` : `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'/%3E" alt="">`}
        <div class="info">
          <div class="t">${escapeHtml(track.title)}</div>
          <div class="m">${escapeHtml(track.genre || 'Sin género')}${metaExtra} · ${track.plays} reproducciones</div>
        </div>
        ${priceEditHtml}
        <button class="btn-delete" data-id="${track.id}">Eliminar</button>
      `;
      item.querySelector('.btn-delete').addEventListener('click', () => deleteTrack(track.id, track.title));

      const saveBtn = item.querySelector('.btn-save-price');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const priceCup = item.querySelector('.track-price').value;
          const forSale = item.querySelector('.track-for-sale').checked;
          const isExclusive = item.querySelector('.track-exclusive').checked;
          savePrice(track.id, priceCup, forSale, isExclusive);
        });
      }

      trackList.appendChild(item);
    });
  }

  async function savePrice(id, priceCup, forSale, isExclusive) {
    const res = await fetch(`/api/admin/tracks/${id}/price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceCup, forSale, isExclusive }),
    });
    if (res.ok) {
      showToast('Precio actualizado.');
    } else {
      showToast('No se pudo guardar el precio.', true);
    }
  }

  async function deleteTrack(id, title) {
    if (!confirm(`¿Eliminar "${title}"? Esta acción no se puede deshacer.`)) return;
    const res = await fetch(`/api/admin/tracks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Pista eliminada.');
      loadTracks();
    } else {
      showToast('No se pudo eliminar.', true);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ---------- Perfil ----------
  async function loadProfile() {
    const res = await fetch('/api/profile');
    const { profile } = await res.json();
    artistNameInput.value = profile.artist_name || '';
    artistBioInput.value = profile.bio || '';
  }

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('artist_name', artistNameInput.value);
    formData.append('bio', artistBioInput.value);
    if (avatarInput.files.length) formData.append('avatar', avatarInput.files[0]);

    const res = await fetch('/api/admin/profile', { method: 'POST', body: formData });
    if (res.ok) {
      showToast('Perfil actualizado.');
      avatarInput.value = '';
      document.getElementById('avatar-drop-label').textContent = 'JPG, PNG o WEBP · máx 8MB';
      avatarDrop.classList.remove('has-file');
    } else {
      showToast('No se pudo guardar el perfil.', true);
    }
  });

  // ---------- Cobros y ventas ----------
  const CURRENCY_OPTIONS = [
    { code: 'CUP', label: 'CUP' },
    { code: 'MLC', label: 'MLC' },
    { code: 'USDT_BEP20', label: 'USDT (BEP20)' },
    { code: 'USDT_TRC20', label: 'USDT (TRC20)' },
    { code: 'USDT_POLYGON', label: 'USDT (Polygon)' },
    { code: 'SALDO_MOVIL', label: 'Saldo Móvil' },
  ];

  function addAccountRow(currency = 'CUP', bank = '', number = '') {
    const row = document.createElement('div');
    row.className = 'account-row with-currency';
    const options = CURRENCY_OPTIONS.map(c => `<option value="${c.code}" ${c.code === currency ? 'selected' : ''}>${c.label}</option>`).join('');
    row.innerHTML = `
      <select class="account-currency">${options}</select>
      <input type="text" class="account-bank" placeholder="Banco / plataforma" value="${escapeHtml(bank)}">
      <input type="text" class="account-number" placeholder="Número de cuenta/tarjeta" value="${escapeHtml(number)}">
      <button type="button" class="account-remove-btn" aria-label="Quitar cuenta">&times;</button>
    `;
    row.querySelector('.account-remove-btn').addEventListener('click', () => row.remove());
    accountsList.appendChild(row);
  }

  addAccountBtn.addEventListener('click', () => addAccountRow());

  async function loadPaymentInfo() {
    const res = await fetch('/api/admin/payment-info');
    if (!res.ok) return;
    const { contactPhone, accounts } = await res.json();
    contactPhoneInput.value = contactPhone || '';
    accountsList.innerHTML = '';
    if (accounts.length) {
      accounts.forEach(acc => addAccountRow(acc.currency, acc.bank, acc.number));
    } else {
      addAccountRow();
    }
  }

  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accounts = Array.from(accountsList.querySelectorAll('.account-row')).map(row => ({
      currency: row.querySelector('.account-currency').value,
      bank: row.querySelector('.account-bank').value.trim(),
      number: row.querySelector('.account-number').value.trim(),
    })).filter(a => a.bank || a.number);

    const res = await fetch('/api/admin/payment-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactPhone: contactPhoneInput.value.trim(), accounts }),
    });

    if (res.ok) {
      showToast('Datos de cobro guardados.');
    } else {
      showToast('No se pudieron guardar los datos de cobro.', true);
    }
  });

  // ---------- Comprobantes de compra ----------
  async function loadOrders() {
    const res = await fetch('/api/admin/orders');
    if (!res.ok) return;
    const { orders } = await res.json();
    renderOrders(orders);
  }

  function formatOrderDate(isoLike) {
    // El servidor guarda datetime('now') en formato SQLite "YYYY-MM-DD HH:MM:SS" (UTC).
    const d = new Date(isoLike.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return isoLike;
    return d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function renderOrders(orders) {
    ordersList.innerHTML = '';

    if (!orders.length) {
      ordersList.innerHTML = '<div class="empty-hint">No hay comprobantes pendientes por revisar.</div>';
      ordersCount.classList.remove('show');
      return;
    }

    ordersCount.textContent = orders.length;
    ordersCount.classList.add('show');

    orders.forEach((order) => {
      const item = document.createElement('div');
      item.className = 'order-item';

      const message = encodeURIComponent(
        `Hola ${order.buyer_name} 👋 Recibí tu comprobante por "${order.track_title}"` +
        `${order.price_label ? ` (${order.price_label})` : ''}. Ya lo estoy revisando, en breve te envío tu pista. ¡Gracias por tu compra!`
      );
      const phoneDigits = (order.buyer_phone || '').replace(/[^0-9]/g, '');
      const whatsappHref = phoneDigits ? `https://wa.me/${phoneDigits}?text=${message}` : null;

      item.innerHTML = `
        <img class="receipt-thumb" src="/api/admin/orders/${order.id}/receipt" alt="Comprobante de ${escapeHtml(order.buyer_name)}">
        <div class="info">
          <div class="buyer">${escapeHtml(order.buyer_name)}</div>
          <div class="track">${escapeHtml(order.track_title)}${order.price_label ? ` · ${escapeHtml(order.price_label)}` : ''}</div>
          <div class="meta">${escapeHtml(order.buyer_phone)} · ${formatOrderDate(order.created_at)}${order.status === 'approved' ? ' · <span class=\"order-approved-tag\">Aprobado</span>' : ''}</div>
        </div>
        <div class="actions">
          ${whatsappHref ? `<a class="btn-whatsapp-order" href="${whatsappHref}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${order.status !== 'approved' ? `<button class="btn-approve-order" type="button">Aprobar</button>` : ''}
          <button class="btn-delete" type="button">Eliminar</button>
        </div>
      `;

      item.querySelector('.receipt-thumb').addEventListener('click', () => {
        receiptModalImg.src = `/api/admin/orders/${order.id}/receipt`;
        receiptModalOverlay.classList.add('active');
      });

      const approveBtn = item.querySelector('.btn-approve-order');
      if (approveBtn) {
        approveBtn.addEventListener('click', () => approveOrder(order.id));
      }

      item.querySelector('.btn-delete').addEventListener('click', () => deleteOrder(order.id, order.buyer_name));

      ordersList.appendChild(item);
    });
  }

  async function approveOrder(id) {
    const res = await fetch(`/api/admin/orders/${id}/approve`, { method: 'POST' });
    if (res.ok) {
      const result = await res.json();
      showToast(result.trackMarkedSold ? 'Aprobado — la pista exclusiva pasó a Beats VIP.' : 'Pedido aprobado.');
      loadOrders();
      loadTracks();
    } else {
      showToast('No se pudo aprobar el pedido.', true);
    }
  }

  async function deleteOrder(id, buyerName) {
    if (!confirm(`¿Eliminar el comprobante de "${buyerName}"? Ya no vas a poder verlo después.`)) return;
    const res = await fetch(`/api/admin/orders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Comprobante eliminado.');
      loadOrders();
    } else {
      showToast('No se pudo eliminar el comprobante.', true);
    }
  }

  receiptModalClose.addEventListener('click', () => receiptModalOverlay.classList.remove('active'));
  receiptModalOverlay.addEventListener('click', (e) => {
    if (e.target === receiptModalOverlay) receiptModalOverlay.classList.remove('active');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') receiptModalOverlay.classList.remove('active');
  });

  // ---------- Protección de audio (marca de agua) ----------
  let watermarkHasVoice = false;
  let watermarkPendingFile = null;

  watermarkVoiceInput.addEventListener('change', () => {
    if (watermarkVoiceInput.files.length > 0) {
      watermarkPendingFile = watermarkVoiceInput.files[0];
      watermarkVoiceDropLabel.textContent = watermarkPendingFile.name;
      watermarkVoiceDrop.classList.add('has-file');
    }
  });

  async function loadWatermarkConfig() {
    const res = await fetch('/api/admin/watermark');
    if (!res.ok) return;
    const config = await res.json();
    watermarkHasVoice = config.active;
    watermarkIntervalInput.value = config.intervalSeconds;
    watermarkVolumeInput.value = config.volume;
    updateWatermarkStatusUI();
  }

  function updateWatermarkStatusUI() {
    if (watermarkHasVoice) {
      watermarkStatusBadge.textContent = 'ACTIVA';
      watermarkStatusBadge.classList.add('show');
      watermarkStatusBadge.classList.remove('badge-inactive');
      watermarkPreviewBtn.style.display = 'inline-block';
      watermarkRemoveBtn.style.display = 'inline-block';
      watermarkVoiceDropLabel.textContent = 'Ya hay un audio configurado — sube otro para reemplazarlo';
    } else {
      watermarkStatusBadge.textContent = 'INACTIVA';
      watermarkStatusBadge.classList.add('show', 'badge-inactive');
      watermarkPreviewBtn.style.display = 'none';
      watermarkRemoveBtn.style.display = 'none';
      if (!watermarkPendingFile) {
        watermarkVoiceDropLabel.textContent = 'MP3, WAV, M4A, OGG o FLAC · máx 10MB · unos segundos bastan';
      }
    }
  }

  watermarkSaveBtn.addEventListener('click', async () => {
    const interval = parseInt(watermarkIntervalInput.value, 10);
    const volume = parseFloat(watermarkVolumeInput.value);

    if (!watermarkPendingFile && !watermarkHasVoice) {
      showToast('Sube un audio de voz para activar la marca de agua.', true);
      return;
    }
    if (isNaN(interval) || interval < 5 || interval > 600) {
      showToast('El intervalo debe ser un número entre 5 y 600 segundos.', true);
      return;
    }
    if (isNaN(volume) || volume < 0.05 || volume > 1) {
      showToast('El volumen debe ser un número entre 0.05 y 1.', true);
      return;
    }

    const formData = new FormData();
    if (watermarkPendingFile) formData.append('voice', watermarkPendingFile);
    formData.append('intervalSeconds', String(interval));
    formData.append('volume', String(volume));

    watermarkSaveBtn.disabled = true;
    watermarkSaveBtn.textContent = 'Guardando…';

    try {
      const res = await fetch('/api/admin/watermark', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo guardar la configuración');
      }
      showToast('Protección de audio guardada. Se aplicará a las próximas pistas que subas.');
      watermarkPendingFile = null;
      watermarkVoiceInput.value = '';
      watermarkVoiceDrop.classList.remove('has-file');
      await loadWatermarkConfig();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      watermarkSaveBtn.disabled = false;
      watermarkSaveBtn.textContent = 'Guardar configuración';
    }
  });

  watermarkPreviewBtn.addEventListener('click', () => {
    watermarkPreviewAudio.src = '/api/admin/watermark/preview?_=' + Date.now();
    watermarkPreviewAudio.play();
    watermarkPreviewBtn.textContent = '▶ Reproduciendo…';
    watermarkPreviewAudio.onended = () => {
      watermarkPreviewBtn.textContent = '▶ Escuchar la voz actual';
    };
  });

  watermarkRemoveBtn.addEventListener('click', async () => {
    if (!confirm('¿Quitar la marca de agua? Las pistas que subas después de esto ya no la incluirán. Las que ya están publicadas no cambian.')) return;
    const res = await fetch('/api/admin/watermark', { method: 'DELETE' });
    if (res.ok) {
      showToast('Marca de agua desactivada.');
      await loadWatermarkConfig();
    } else {
      showToast('No se pudo quitar la marca de agua.', true);
    }
  });

  // ---------- Redes sociales ----------
  function addSocialLinkRow(label = '', url = '') {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.innerHTML = `
      <input type="text" class="social-label" placeholder="Nombre (ej: Spotify, TikTok...)" value="${escapeHtml(label)}">
      <input type="text" class="social-url" placeholder="https://..." value="${escapeHtml(url)}">
      <button type="button" class="account-remove-btn" aria-label="Quitar red social">&times;</button>
    `;
    row.querySelector('.account-remove-btn').addEventListener('click', () => row.remove());
    socialLinksList.appendChild(row);
  }

  addSocialLinkBtn.addEventListener('click', () => addSocialLinkRow());

  async function loadSocialLinks() {
    const res = await fetch('/api/admin/social-links');
    if (!res.ok) return;
    const { links } = await res.json();
    socialLinksList.innerHTML = '';
    if (links.length) {
      links.forEach(l => addSocialLinkRow(l.label, l.url));
    } else {
      addSocialLinkRow();
    }
  }

  socialLinksSaveBtn.addEventListener('click', async () => {
    const links = Array.from(socialLinksList.querySelectorAll('.account-row')).map(row => ({
      label: row.querySelector('.social-label').value.trim(),
      url: row.querySelector('.social-url').value.trim(),
    })).filter(l => l.label || l.url);

    socialLinksSaveBtn.disabled = true;
    socialLinksSaveBtn.textContent = 'Guardando…';

    try {
      const res = await fetch('/api/admin/social-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron guardar las redes sociales');
      }
      showToast('Redes sociales guardadas.');
      await loadSocialLinks();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      socialLinksSaveBtn.disabled = false;
      socialLinksSaveBtn.textContent = 'Guardar redes sociales';
    }
  });

  // ---------- Tasas de cambio ----------
  const CURRENCY_LABELS = {
    CUP: 'CUP',
    MLC: 'MLC',
    USDT_BEP20: 'USDT (BEP20)',
    USDT_TRC20: 'USDT (TRC20)',
    USDT_POLYGON: 'USDT (Polygon)',
    SALDO_MOVIL: 'Saldo Móvil',
  };

  function renderExchangeRates(rates) {
    exchangeRatesList.innerHTML = '';
    rates.forEach((rate) => {
      const row = document.createElement('div');
      row.className = 'rate-row';
      const isCup = rate.code === 'CUP';
      row.innerHTML = `
        <div class="rate-row-label">${escapeHtml(rate.label)}</div>
        <div class="rate-row-input-wrap">
          ${isCup
            ? `<span>Moneda base — siempre 1</span>`
            : `<input type="text" class="rate-value" data-code="${rate.code}" data-label="${escapeHtml(rate.label)}" placeholder="0" value="${rate.cupPerUnit || ''}"><span>CUP por unidad</span>`
          }
        </div>
      `;
      exchangeRatesList.appendChild(row);
    });
  }

  async function loadExchangeRates() {
    const res = await fetch('/api/admin/exchange-rates');
    if (!res.ok) return;
    const { rates } = await res.json();
    const byCode = Object.fromEntries(rates.map(r => [r.code, r]));
    const fullList = Object.entries(CURRENCY_LABELS).map(([code, label]) => ({
      code,
      label,
      cupPerUnit: byCode[code] ? byCode[code].cupPerUnit : (code === 'CUP' ? 1 : 0),
    }));
    renderExchangeRates(fullList);
  }

  exchangeRatesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rates = [{ code: 'CUP', label: 'CUP', cupPerUnit: 1 }];
    exchangeRatesList.querySelectorAll('.rate-value').forEach((input) => {
      rates.push({
        code: input.dataset.code,
        label: input.dataset.label,
        cupPerUnit: parseFloat(input.value) || 0,
      });
    });

    const res = await fetch('/api/admin/exchange-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates }),
    });

    if (res.ok) {
      showToast('Tasas de cambio guardadas.');
    } else {
      showToast('No se pudieron guardar las tasas.', true);
    }
  });

  // ---------- Promociones y horario ----------
  async function loadSiteConfig() {
    const res = await fetch('/api/admin/site-config');
    if (!res.ok) return;
    const config = await res.json();
    promoActiveInput.checked = config.promoActive;
    promoTextInput.value = config.promoText || '';
    scheduleTextInput.value = config.scheduleText || '';
  }

  siteConfigForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/site-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promoActive: promoActiveInput.checked,
        promoText: promoTextInput.value.trim(),
        scheduleText: scheduleTextInput.value.trim(),
      }),
    });

    if (res.ok) {
      showToast('Configuración guardada.');
    } else {
      showToast('No se pudo guardar la configuración.', true);
    }
  });

  checkAuth();
})();
