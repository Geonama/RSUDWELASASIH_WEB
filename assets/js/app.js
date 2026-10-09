(function () {
    const qs = (selector, root = document) => root.querySelector(selector);
    const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        }[char]));
    }

    function updateClock() {
        const clock = qs('[data-clock]');
        const date = qs('[data-date]');
        if (!clock) return;
        const now = new Date();
        clock.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
        if (date) {
            date.textContent = now.toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            });
        }
    }

    updateClock();
    setInterval(updateClock, 1000);

    qsa('[data-toast-close]').forEach((button) => {
        button.addEventListener('click', () => button.closest('[data-toast]')?.remove());
    });

    qsa('[data-password-toggle]').forEach((button) => {
        const input = document.getElementById(button.getAttribute('aria-controls'));
        const icon = qs('[data-password-toggle-icon]', button);
        if (!(input instanceof HTMLInputElement) || !icon) return;

        button.addEventListener('click', () => {
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            const fieldLabel = button.dataset.passwordLabel || 'password';
            const label = `${reveal ? 'Sembunyikan' : 'Tampilkan'} ${fieldLabel}`;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', String(reveal));
            button.title = label;
            icon.src = reveal ? 'assets/icons/eye-off.svg' : 'assets/icons/eye.svg';
        });
    });

    const menuToggle = qs('[data-menu-toggle]');
    const sidebar = qs('[data-sidebar]');
    if (menuToggle && sidebar) {
        const mobileMenu = window.matchMedia('(max-width: 820px)');
        const setMenuOpen = (open) => {
            sidebar.classList.toggle('open', open);
            sidebar.inert = mobileMenu.matches && !open;
            menuToggle.setAttribute('aria-expanded', String(open));
            const label = open ? 'Tutup menu' : 'Buka menu';
            menuToggle.setAttribute('aria-label', label);
            menuToggle.title = label;
        };

        setMenuOpen(false);
        menuToggle.addEventListener('click', () => setMenuOpen(!sidebar.classList.contains('open')));
        mobileMenu.addEventListener('change', () => setMenuOpen(false));
        document.addEventListener('click', (event) => {
            if (mobileMenu.matches && !sidebar.contains(event.target) && !menuToggle.contains(event.target)) setMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && sidebar.classList.contains('open')) {
                setMenuOpen(false);
                menuToggle.focus();
            }
        });
    }

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;

        const transferForm = form.matches('[data-transfer-form]');
        if (transferForm) {
            const count = qsa('[data-transfer-checkbox]:checked', form).length;
            if (count === 0) {
                event.preventDefault();
                alert('Pilih minimal satu pasien siap transfer.');
                return;
            }
            if (!confirm(`Apakah Anda yakin ingin mentransfer ${count} pasien?`)) {
                event.preventDefault();
                return;
            }
        }

        const confirmMessage = form.getAttribute('data-confirm');
        if (confirmMessage && !confirm(confirmMessage)) {
            event.preventDefault();
            return;
        }

        if (form.matches('[data-loading-form], [data-transfer-form]')) {
            const button = event.submitter instanceof HTMLButtonElement ? event.submitter : form.querySelector('button[type="submit"]:not([disabled])');
            if (button) {
                button.dataset.originalText = button.textContent || '';
                button.textContent = button.getAttribute('data-loading-text') || 'Memproses...';
                button.disabled = true;
            }
        }
    });

    const checkAll = qs('[data-check-all]');
    if (checkAll) {
        checkAll.addEventListener('change', () => {
            qsa('[data-transfer-checkbox]').forEach((box) => {
                box.checked = checkAll.checked;
            });
        });
    }

    qsa('[data-password-form]').forEach((form) => {
        const input = qs('[data-password-input]', form);
        const hint = form.nextElementSibling?.matches('[data-password-hint]') ? form.nextElementSibling : qs('[data-password-hint]', form.parentElement || document);
        if (!input || !hint) return;

        const validate = () => {
            const value = input.value;
            const ok = value.length <= 72 && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(value);
            hint.textContent = ok ? 'Password memenuhi aturan keamanan.' : 'Gunakan 8-72 karakter, huruf besar, huruf kecil, angka, dan karakter khusus.';
            hint.style.color = ok ? 'var(--auth-accent, #0f9f6e)' : '';
        };
        input.addEventListener('input', validate);
    });

    qsa('[data-patient-form]').forEach((form) => {
        const diagnosisInput = qs('[data-diagnosis-input]', form);
        const doctorSelect = qs('[data-doctor-select]', form);
        const box = qs('[data-doctor-recommendation]', form);
        if (!diagnosisInput || !doctorSelect || !box) return;

        let doctors = [];
        try {
            doctors = JSON.parse(form.getAttribute('data-doctors') || '[]');
        } catch (error) {
            doctors = [];
        }

        const recommend = () => {
            const diagnosis = diagnosisInput.value.toLowerCase();
            if (!diagnosis.trim()) {
                box.textContent = 'Rekomendasi dokter akan muncul setelah diagnosa diisi.';
                return;
            }

            const match = doctors.find((doctor) => {
                const words = `${doctor.specialization || ''},${doctor.keywords || ''}`.toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
                return words.some((word) => diagnosis.includes(word) || word.includes(diagnosis));
            });

            if (match) {
                box.textContent = `Rekomendasi: ${match.name} (${match.specialization}). Tetap gunakan keputusan klinis saat memilih DPJP.`;
            } else {
                box.textContent = 'Belum ada rekomendasi spesialisasi otomatis. Pilih dokter sesuai keputusan klinis.';
            }
        };

        diagnosisInput.addEventListener('input', recommend);
        recommend();
    });

    const grid = qs('[data-bed-grid]');
    const miniMap = qs('[data-transit-bed-map]');
    if (grid || miniMap || qs('[data-live-summary]')) {
        let miniMapSignature = null;
        const manageRequested = grid?.dataset.manage === '1';
        const actionIcon = (name) => `<img src="assets/icons/${name}.svg" alt="" aria-hidden="true" width="18" height="18">`;
        const renderStatus = (status, label) => `<span class="status-badge status-${escapeHtml(status.toLowerCase())}">${escapeHtml(label)}</span>`;
        const renderBed = (bed, canManage, csrf) => {
            const statusClass = `bed-${String(bed.status).toLowerCase()}`;
            if (bed.status === 'KOSONG') {
                return `<article class="bed-card ${statusClass}"><header><strong>${escapeHtml(bed.bed_code)}</strong>${renderStatus(bed.status, bed.status_label)}</header><div class="bed-empty">Bed tersedia</div></article>`;
            }
            if (bed.status === 'NONAKTIF') {
                return `<article class="bed-card ${statusClass}"><header><strong>${escapeHtml(bed.bed_code)}</strong>${renderStatus(bed.status, bed.status_label)}</header><div class="bed-empty">Bed tidak aktif</div></article>`;
            }

            let actions = `<a class="btn btn-small btn-secondary" href="index.php?page=patient_detail&id=${Number(bed.patient_id)}">${actionIcon('eye')}Detail</a>`;
            if (manageRequested && canManage) {
                if (bed.status === 'TERISI') {
                    actions += `<a class="btn btn-small" href="index.php?page=patient_form&id=${Number(bed.patient_id)}">${actionIcon('pencil')}Edit</a>
                    <form method="post" data-loading-form>
                        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
                        <input type="hidden" name="action" value="mark_ready">
                        <input type="hidden" name="id" value="${Number(bed.patient_id)}">
                        <button class="btn btn-small btn-primary" type="submit" data-loading-text="Memproses...">${actionIcon('arrow-right')}Set Siap</button>
                    </form>`;
                } else if (bed.status === 'SIAP_TRANSFER') {
                    actions += `<form method="post" data-loading-form data-confirm="Apakah Anda yakin ingin mentransfer 1 pasien?">
                        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
                        <input type="hidden" name="action" value="transfer_selected">
                        <input type="hidden" name="selected_patients[]" value="${Number(bed.patient_id)}">
                        <button class="btn btn-small btn-primary" type="submit" data-loading-text="Transfer...">${actionIcon('arrow-right-left')}Transfer</button>
                    </form>`;
                }
            }

            return `<article class="bed-card ${statusClass}">
                <header><strong>${escapeHtml(bed.bed_code)}</strong>${renderStatus(bed.status, bed.status_label)}</header>
                <div class="bed-patient">
                    <strong>${escapeHtml(bed.patient_name)}</strong>
                    <span>No. RM ${escapeHtml(bed.medical_record_number)}</span>
                    <small>Masuk ${escapeHtml(bed.arrival_time)}</small>
                </div>
                <div class="bed-actions">${actions}</div>
            </article>`;
        };

        const renderGroup = (group, bedsById, canManage, csrf, open) => {
            const summary = group.summary;
            return `<details class="bed-group" data-bed-group="${escapeHtml(group.id)}"${open ? ' open' : ''}>
                <summary class="bed-group-header">
                    <div class="bed-group-title">
                        ${actionIcon(group.id === 'isolation' ? 'shield-check' : 'bed-double')}
                        <h2>${escapeHtml(group.label)}</h2>
                        <span class="bed-group-count">${Number(summary.total)} bed</span>
                    </div>
                    <div class="bed-group-summary">
                        <span><i class="dot green" aria-hidden="true"></i><b data-group-summary="empty">${Number(summary.empty)}</b> kosong</span>
                        <span><i class="dot red" aria-hidden="true"></i><b data-group-summary="occupied">${Number(summary.occupied)}</b> terisi</span>
                        <span><i class="dot blue" aria-hidden="true"></i><b data-group-summary="ready">${Number(summary.ready)}</b> siap</span>
                        ${summary.inactive ? `<span><b data-group-summary="inactive">${Number(summary.inactive)}</b> nonaktif</span>` : ''}
                    </div>
                    <img class="bed-group-chevron" src="assets/icons/arrow-right.svg" alt="" aria-hidden="true" width="18" height="18">
                </summary>
                <div class="bed-grid">${group.bed_ids.map(id => renderBed(bedsById.get(id), canManage, csrf)).join('')}</div>
            </details>`;
        };

        const renderMiniRoom = (group, bedsById) => {
            const seats = group.bed_ids.map(id => {
                const bed = bedsById.get(id);
                const label = `Bed ${bed.bed_code}, ${bed.status_label}`;
                return `<li class="transit-seat transit-seat--${escapeHtml(String(bed.status).toLowerCase())}" data-transit-bed="${Number(bed.id)}" data-status="${escapeHtml(bed.status)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
                    <span class="transit-seat-shape" aria-hidden="true"><svg class="transit-seat-icon" viewBox="0 0 48 48"><use href="#transit-bed-glyph"/></svg><strong class="transit-seat-code">${escapeHtml(bed.bed_code)}</strong></span>
                    <small class="transit-seat-status" aria-hidden="true">${escapeHtml(bed.status_label)}</small>
                </li>`;
            }).join('');
            return `<article class="transit-room" data-transit-room="${escapeHtml(group.id)}">
                <header class="transit-room-heading"><h3>${escapeHtml(group.label)}</h3><span>${Number(group.summary.total)} bed</span></header>
                <div class="transit-room-front" aria-hidden="true"></div>
                <ul class="transit-room-seats${group.bed_ids.length <= 2 ? ' transit-room-seats-small' : ''}" aria-label="Bed kamar ${escapeHtml(group.label)}">${seats}</ul>
            </article>`;
        };

        const updateBeds = async () => {
            try {
                const response = await fetch('api.php?action=beds', { headers: { 'Accept': 'application/json' } });
                if (response.redirected) {
                    window.location.assign('index.php?page=login');
                    return;
                }
                if (!response.ok) return;
                const payload = await response.json();
                if (!payload.ok) return;
                const bedsById = new Map(payload.beds.map(bed => [bed.id, bed]));
                if (grid) {
                    const groups = qsa('[data-bed-group]', grid);
                    const openStates = new Map(groups.map(group => [group.dataset.bedGroup, group.open]));
                    const focusedGroup = document.activeElement?.matches('.bed-group-header')
                        ? document.activeElement.parentElement.dataset.bedGroup : null;
                    grid.innerHTML = payload.groups.map(group => renderGroup(group, bedsById, payload.canManage, payload.csrf,
                        openStates.get(group.id) ?? true)).join('');
                    if (focusedGroup) {
                        qsa('[data-bed-group]', grid).find(group => group.dataset.bedGroup === focusedGroup)
                            ?.querySelector('.bed-group-header').focus({ preventScroll: true });
                    }
                }
                if (miniMap) {
                    const signature = JSON.stringify([
                        payload.groups.map(group => [group.id, group.label, group.bed_ids]),
                        payload.beds.map(bed => [bed.id, bed.bed_code, bed.status, bed.status_label]),
                    ]);
                    if (signature !== miniMapSignature) {
                        miniMap.innerHTML = payload.groups.map(group => renderMiniRoom(group, bedsById)).join('');
                        const meta = qs('[data-transit-map-total]');
                        if (meta) meta.textContent = `${payload.beds.length} bed · ${payload.groups.length} kelompok kamar`;
                        miniMapSignature = signature;
                    }
                }
                qsa('[data-summary]').forEach((item) => {
                    const key = item.getAttribute('data-summary');
                    if (payload.summary[key] !== undefined) {
                        item.textContent = String(payload.summary[key]) + (item.dataset.summarySuffix || '');
                    }
                });
                const max = Math.max(1, payload.summary.empty, payload.summary.occupied, payload.summary.ready);
                qsa('[data-bed-bar]').forEach((bar) => {
                    bar.style.width = `${(Number(payload.summary[bar.dataset.bedBar]) / max) * 100}%`;
                });
            } catch (error) {
                return;
            }
        };

        setInterval(updateBeds, 15000);
    }
}());
