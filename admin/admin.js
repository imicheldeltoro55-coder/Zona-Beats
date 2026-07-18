(() => {
  const loginScreen = document.getElementById('login-screen');
  const adminShell = document.getElementById('admin-shell');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  const uploadForm = document.getElementById('upload-form');
  const uploadBtn = document.getElementById('upload-btn');
  const titleInput = document.getElementById('title-input');
  const genreInput = document.getElementById('genre-input');
  const descriptionInput = document.getElementById('description-input');
  const forSaleInput = document.getElementById('for-sale-input');
  const priceInput = document.getElementById('price-input');
  const audioInput = document.getElementById('audio-input');
  const coverInput = document.getElementById('cover-input');
  const audioDrop = document.getElementById('audio-drop');
  const coverDrop = document.getElementById('cover-drop');

  const trackList = document.getElementById('track-list');

  const paymentForm = document.getElementById('payment-form');
  const contactPhoneInput = document.getElementById('contact-phone-input');
  const accountsList = document.getElementById('accounts-list');
  const addAccountBtn = document.getElementById('add-account-btn');

  const profileForm = document.getElementById('profile-form');
  const djNameInput = document.getElementById('dj-name-input');
  const djBioInput = document.getElementById('dj-bio-input');
  const avatarInput = document.getElementById('avatar-input');
  const avatarDrop = document.getElementById('avatar-drop');

  const toast = document.getElementById('toast');

  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 3000);
  }

  function showApp() {
    loginScreen.style.display = 'none';
    adminShell.style.display = 'block';
    loadTracks();
    loadProfile();
    loadPaymentInfo();
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
  function wireFileDrop(dropEl, inputEl, labelEl, defaultLabel) {
    dropEl.addEventListener('click', () => inputEl.click());
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
  wireFileDrop(audioDrop, audioInput, document.getElementById('audio-drop-label'), 'MP3, WAV, M4A, OGG o FLAC · máx 60MB');
  wireFileDrop(coverDrop, coverInput, document.getElementById('cover-drop-label'), 'JPG, PNG o WEBP · máx 8MB');
  wireFileDrop(avatarDrop, avatarInput, document.getElementById('avatar-drop-label'), 'JPG, PNG o WEBP · máx 8MB');

  // ---------- Subida de pista ----------
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!audioInput.files.length) {
      showToast('Selecciona un archivo de audio.', true);
      return;
    }

    const formData = new FormData();
    formData.append('title', titleInput.value);
    formData.append('genre', genreInput.value);
    formData.append('description', descriptionInput.value);
    formData.append('priceLabel', priceInput.value);
    formData.append('forSale', forSaleInput.checked ? '1' : '0');
    formData.append('audio', audioInput.files[0]);
    if (coverInput.files.length) formData.append('cover', coverInput.files[0]);

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Subiendo…';

    try {
      const res = await fetch('/api/admin/tracks', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al subir');
      }
      showToast('Pista publicada correctamente.');
      uploadForm.reset();
      forSaleInput.checked = false;
      priceInput.value = '';
      document.getElementById('audio-drop-label').textContent = 'MP3, WAV, M4A, OGG o FLAC · máx 60MB';
      document.getElementById('cover-drop-label').textContent = 'JPG, PNG o WEBP · máx 8MB';
      audioDrop.classList.remove('has-file');
      coverDrop.classList.remove('has-file');
      loadTracks();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Publicar pista';
    }
  });

  // ---------- Catálogo ----------
  async function loadTracks() {
    const res = await fetch('/api/admin/tracks');
    if (!res.ok) return;
    const { tracks } = await res.json();
    renderTrackList(tracks);
  }

  function renderTrackList(tracks) {
    trackList.innerHTML = '';
    if (!tracks.length) {
      trackList.innerHTML = '<div class="empty-hint">Todavía no has subido ninguna pista.</div>';
      return;
    }
    tracks.forEach((track) => {
      const item = document.createElement('div');
      item.className = 'track-list-item';
      const coverSrc = track.cover_filename ? `/api/cover/${track.id}` : '';
      item.innerHTML = `
        ${coverSrc ? `<img src="${coverSrc}" alt="">` : `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'/%3E" alt="">`}
        <div class="info">
          <div class="t">${escapeHtml(track.title)}</div>
          <div class="m">${escapeHtml(track.genre || 'Sin género')} · ${track.plays} reproducciones</div>
        </div>
        <div class="price-edit">
          <label class="checkbox-label">
            <input type="checkbox" class="track-for-sale" ${track.for_sale ? 'checked' : ''}>
            <span>En venta</span>
          </label>
          <input type="text" class="track-price" placeholder="Ej: 500 CUP" value="${escapeHtml(track.price_label || '')}">
          <button type="button" class="btn-save-price" data-id="${track.id}">Guardar</button>
        </div>
        <button class="btn-delete" data-id="${track.id}">Eliminar</button>
      `;
      item.querySelector('.btn-delete').addEventListener('click', () => deleteTrack(track.id, track.title));
      item.querySelector('.btn-save-price').addEventListener('click', () => {
        const priceLabel = item.querySelector('.track-price').value;
        const forSale = item.querySelector('.track-for-sale').checked;
        savePrice(track.id, priceLabel, forSale);
      });
      trackList.appendChild(item);
    });
  }

  async function savePrice(id, priceLabel, forSale) {
    const res = await fetch(`/api/admin/tracks/${id}/price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceLabel, forSale }),
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
    djNameInput.value = profile.dj_name || '';
    djBioInput.value = profile.bio || '';
  }

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('dj_name', djNameInput.value);
    formData.append('bio', djBioInput.value);
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
  function addAccountRow(bank = '', number = '') {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.innerHTML = `
      <input type="text" class="account-bank" placeholder="Banco (ej: BPA, BANDEC, MLC)" value="${escapeHtml(bank)}">
      <input type="text" class="account-number" placeholder="Número de tarjeta/cuenta" value="${escapeHtml(number)}">
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
      accounts.forEach(acc => addAccountRow(acc.bank, acc.number));
    } else {
      addAccountRow();
    }
  }

  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accounts = Array.from(accountsList.querySelectorAll('.account-row')).map(row => ({
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

  checkAuth();
})();
