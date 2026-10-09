const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

const root = path.resolve(__dirname, '..');
const php = process.env.PHP_BINARY || 'C:\\xampp\\php\\php.exe';
const support = path.join(__dirname, 'support.php');
const database = `e_transit_qa_${Date.now()}_${process.pid}`;
const env = { ...process.env, DB_DATABASE: database };
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-functional-'));
const servers = [];
const errors = [];
const results = [];
const bedCodes = ['1A', '1B', '1C', '1D', '1E', '1F', '2A', '2B', '2C', '2D', '2E', '2F', '4A', '4B', '4C', '5A', '5B', 'Iso A', 'Iso B'];
const bedGroupLabels = ['1A-1F', '2A-2F', '4A-4C', '5A-5B', 'Isolasi'];
let browser;
let created = false;
let before;

function cli(command, input = null, environment = env) {
    const output = execFileSync(php, [support, command], {
        cwd: root, env: environment, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true,
    });
    return output ? JSON.parse(output) : null;
}
const query = (sql, params = []) => cli('query', { sql, params });
const one = (sql, params = []) => query(sql, params)[0];
const count = (table, where = '1=1', params = []) => Number(one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params).n);
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const date = (value) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value).replace(' ', 'T');
const arrival = (minutes) => date(new Date(Date.now() - minutes * 60000));

async function check(name, work) {
    try {
        await work();
        results.push({ name, ok: true });
        console.log(`PASS ${name}`);
        return true;
    } catch (error) {
        results.push({ name, ok: false, error: error.message });
        console.log(`FAIL ${name}: ${error.message.slice(0, 600)}`);
        return false;
    }
}

async function startServer() {
    const port = await new Promise(resolve => {
        const socket = net.createServer();
        socket.listen(0, '127.0.0.1', () => {
            const selected = socket.address().port;
            socket.close(() => resolve(selected));
        });
    });
    const child = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    const logfile = fs.createWriteStream(path.join(temporary, `server-${port}.log`));
    child.stderr.pipe(logfile);
    servers.push(child);
    const base = `http://127.0.0.1:${port}/`;
    for (let attempt = 0; attempt < 60; attempt++) {
        try { if ((await fetch(`${base}index.php?page=login`)).ok) return base; } catch {}
        await pause(100);
    }
    throw new Error('Server uji PHP tidak dapat dijalankan.');
}

async function client(base) {
    const context = await browser.newContext({ baseURL: base, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return { context, page, base };
}

async function post(c, target, data, options = {}) {
    const href = `${c.base}index.php?page=${target}`;
    const get = await c.context.request.get(href);
    const token = (await get.text()).match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.ok(token, `CSRF token missing on ${target}`);
    return c.context.request.post(href, {
        form: { _csrf: token, ...data }, headers: { Referer: href }, ...options,
    });
}

async function login(c, identity, password, landing) {
    await c.page.goto(`${c.base}index.php?page=login`);
    const old = (await c.context.cookies()).find(cookie => cookie.name === 'ETRANSITSESSID')?.value;
    await c.page.locator('[name=identity]').fill(identity);
    await c.page.locator('[name=password]').fill(password);
    await Promise.all([
        c.page.waitForURL(url => url.searchParams.get('page') === landing),
        c.page.locator('.auth-submit').click(),
    ]);
    const cookie = (await c.context.cookies()).find(item => item.name === 'ETRANSITSESSID');
    assert.ok(cookie.httpOnly);
    assert.equal(cookie.sameSite, 'Lax');
    assert.notEqual(cookie.value, old);
    assert.match((await c.context.request.get(`${c.base}index.php?page=${landing}`)).headers()['cache-control'], /no-store/);
}

async function fill(c, fields) {
    for (const [name, value] of Object.entries(fields)) {
        const field = c.page.locator(`[name="${name}"]`).last();
        const tag = await field.evaluate(item => item.tagName);
        if (tag === 'SELECT') await field.selectOption(String(value));
        else await field.fill(String(value));
    }
}

async function submit(c, selector, suffix) {
    await Promise.all([
        suffix ? c.page.waitForURL(url => url.href.endsWith(suffix)) : c.page.waitForNavigation(),
        c.page.locator(selector).click(),
    ]);
}

async function confirmedSubmit(c, selector, accept, suffix) {
    const waiting = c.page.waitForEvent('dialog');
    const navigation = accept ? (suffix ? c.page.waitForURL(url => url.href.endsWith(suffix)) : c.page.waitForNavigation()) : Promise.resolve();
    const clicking = c.page.locator(selector).click();
    const dialog = await waiting;
    if (accept) await dialog.accept();
    else await dialog.dismiss();
    await clicking;
    await navigation;
}

function patient(mr, doctor, minutes = 90, extra = {}) {
    return {
        action: 'save_patient', medical_record_number: mr, full_name: `Pasien Uji ${mr}`,
        identity_number: '0012345678901234', religion: 'Islam', payer_type: 'BPJS-Non PBI', care_class: 'Kelas II',
        guardian_name: 'Penanggung Jawab Uji', guardian_relationship: 'Suami', guardian_phone: '081234567890', education: 'SMA',
        gender: 'L', birth_date: '1990-01-01', address: 'Alamat pengujian',
        marital_status: 'Menikah', dependency_level: 'Minimal Care', doctor_id: String(doctor),
        diagnosis: 'Observasi pengujian', consciousness_status: 'Compos Mentis',
        planned_room: 'Hasan bin Ali', arrival_time: arrival(minutes), blood_pressure: '120/80',
        pulse: '80 x/menit', respiration: '20 x/menit', temperature: '36.8 C',
        oxygen_saturation: '98%', vital_notes: 'Catatan pengujian', ...extra,
    };
}

function updateBeds(mode = '--apply') {
    return execFileSync(php, [path.join(root, 'database/update_beds.php'), mode], {
        cwd: root, env, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function main() {
    before = cli('fingerprint', null, process.env);
    fs.writeFileSync(path.join(temporary, 'application-before.json'), JSON.stringify(before));
    execFileSync(php, [support, 'create'], { cwd: root, env, windowsHide: true });
    created = true;
    await check('Patient migration preserves legacy rows and is idempotent', async () => {
        const columns = ['identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education'];
        query("INSERT INTO patients (medical_record_number,full_name,gender,birth_date,address,marital_status,dependency_level,doctor_id,diagnosis,consciousness_status,planned_room,arrival_time,status,deleted_at) VALUES ('QA-MIGRATION','Pasien Lama Uji','L','1990-01-01','Alamat Lama','Menikah','Minimal Care',1,'Diagnosis Lama','Status Lama','Ruangan Lama',NOW(),'CANCELLED',NOW())");
        const previous = one("SELECT * FROM patients WHERE medical_record_number = 'QA-MIGRATION'");
        query(`ALTER TABLE patients ${columns.map(column => `DROP COLUMN ${column}`).join(', ')}`);
        for (let run = 0; run < 2; run++) {
            execFileSync(php, [path.join(root, 'database/migrate.php')], { cwd: root, env, windowsHide: true });
            assert.deepEqual(one("SELECT * FROM patients WHERE medical_record_number = 'QA-MIGRATION'"), previous);
        }
    });
    await check('Initial inventory contains exactly the 19 requested bed codes including isolation', async () => {
        assert.deepEqual(query('SELECT bed_code FROM beds ORDER BY bed_code').map(bed => bed.bed_code), bedCodes);
    });
    await check('Bed reconciliation preserves occupied beds and history, removes unused extras, and rolls back unsafe changes', async () => {
        const beds = query('SELECT * FROM beds ORDER BY bed_code');
        const fixtures = [
            { mr: 'QA-BED-ACTIVE', bed: beds[0], status: 'ACTIVE', bedStatus: 'TERISI' },
            { mr: 'QA-BED-READY', bed: beds[1], status: 'READY_TRANSFER', bedStatus: 'SIAP_TRANSFER' },
            { mr: 'QA-BED-HISTORY', bed: beds[2], status: 'TRANSFERRED', bedStatus: 'KOSONG' },
        ];
        const addFixture = fixture => {
            query("INSERT INTO patients (medical_record_number,full_name,gender,birth_date,address,marital_status,dependency_level,doctor_id,diagnosis,consciousness_status,planned_room,arrival_time,bed_id,status) VALUES (?,'Pasien Uji Bed','L','1990-01-01','Alamat Uji','Menikah','Minimal Care',1,'Observasi','Compos Mentis','Hasan bin Ali',NOW(),?,?)", [fixture.mr, fixture.bed.id, fixture.status]);
            fixture.id = one('SELECT id FROM patients WHERE medical_record_number = ?', [fixture.mr]).id;
            query("INSERT INTO vital_signs (patient_id,blood_pressure,pulse,respiration,temperature,oxygen_saturation) VALUES (?,'120/80','80','20','36.8','98%')", [fixture.id]);
            if (fixture.status !== 'TRANSFERRED') {
                query('UPDATE beds SET status = ?, patient_id = ? WHERE id = ?', [fixture.bedStatus, fixture.id, fixture.bed.id]);
            }
        };
        try {
            for (const fixture of fixtures) addFixture(fixture);
            query('UPDATE beds SET bed_code = ? WHERE id = ?', ['BED READY LAMA', fixtures[1].bed.id]);
            query('UPDATE beds SET bed_code = ? WHERE id = ?', ['BED HISTORI LAMA', fixtures[2].bed.id]);
            query("INSERT INTO transfers (patient_id,bed_id,destination_room,transfer_time,stay_minutes) VALUES (?,?,'Hasan bin Ali',NOW(),90)", [fixtures[2].id, fixtures[2].bed.id]);
            query("INSERT INTO beds (bed_code,status) VALUES ('BED TAMBAHAN LAMA','KOSONG')");
            const beforeDryRun = cli('fingerprint');
            assert.match(updateBeds('--dry-run'), /database tidak berubah/);
            assert.deepEqual(cli('fingerprint'), beforeDryRun);
            const clinical = Object.fromEntries(['patients', 'vital_signs', 'transfers', 'doctors'].map(table => [table, query(`SELECT * FROM ${table} ORDER BY id`)]));
            updateBeds();
            assert.deepEqual(query('SELECT bed_code FROM beds ORDER BY bed_code').map(bed => bed.bed_code), bedCodes);
            assert.equal(one('SELECT bed_code FROM beds WHERE id = ?', [fixtures[0].bed.id]).bed_code, '1A');
            for (const fixture of fixtures) {
                const bed = one('SELECT * FROM beds WHERE id = ?', [fixture.bed.id]);
                assert.equal(bed.status, fixture.bedStatus);
                assert.equal(bed.patient_id, fixture.status === 'TRANSFERRED' ? null : fixture.id);
            }
            for (const [table, records] of Object.entries(clinical)) assert.deepEqual(query(`SELECT * FROM ${table} ORDER BY id`), records);
            const inventory = query('SELECT * FROM beds ORDER BY id');
            updateBeds();
            assert.deepEqual(query('SELECT * FROM beds ORDER BY id'), inventory);

            query("INSERT INTO beds (bed_code,status) VALUES ('BED MASIH TERISI','KOSONG')");
            const blocked = { mr: 'QA-BED-BLOCKED', bed: one("SELECT * FROM beds WHERE bed_code = 'BED MASIH TERISI'"), status: 'ACTIVE', bedStatus: 'TERISI' };
            fixtures.push(blocked);
            addFixture(blocked);
            const beforeBlocked = cli('fingerprint');
            assert.throws(() => updateBeds(), error => error.status === 1 && /masih dipakai atau terkait histori pasien/.test(error.stderr));
            assert.deepEqual(cli('fingerprint'), beforeBlocked);
        } finally {
            for (const fixture of fixtures) {
                if (!fixture.id) continue;
                query("UPDATE beds SET patient_id = NULL, status = 'KOSONG' WHERE id = ?", [fixture.bed.id]);
                query('DELETE FROM transfers WHERE patient_id = ?', [fixture.id]);
                query('DELETE FROM vital_signs WHERE patient_id = ?', [fixture.id]);
                query('DELETE FROM patients WHERE id = ?', [fixture.id]);
            }
            query("DELETE FROM beds WHERE bed_code = 'BED MASIH TERISI'");
        }
    });
    await check('Bed reconciliation adds missing beds and leaves an already-correct inventory unchanged', async () => {
        query("DELETE FROM beds WHERE bed_code = 'Iso B'");
        updateBeds();
        assert.deepEqual(query('SELECT bed_code FROM beds ORDER BY bed_code').map(bed => bed.bed_code), bedCodes);
        const before = cli('fingerprint');
        updateBeds();
        assert.deepEqual(cli('fingerprint'), before);
    });
    const base = await startServer();
    const secondBase = await startServer();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const admin = await client(base);
    const igd = await client(base);
    const transit = await client(base);
    const anonymous = await client(base);

    await check('Private pages require login', async () => {
        for (const menu of ['dashboard', 'transit', 'patient_form', 'patients', 'doctors', 'transfer', 'reports', 'export', 'beds', 'users', 'audit', 'profile']) {
            const response = await anonymous.context.request.get(`index.php?page=${menu}`, { maxRedirects: 0 });
            assert.equal(response.status(), 302);
            assert.match(response.headers().location, /page=login/);
        }
    });
    await check('Wrong password and SQL-injection login rejected', async () => {
        for (const identity of ['admin', "' OR 1=1 --", 'unknown-user']) {
            const response = await post(anonymous, 'login', { identity, password: 'Wrong@123' });
            assert.match(await response.text(), /Username atau password tidak valid/);
        }
    });
    await check('First-request POST without CSRF is rejected', async () => {
        const c = await client(base);
        const response = await c.context.request.post('index.php?page=login', { form: { identity: 'admin', password: 'Admin@123' } });
        assert.equal(new URL(response.url()).searchParams.get('page') || 'login', 'login');
        assert.match(await response.text(), /Sesi formulir tidak valid/);
        await c.context.close();
    });
    await check('Admin login, secure cookie, regenerated session, cache headers', () => login(admin, 'admin', 'Admin@123', 'dashboard'));
    await check('IGD login and monitor redirect', () => login(igd, 'igd', 'Igd@1234', 'monitor'));
    await check('Transit email login and dashboard redirect', () => login(transit, 'transit@etransit.local', 'Transit@123', 'dashboard'));

    const register = {
        full_name: 'Perawat Pengujian', username: 'qa_register', email: 'qa_register@example.test',
        identity_number: 'QA-001', role: 'perawat_transit', password: 'Testing@123', password_confirm: 'Testing@123',
    };
    await check('Register validation: weak password, mismatch, invalid email, admin role, invalid username', async () => {
        for (const data of [
            { password: 'weak', password_confirm: 'weak' }, { password_confirm: 'Different@123' },
            { email: 'invalid' }, { role: 'admin' }, { username: 'bad user' },
        ]) {
            const response = await post(anonymous, 'register', { ...register, ...data });
            assert.match(response.url(), /page=register/);
            assert.equal(count('users', 'username = ?', ['qa_register']), 0);
        }
    });
    await check('Register real browser form and password eye controls', async () => {
        await anonymous.page.goto(`${base}index.php?page=register`);
        await fill(anonymous, register);
        const eye = anonymous.page.locator('[aria-controls=register-password-confirm]');
        await eye.click();
        assert.equal(await anonymous.page.locator('#register-password-confirm').getAttribute('type'), 'text');
        await eye.click();
        assert.equal(await anonymous.page.locator('#register-password-confirm').getAttribute('type'), 'password');
        await submit(anonymous, '.auth-submit', 'page=login');
        const user = one('SELECT password_hash FROM users WHERE username = ?', ['qa_register']);
        assert.ok(user);
        assert.match(user.password_hash, /^\$2y\$/);
        assert.notEqual(user.password_hash, register.password);
    });
    await check('Duplicate username and email registration rejected', async () => {
        for (const data of [{ username: register.username, email: 'new@example.test' }, { username: 'qa_new', email: register.email }]) {
            const response = await post(anonymous, 'register', { ...register, ...data });
            assert.match(await response.text(), /sudah digunakan/);
        }
    });
    await check('Registered account can log in with email', () => login(anonymous, register.email, register.password, 'dashboard'));
    await check('Register IGD role persists and routes to monitor', async () => {
        const c = await client(base);
        await post(c, 'register', { ...register, username: 'qa_igd', email: 'qa_igd@example.test', role: 'perawat_igd' });
        await login(c, 'qa_igd', register.password, 'monitor');
        await c.context.close();
    });

    await check('All role pages return 200 without broken assets', async () => {
        for (const [c, menus] of [
            [admin, ['dashboard', 'monitor', 'transit', 'patients', 'patient_form', 'doctors', 'transfer', 'reports', 'beds', 'users', 'audit', 'profile']],
            [igd, ['dashboard', 'monitor', 'profile']],
            [transit, ['dashboard', 'transit', 'patients', 'patient_form', 'doctors', 'transfer', 'reports', 'profile']],
        ]) {
            for (const menu of menus) {
                assert.equal((await c.page.goto(`${base}index.php?page=${menu}`)).status(), 200);
                await c.page.waitForFunction(() => Array.from(document.images).every(image => image.complete));
                assert.deepEqual(await c.page.locator('img').evaluateAll(images => images.filter(img => img.naturalWidth === 0).map(img => img.getAttribute('src'))), [], menu);
            }
        }
    });
    await check('Requested bed codes appear on transit pages, IGD monitor and live bed API', async () => {
        for (const [c, page] of [[admin, 'transit'], [transit, 'transit'], [igd, 'monitor']]) {
            await c.page.goto(`${base}index.php?page=${page}`);
            assert.deepEqual(await c.page.locator('.bed-card header > strong').allTextContents(), bedCodes);
            const payload = await (await c.context.request.get('api.php?action=beds')).json();
            assert.deepEqual(payload.beds.map(bed => bed.bed_code), bedCodes);
            assert.equal(payload.summary.active, 19);
            assert.deepEqual(payload.groups.map(group => group.label), bedGroupLabels);
            assert.deepEqual(payload.groups.map(group => group.summary.total), [6, 6, 3, 2, 2]);
            assert.deepEqual(payload.groups.map(group => group.summary.empty), [6, 6, 3, 2, 2]);
            assert.deepEqual(payload.groups.flatMap(group => group.bed_ids), payload.beds.map(bed => bed.id));
        }
    });
    await check('Grouped beds render without overflow, collapse accessibly, and keep isolation separate on every role', async () => {
        for (const [role, c, page] of [['admin', admin, 'transit'], ['transit', transit, 'transit'], ['igd', igd, 'monitor']]) {
            for (const width of [1440, 1024, 390, 320]) {
                await c.page.setViewportSize({ width, height: 900 });
                await c.page.goto(`${base}index.php?page=${page}`);
                assert.deepEqual(await c.page.locator('.bed-group-title h2').allTextContents(), bedGroupLabels);
                assert.deepEqual(await c.page.locator('[data-bed-group=isolation] .bed-card header > strong').allTextContents(), ['Iso A', 'Iso B']);
                assert.deepEqual(await c.page.locator('[data-bed-group=area_5] .bed-card header > strong').allTextContents(), ['5A', '5B']);
                assert.ok(await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                assert.deepEqual(await c.page.locator('.bed-group-header, .bed-card').evaluateAll(items => items.filter(item => {
                    const bounds = item.getBoundingClientRect();
                    return bounds.left < 0 || bounds.right > innerWidth + 1;
                }).map(item => item.textContent)), []);
                await c.page.screenshot({ path: path.join(temporary, `grouped-beds-${role}-${width}.png`), fullPage: true });
                const header = c.page.locator('[data-bed-group=area_2] summary');
                await header.focus();
                await c.page.keyboard.press('Enter');
                assert.equal(await c.page.locator('[data-bed-group=area_2]').evaluate(group => group.open), false);
                assert.equal(await c.page.locator('[data-bed-group=area_2] .bed-card').first().isVisible(), false);
                await c.page.keyboard.press('Enter');
                assert.equal(await c.page.locator('[data-bed-group=area_2]').evaluate(group => group.open), true);
                if (role === 'igd') assert.equal(await c.page.locator('.bed-actions button').count(), 0);
            }
            await c.page.setViewportSize({ width: 1440, height: 900 });
        }
    });
    await check('Updated transit criteria render consistently on every role dashboard at desktop and mobile widths', async () => {
        const criteria = [
            ['Status Kesadaran', 'Compos Mentis E4V5M6 atau Apatis ringan yang stabil. Tidak mengalami penurunan kesadaran progresif.'],
            ['Parameter Vital Sign', 'TD (100-140 mmHg), HR (60-100\u00d7/menit), RR (16-24x/menit), SpO2 (>95%) dengan/tanpa O2 Nasal Cannul.'],
            ['Eksklusi', 'Kasus resusitasi atau syok, gangguan napas berat (Ventilator/CPAP), penurunan kesadaran (GCS <11).'],
        ];
        for (const [role, c] of [['admin', admin], ['igd', igd], ['transit', transit]]) {
            for (const width of [1440, 390, 320]) {
                await c.page.setViewportSize({ width, height: 900 });
                assert.equal((await c.page.goto(`${base}index.php?page=dashboard`)).status(), 200);
                assert.deepEqual(await c.page.locator('.dashboard-criterion').evaluateAll(items => items.map(item => [
                    item.querySelector('strong').textContent, item.querySelector('p').textContent,
                ])), criteria);
                assert.ok(await c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                assert.deepEqual(await c.page.locator('.dashboard-criterion p').evaluateAll(items => items.filter(item => {
                    const text = document.createRange();
                    text.selectNodeContents(item);
                    const bounds = item.getBoundingClientRect();
                    return Array.from(text.getClientRects()).some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                        || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
                }).map(item => item.textContent)), []);
                await c.page.screenshot({ path: path.join(temporary, `dashboard-criteria-${role}-${width}.png`), fullPage: true });
            }
            await c.page.setViewportSize({ width: 1440, height: 900 });
        }
    });
    await check('Hospital letterhead shows supplied logos and contact details on every dashboard without overlap', async () => {
        for (const [role, c, otherPage] of [['admin', admin, 'patients'], ['igd', igd, 'monitor'], ['transit', transit, 'transit']]) {
            for (const width of [1440, 1024, 390, 320]) {
                await c.page.setViewportSize({ width, height: 900 });
                await c.page.goto(`${base}index.php?page=dashboard`);
                const header = c.page.locator('.dashboard-institution');
                assert.equal(await header.count(), 1);
                assert.deepEqual(await header.locator('img').evaluateAll(items => items.map(item => item.getAttribute('src'))), ['logo_jabar.png', 'logo_rsud.png']);
                assert.equal(await header.locator('img').evaluateAll(items => items.filter(item => !item.complete || item.naturalWidth === 0).length), 0);
                assert.equal(await header.locator('.dashboard-institution-government').innerText(), 'PEMERINTAH PROVINSI JAWA BARAT');
                assert.equal(await header.locator('.dashboard-institution-office').innerText(), 'DINAS KESEHATAN');
                assert.equal(await header.locator('h2').innerText(), 'UOBK RUMAH SAKIT\nUMUM DAERAH WELAS ASIH');
                assert.ok((await header.innerText()).includes('Jl. Kiastramanggala Baleendah, Kab. Bandung'));
                assert.ok((await header.innerText()).includes('Fax. 5941709'));
                assert.equal(await header.locator('a[href="tel:+62225940872"]').innerText(), '(022) 5940872');
                assert.equal(await header.locator('a[href="tel:+62225940875"]').innerText(), '5940875');
                assert.equal(await header.locator('a[href="mailto:rsudwelasasih@jabarprov.go.id"]').innerText(), 'rsudwelasasih@jabarprov.go.id');
                assert.ok(await c.page.evaluate(() => {
                    const header = document.querySelector('.dashboard-institution');
                    const [left, right] = header.querySelectorAll('img');
                    const copy = header.querySelector('.dashboard-institution-copy').getBoundingClientRect();
                    return document.documentElement.scrollWidth <= innerWidth + 1
                        && left.getBoundingClientRect().right <= copy.left
                        && right.getBoundingClientRect().left >= copy.right
                        && header.getBoundingClientRect().bottom <= document.querySelector('.topbar').getBoundingClientRect().top;
                }));
                assert.deepEqual(await header.locator('p, h2, a').evaluateAll(items => items.filter(item => {
                    const text = document.createRange();
                    text.selectNodeContents(item);
                    const bounds = document.querySelector('.dashboard-institution').getBoundingClientRect();
                    return Array.from(text.getClientRects()).some(rect => rect.left < bounds.left || rect.right > bounds.right
                        || rect.top < bounds.top || rect.bottom > bounds.bottom);
                }).map(item => item.textContent)), []);
                await c.page.screenshot({ path: path.join(temporary, `dashboard-letterhead-${role}-${width}.png`), fullPage: true });
            }
            await c.page.goto(`${base}index.php?page=${otherPage}`);
            assert.equal(await c.page.locator('.dashboard-institution').count(), 0);
            await c.page.setViewportSize({ width: 1440, height: 900 });
        }
    });
    await check('IGD cannot access management pages; Transit cannot access Admin pages', async () => {
        for (const menu of ['transit', 'patients', 'patient_form', 'doctors', 'transfer', 'reports', 'export', 'beds', 'users', 'audit']) {
            assert.equal((await igd.context.request.get(`index.php?page=${menu}`)).status(), 403);
        }
        for (const menu of ['beds', 'users', 'audit']) {
            assert.equal((await transit.context.request.get(`index.php?page=${menu}`)).status(), 403);
        }
    });
    await check('IGD cannot bypass authorization with forged POST actions', async () => {
        for (const action of ['save_patient', 'delete_patient', 'mark_ready', 'save_transfer_plan', 'transfer_selected', 'save_doctor', 'delete_doctor', 'save_bed', 'toggle_bed', 'save_user', 'toggle_user']) {
            assert.equal((await post(igd, 'monitor', { action, id: 1 })).status(), 403);
        }
    });
    await check('CSRF rejection does not write data', async () => {
        const n = count('beds');
        const response = await post(admin, 'beds', { action: 'save_bed', bed_code: 'CSRF BED', status: 'KOSONG', _csrf: 'invalid' });
        assert.match(await response.text(), /Sesi formulir tidak valid/);
        assert.equal(count('beds'), n);
    });

    await check('Doctor create with new specialization through browser', async () => {
        await admin.page.goto(`${base}index.php?page=doctors`);
        await fill(admin, { name: 'Dr. QA', new_specialization: 'Spesialis QA', keywords: 'pengujian,qa', specialization_id: '' });
        await submit(admin, 'form:has([name=action][value=save_doctor]) button[type=submit]');
        assert.equal(count('doctors', 'name = ?', ['Dr. QA']), 1);
        assert.equal(count('specializations', 'name = ?', ['Spesialis QA']), 1);
    });
    const doctorId = Number(one('SELECT id FROM doctors WHERE name = ?', ['Dr. QA'])?.id);
    const specId = Number(one('SELECT specialization_id FROM doctors WHERE id = ?', [doctorId])?.specialization_id);
    await check('Doctor edit and deactivate', async () => {
        await post(transit, 'doctors', { action: 'save_doctor', id: doctorId, name: 'Dr. QA Edited', specialization_id: specId });
        assert.equal(one('SELECT name,is_active FROM doctors WHERE id = ?', [doctorId]).is_active, 0);
        await transit.page.goto(`${base}index.php?page=patient_form`);
        assert.equal(await transit.page.locator(`[name=doctor_id] option[value="${doctorId}"]`).count(), 0);
    });
    await check('Inactive doctor denied for new patient', async () => {
        await post(transit, 'patient_form', patient('QA-INACTIVE', doctorId));
        assert.equal(count('patients', 'medical_record_number = ?', ['QA-INACTIVE']), 0);
    });
    await post(admin, 'doctors', { action: 'save_doctor', id: doctorId, name: 'Dr. QA Edited', specialization_id: specId, is_active: 1 });
    await check('Doctor recommendation uses specialization keywords', async () => {
        await transit.page.goto(`${base}index.php?page=patient_form`);
        await transit.page.locator('[name=diagnosis]').fill('pengujian');
        assert.match(await transit.page.locator('[data-doctor-recommendation]').innerText(), /Dr\. QA Edited/);
    });
    await check('Dermatologi and Venereologi available, persisted and not duplicated by migration', async () => {
        const records = query("SELECT * FROM specializations WHERE name IN ('Spesialis Dermatologi', 'Spesialis Venereologi') ORDER BY name");
        assert.equal(records.length, 2);
        execFileSync(php, [path.join(root, 'database/migrate.php')], { cwd: root, env, windowsHide: true });
        assert.deepEqual(query("SELECT * FROM specializations WHERE name IN ('Spesialis Dermatologi', 'Spesialis Venereologi') ORDER BY name"), records);
        for (const [index, spec] of records.entries()) {
            assert.equal(spec.is_active, 1);
            await transit.page.goto(`${base}index.php?page=doctors`);
            assert.equal(await transit.page.locator(`[name=specialization_id] option[value="${spec.id}"]`).innerText(), spec.name);
            const name = `Dr. QA Specialization ${index}`;
            await fill(transit, { name, specialization_id: spec.id });
            await submit(transit, 'form:has([name=action][value=save_doctor]) button[type=submit]');
            const doctor = one('SELECT * FROM doctors WHERE name = ?', [name]);
            assert.equal(doctor.specialization_id, spec.id);
            await transit.page.goto(`${base}index.php?page=doctors&edit=${doctor.id}`);
            assert.equal(await transit.page.locator('[name=specialization_id]').inputValue(), String(spec.id));
            await post(transit, 'doctors', { action: 'delete_doctor', id: doctor.id });
        }
    });
    await check('BPJS PBI APBD and APBN save, edit, detail and export correctly', async () => {
        const payers = ['BPJS PBI APBD', 'BPJS PBI APBN'];
        for (const [index, payer] of payers.entries()) {
            const data = patient(`QA-PAYER-${index}`, doctorId, 90, { payer_type: payer, diagnosis: `QA-PAYER-DIAGNOSIS-${index}` });
            await transit.page.goto(`${base}index.php?page=patient_form`);
            await fill(transit, Object.fromEntries(Object.entries(data).filter(([field]) => field !== 'action')));
            await submit(transit, '[data-patient-form] .panel-title button[type=submit]', 'page=patients');
            const saved = one('SELECT * FROM patients WHERE medical_record_number = ?', [data.medical_record_number]);
            assert.equal(saved.payer_type, payer);
            await transit.page.goto(`${base}index.php?page=patient_detail&id=${saved.id}`);
            assert.ok((await transit.page.locator('.detail-panel').innerText()).includes(payer));
            await transit.page.goto(`${base}index.php?page=patient_form&id=${saved.id}`);
            assert.equal(await transit.page.locator('[name=payer_type]').inputValue(), payer);
            const editedPayer = payers[1 - index];
            await transit.page.locator('[name=payer_type]').selectOption(editedPayer);
            await submit(transit, '[data-patient-save-bottom]', 'page=patients');
            assert.equal(one('SELECT payer_type FROM patients WHERE id = ?', [saved.id]).payer_type, editedPayer);
            const response = await transit.context.request.get(`index.php?page=export&diagnosis=${data.diagnosis}`);
            const filename = path.join(temporary, `payer-${index}.xlsx`);
            fs.writeFileSync(filename, await response.body());
            const rows = cli('xlsx', { path: filename });
            assert.equal(rows.length, 2);
            assert.equal(rows[1][17], editedPayer);
            await post(transit, 'patients', { action: 'delete_patient', id: saved.id });
        }
    });
    await check('Registration options and layout at desktop, mobile and narrow widths', async () => {
        const choices = {
            religion: ['Islam', 'Kristen', 'Katolik', 'Buddha', 'Konghucu', 'Hindu', 'Lainnya'],
            payer_type: ['BPJS-Non PBI', 'BPJS PBI APBD', 'BPJS PBI APBN', 'SKTM', 'Umum'], care_class: ['Kelas I', 'Kelas II', 'Kelas III'],
            planned_room: ['Hasan bin Ali', 'Husain bin Ali', 'Said bin Zaid'], consciousness_status: ['Compos Mentis', 'Apatis'],
        };
        for (const width of [1440, 390, 320]) {
            await transit.page.setViewportSize({ width, height: 900 });
            await transit.page.goto(`${base}index.php?page=patient_form`);
            for (const [field, values] of Object.entries(choices)) {
                assert.deepEqual(await transit.page.locator(`select[name=${field}] option:not([value=""])`).allTextContents(), values);
            }
            assert.ok(await transit.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            assert.deepEqual(await transit.page.locator('[data-patient-form] input:not([type=hidden]), [data-patient-form] select, [data-patient-form] textarea').evaluateAll(fields => fields.filter(field => {
                const rect = field.getBoundingClientRect();
                return rect.left < 0 || rect.right > innerWidth + 1;
            }).map(field => field.name)), []);
            await transit.page.screenshot({ path: path.join(temporary, `patient-registration-${width}.png`), fullPage: true });
        }
        await transit.page.setViewportSize({ width: 1440, height: 900 });
    });
    await check('Retired BPJS PBI cannot be selected or assigned, while legacy data is preserved', async () => {
        const data = patient('QA-RETIRED-PAYER', doctorId);
        const rejected = await post(transit, 'patient_form', { ...data, payer_type: 'BPJS PBI' });
        assert.match(await rejected.text(), /Penanggung pasien tidak valid/);
        assert.equal(count('patients', 'medical_record_number = ?', [data.medical_record_number]), 0);
        await transit.page.goto(`${base}index.php?page=patient_form`);
        assert.equal(await transit.page.locator('[name=payer_type] option[value="BPJS PBI"]').count(), 0);

        await post(transit, 'patient_form', data);
        const saved = one('SELECT * FROM patients WHERE medical_record_number = ?', [data.medical_record_number]);
        const invalidEdit = await post(transit, `patient_form&id=${saved.id}`, { ...data, id: saved.id, payer_type: 'BPJS PBI' });
        assert.match(await invalidEdit.text(), /Penanggung pasien tidak valid/);
        assert.equal(one('SELECT payer_type FROM patients WHERE id = ?', [saved.id]).payer_type, data.payer_type);

        query('UPDATE patients SET payer_type = ? WHERE id = ?', ['BPJS PBI', saved.id]);
        await transit.page.goto(`${base}index.php?page=patient_form&id=${saved.id}`);
        assert.equal(await transit.page.locator('[name=payer_type]').inputValue(), 'BPJS PBI');
        assert.equal(await transit.page.locator('[name=payer_type] option[value="BPJS PBI"]:disabled').count(), 1);
        assert.equal(await transit.page.locator('[name=payer_type] option[value="BPJS PBI"]:enabled').count(), 0);
        await fill(transit, { education: 'D3' });
        await submit(transit, '[data-patient-save-bottom]', 'page=patients');
        assert.equal(one('SELECT payer_type FROM patients WHERE id = ?', [saved.id]).payer_type, 'BPJS PBI');
        assert.equal(one('SELECT education FROM patients WHERE id = ?', [saved.id]).education, 'D3');

        await transit.page.goto(`${base}index.php?page=patient_form&id=${saved.id}`);
        await transit.page.locator('[name=payer_type]').selectOption('BPJS PBI APBN');
        await submit(transit, '[data-patient-save-bottom]', 'page=patients');
        assert.equal(one('SELECT payer_type FROM patients WHERE id = ?', [saved.id]).payer_type, 'BPJS PBI APBN');
        await transit.page.goto(`${base}index.php?page=patient_form&id=${saved.id}`);
        assert.equal(await transit.page.locator('[name=payer_type] option[value="BPJS PBI"]').count(), 0);

        query('UPDATE patients SET payer_type = ? WHERE id = ?', ['BPJS PBI', saved.id]);
        await transit.page.goto(`${base}index.php?page=patient_form&id=${saved.id}`);
        await transit.page.locator('[name=payer_type]').selectOption('');
        await submit(transit, '[data-patient-save-bottom]', 'page=patients');
        assert.equal(one('SELECT payer_type FROM patients WHERE id = ?', [saved.id]).payer_type, null);
        await post(transit, 'patients', { action: 'delete_patient', id: saved.id });
    });
    await check('Empty active-doctor list shows a working master-doctor link', async () => {
        const doctors = query('SELECT id FROM doctors WHERE is_active = 1');
        try {
            query('UPDATE doctors SET is_active = 0 WHERE is_active = 1');
            await transit.page.goto(`${base}index.php?page=patient_form`);
            assert.match(await transit.page.locator('[role=status]').innerText(), /Belum ada dokter DPJP aktif/);
            assert.match(await transit.page.locator('[role=status] a').getAttribute('href'), /page=doctors/);
        } finally {
            for (const doctor of doctors) query('UPDATE doctors SET is_active = 1 WHERE id = ?', [doctor.id]);
        }
    });

    await check('Admin bed add and active toggle', async () => {
        await admin.page.goto(`${base}index.php?page=beds`);
        await fill(admin, { bed_code: 'QA BED', status: 'NONAKTIF' });
        await submit(admin, 'form:has([name=action][value=save_bed]) button');
        const bed = one('SELECT * FROM beds WHERE bed_code = ?', ['QA BED']);
        assert.equal(bed.status, 'NONAKTIF');
        await post(admin, 'beds', { action: 'toggle_bed', id: bed.id });
        assert.equal(one('SELECT status FROM beds WHERE id = ?', [bed.id]).status, 'KOSONG');
    });
    await check('Duplicate bed rejected without SQL exposure', async () => {
        const response = await post(admin, 'beds', { action: 'save_bed', bed_code: 'QA BED', status: 'KOSONG' });
        assert.doesNotMatch(await response.text(), /SQLSTATE|PDOException/);
        assert.equal(count('beds', 'bed_code = ?', ['QA BED']), 1);
    });

    const first = patient('QA-001', doctorId, 120);
    const second = patient('QA-002', doctorId, 60, { gender: 'P', marital_status: 'Belum Menikah', diagnosis: 'Diagnosis Kedua' });
    await check('Patient registration assigns free bed and persists vital signs', async () => {
        await transit.page.goto(`${base}index.php?page=patient_form`);
        await fill(transit, Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'action')));
        await submit(transit, '[data-patient-form] .panel-title button[type=submit]', 'page=patients');
        const p = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-001']);
        assert.ok(p);
        assert.equal(p.status, 'ACTIVE');
        for (const field of ['identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education', 'planned_room', 'consciousness_status']) {
            assert.equal(p[field], first[field], field);
        }
        assert.equal(one('SELECT status,patient_id FROM beds WHERE id = ?', [p.bed_id]).patient_id, p.id);
        assert.equal(count('vital_signs', 'patient_id = ?', [p.id]), 1);
    });
    const p1 = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-001']);
    await check('Patient administrative fields displayed, reloaded, edited, and persisted', async () => {
        await transit.page.goto(`${base}index.php?page=patient_detail&id=${p1.id}`);
        const detail = await transit.page.locator('.detail-panel').innerText();
        for (const value of [first.identity_number, first.religion, first.payer_type, first.care_class, first.guardian_name, first.guardian_phone, first.education]) assert.ok(detail.includes(value), value);
        await transit.page.goto(`${base}index.php?page=patient_form&id=${p1.id}`);
        for (const field of ['identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education', 'planned_room', 'consciousness_status']) {
            assert.equal(await transit.page.locator(`[name=${field}]`).inputValue(), first[field], field);
        }
        await fill(transit, { payer_type: 'Umum', care_class: 'Kelas I', guardian_name: 'Keluarga Uji Edited', guardian_phone: '+6281234567890', religion: 'Katolik', education: 'S1', planned_room: 'Husain bin Ali', consciousness_status: 'Apatis' });
        await submit(transit, '[data-patient-form] .panel-title button[type=submit]', 'page=patients');
        const updated = one('SELECT * FROM patients WHERE id = ?', [p1.id]);
        assert.equal(updated.payer_type, 'Umum');
        assert.equal(updated.guardian_phone, '+6281234567890');
        assert.equal(updated.planned_room, 'Husain bin Ali');
        assert.equal(updated.consciousness_status, 'Apatis');
    });
    await check('Second patient receives another bed', async () => {
        await post(transit, 'patient_form', second);
        const p2 = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-002']);
        assert.ok(p2);
        assert.notEqual(p1.bed_id, p2.bed_id);
    });
    const p2 = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-002']);
    await check('Occupied bed cannot be deactivated', async () => {
        await post(admin, 'beds', { action: 'toggle_bed', id: p1.bed_id });
        assert.equal(one('SELECT status FROM beds WHERE id = ?', [p1.bed_id]).status, 'TERISI');
    });
    await check('Patient titles and duration helpers', async () => {
        assert.deepEqual(cli('helpers'), ['By.', 'An.', 'Tn.', 'Ny.', 'Nn.', '02 Jam 35 Menit']);
        await transit.page.goto(`${base}index.php?page=patient_detail&id=${p2.id}`);
        assert.match(await transit.page.locator('.detail-panel h2').innerText(), /^Nn\./);
    });
    await check('Patient detail and edit, including audited arrival correction', async () => {
        await post(transit, `patient_form&id=${p1.id}`, { ...first, id: p1.id, full_name: 'Pasien QA Edited', arrival_time: arrival(150), pulse: '88' });
        assert.equal(one('SELECT full_name FROM patients WHERE id = ?', [p1.id]).full_name, 'Pasien QA Edited');
        assert.equal(count('vital_signs', 'patient_id = ?', [p1.id]), 3);
        assert.ok(count('audit_logs', 'action = ?', ['Edit waktu kedatangan']) > 0);
    });
    await check('Validation: duplicate RM, future birthday, incomplete vitals', async () => {
        const n = count('patients');
        for (const data of [first, patient('QA-FUTURE', doctorId, 90, { birth_date: '2099-01-01' }), patient('QA-VITAL', doctorId, 90, { pulse: '' })]) {
            await post(transit, 'patient_form', data);
        }
        assert.equal(count('patients'), n);
    });
    await check('Strict invalid calendar birth date rejected', async () => {
        await post(transit, 'patient_form', patient('QA-BADDATE', doctorId, 90, { birth_date: '1990-02-31' }));
        assert.equal(count('patients', 'medical_record_number = ?', ['QA-BADDATE']), 0);
    });
    await check('Strict invalid calendar arrival date rejected', async () => {
        await post(transit, 'patient_form', patient('QA-BADARRIVAL', doctorId, 90, { arrival_time: '2026-02-31T10:00' }));
        assert.equal(count('patients', 'medical_record_number = ?', ['QA-BADARRIVAL']), 0);
    });
    await check('Future arrival rejected to preserve FIFO and duration', async () => {
        await post(transit, 'patient_form', patient('QA-FUTUREARRIVAL', doctorId, 90, { arrival_time: '2099-01-01T10:00' }));
        assert.equal(count('patients', 'medical_record_number = ?', ['QA-FUTUREARRIVAL']), 0);
    });
    await check('Patient validation gives actionable error', async () => {
        const response = await post(transit, 'patient_form', patient('QA-NONAME', doctorId, 90, { full_name: '' }));
        assert.match(await response.text(), /Nama pasien wajib diisi/);
        assert.match(await response.text(), /value="QA-NONAME"/);
    });
    await check('Invalid registration select values and phone rejected by backend', async () => {
        const n = count('patients');
        for (const [field, value] of Object.entries({ religion: 'INVALID', payer_type: 'INVALID', care_class: 'Kelas IV', planned_room: 'INVALID', consciousness_status: 'INVALID', guardian_phone: 'bukan nomor', identity_number: '<script>' })) {
            const response = await post(transit, 'patient_form', patient(`QA-INVALID-${field}`, doctorId, 90, { [field]: value }));
            assert.match(await response.text(), /tidak valid|wajib dipilih|nomor telepon|No\. KTP/);
        }
        assert.equal(count('patients'), n);
    });
    await check('Phone and identity browser constraints reject malformed data', async () => {
        await transit.page.goto(`${base}index.php?page=patient_form`);
        await fill(transit, { guardian_phone: 'nomor invalid', identity_number: '<script>' });
        assert.equal(await transit.page.locator('[name=guardian_phone]').evaluate(input => input.checkValidity()), false);
        assert.equal(await transit.page.locator('[name=identity_number]').evaluate(input => input.checkValidity()), false);
    });
    await check('Optional administrative fields and legacy room/status remain editable', async () => {
        const metadata = Object.fromEntries(['identity_number', 'religion', 'payer_type', 'care_class', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'education'].map(field => [field, '']));
        await post(transit, 'patient_form', patient('QA-LEGACY-EDIT', doctorId, 90, metadata));
        const legacy = one("SELECT * FROM patients WHERE medical_record_number = 'QA-LEGACY-EDIT'");
        for (const field of Object.keys(metadata)) assert.equal(legacy[field], null);
        query('UPDATE patients SET planned_room = ?, consciousness_status = ? WHERE id = ?', ['Ruangan Lama', 'Compos mentis', legacy.id]);
        await transit.page.goto(`${base}index.php?page=patient_form&id=${legacy.id}`);
        assert.equal(await transit.page.locator('[name=planned_room]').inputValue(), 'Ruangan Lama');
        assert.equal(await transit.page.locator('[name=consciousness_status]').inputValue(), 'Compos mentis');
        await fill(transit, { payer_type: 'BPJS PBI APBD', care_class: 'Kelas III', education: 'D3' });
        await submit(transit, '[data-patient-save-bottom]', 'page=patients');
        const saved = one('SELECT * FROM patients WHERE id = ?', [legacy.id]);
        assert.equal(saved.planned_room, 'Ruangan Lama');
        assert.equal(saved.consciousness_status, 'Compos mentis');
        assert.equal(saved.payer_type, 'BPJS PBI APBD');
        assert.equal(saved.care_class, 'Kelas III');
        await transit.page.goto(`${base}index.php?page=patient_form&id=${legacy.id}`);
        await fill(transit, { planned_room: 'Said bin Zaid', consciousness_status: 'Apatis' });
        await submit(transit, '[data-patient-save-bottom]', 'page=patients');
        assert.equal(one('SELECT planned_room FROM patients WHERE id = ?', [legacy.id]).planned_room, 'Said bin Zaid');
        await post(transit, 'patients', { action: 'delete_patient', id: legacy.id });
    });
    await check('Patient list search and status filter combine', async () => {
        await transit.page.goto(`${base}index.php?page=patients&q=QA-002&status=ACTIVE`);
        assert.equal(await transit.page.locator('tbody tr').count(), 1);
        assert.match(await transit.page.locator('tbody').innerText(), /QA-002/);
        await transit.page.goto(`${base}index.php?page=patients&q=%27%20OR%201%3D1%20--`);
        assert.equal(await transit.page.locator('tbody tr').count(), 0);
    });
    await check('Editing patient retains inactive historical doctor', async () => {
        await post(admin, 'doctors', { action: 'save_doctor', id: doctorId, name: 'Dr. QA Edited', specialization_id: specId });
        const response = await post(transit, `patient_form&id=${p1.id}`, { ...first, id: p1.id, full_name: 'Retained Doctor QA' });
        assert.equal(one('SELECT full_name FROM patients WHERE id = ?', [p1.id]).full_name, 'Retained Doctor QA');
        assert.match(response.url(), /page=patients/);
    });
    await post(admin, 'doctors', { action: 'save_doctor', id: doctorId, name: 'Dr. QA Edited', specialization_id: specId, is_active: 1 });

    await check('Bed API reflects database and IGD remains read-only', async () => {
        const payload = await (await igd.context.request.get('api.php?action=beds')).json();
        assert.equal(payload.ok, true);
        assert.equal(payload.canManage, false);
        assert.equal(payload.summary.occupied, count('beds', "status = 'TERISI'"));
        assert.ok(payload.beds.some(bed => bed.patient_id === p1.id));
    });
    await check('Set Siap button label is consistent before and after bed polling for managing roles', async () => {
        const selector = 'form:has([name=action][value=mark_ready]) button[type=submit]';
        for (const c of [admin, transit]) {
            const page = await c.context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.clock.install();
                await page.goto(`${base}index.php?page=transit`);
                assert.deepEqual((await page.locator(selector).allTextContents()).map(text => text.trim()), ['Set Siap', 'Set Siap']);
                assert.equal(await page.locator('[data-bed-group=area_1] [data-group-summary=occupied]').innerText(), '2');
                assert.deepEqual(await page.locator('[data-bed-group=other] .bed-card header > strong').allTextContents(), ['QA BED']);
                await page.locator('[data-bed-group=isolation] summary').click();
                await page.locator('[data-bed-group=isolation] summary').focus();
                await page.locator(selector).evaluateAll(buttons => buttons.forEach(button => button.dataset.beforePoll = '1'));
                const updated = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api.php'));
                await page.clock.runFor(15100);
                await updated;
                await page.waitForFunction(() => document.querySelectorAll('[data-before-poll]').length === 0);
                assert.deepEqual((await page.locator(selector).allTextContents()).map(text => text.trim()), ['Set Siap', 'Set Siap']);
                assert.equal(await page.locator('[data-bed-group=isolation]').evaluate(group => group.open), false);
                assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.dataset.bedGroup), 'isolation');
                assert.deepEqual(await page.locator('[data-bed-group=other] .bed-card header > strong').allTextContents(), ['QA BED']);
            } finally {
                await page.close();
            }
        }
    });
    await check('FIFO sorts arrival ascending and combines transfer filters', async () => {
        await transit.page.goto(`${base}index.php?page=transfer`);
        const records = await transit.page.locator('tbody tr td:nth-child(4)').allTextContents();
        assert.ok(records.indexOf('QA-001') < records.indexOf('QA-002'));
        await transit.page.goto(`${base}index.php?page=transfer&name=QA-002&mr=QA-002&doctor_id=${doctorId}&status=ACTIVE&diagnosis=Kedua`);
        assert.equal(await transit.page.locator('tbody tr').count(), 1);
    });
    await check('Transfer edit saves only registered DPJP and allowed room, preserves FIFO, and protects history', async () => {
        query("INSERT INTO doctors (name,specialization_id,is_active) VALUES ('Dr. QA Transfer Edit',?,1)", [specId]);
        const fixtureDoctor = one("SELECT id FROM doctors WHERE name = 'Dr. QA Transfer Edit'").id;
        const otherDoctor = one('SELECT d.id FROM doctors d JOIN specializations s ON s.id = d.specialization_id WHERE d.id <> ? AND d.is_active = 1 AND d.deleted_at IS NULL AND s.is_active = 1 ORDER BY d.id LIMIT 1', [fixtureDoctor]).id;
        let fixture;
        const read = () => one('SELECT * FROM patients WHERE id = ?', [fixture.id]);
        try {
            await post(transit, 'patient_form', patient('QA-TRANSFER-EDIT', fixtureDoctor, 135));
            fixture = one("SELECT * FROM patients WHERE medical_record_number = 'QA-TRANSFER-EDIT'");
            assert.ok(fixture);
            const previous = { ...fixture };
            const bed = one('SELECT * FROM beds WHERE id = ?', [fixture.bed_id]);
            const vitals = query('SELECT * FROM vital_signs WHERE patient_id = ? ORDER BY id', [fixture.id]);
            await transit.page.goto(`${base}index.php?page=transfer&mr=QA-TRANSFER-EDIT`);
            await Promise.all([
                transit.page.waitForURL(url => url.searchParams.get('edit') === String(fixture.id)),
                transit.page.locator('tbody tr .table-actions a').click(),
            ]);
            assert.equal(new URL(transit.page.url()).searchParams.get('mr'), 'QA-TRANSFER-EDIT');
            const form = transit.page.locator('[data-transfer-edit-form]');
            assert.deepEqual(await form.locator('input:not([type=hidden]), select, textarea').evaluateAll(fields => fields.map(field => field.name)), ['doctor_id', 'planned_room']);
            assert.equal(await form.locator('[name=doctor_id]').inputValue(), String(fixtureDoctor));
            assert.equal(await form.locator('[name=planned_room]').inputValue(), 'Hasan bin Ali');
            assert.deepEqual(await form.locator('[name=planned_room] option:not([value=""])').allTextContents(), ['Hasan', 'Husen', 'Said', 'IGD']);
            const registered = query('SELECT d.id FROM doctors d JOIN specializations s ON s.id = d.specialization_id WHERE d.is_active = 1 AND d.deleted_at IS NULL AND s.is_active = 1 ORDER BY d.name').map(doctor => String(doctor.id));
            assert.deepEqual(await form.locator('[name=doctor_id] option:not([value=""])').evaluateAll(options => options.map(option => option.value)), registered);
            for (const theme of ['light', 'dark']) {
                for (const width of [1440, 390, 320]) {
                    await transit.page.setViewportSize({ width, height: 900 });
                    await transit.page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
                    assert.ok(await transit.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                    assert.equal(await form.locator('select, button, .inline-actions a').evaluateAll(fields => fields.filter(field => {
                        const rect = field.getBoundingClientRect();
                        return rect.left < 0 || rect.right > innerWidth + 1;
                    }).length), 0);
                    await transit.page.screenshot({ path: path.join(temporary, `transfer-edit-${theme}-${width}.png`), fullPage: true });
                }
            }
            await transit.page.setViewportSize({ width: 1440, height: 900 });
            await form.locator('[name=doctor_id]').selectOption(String(otherDoctor));
            await form.locator('[name=planned_room]').selectOption('IGD');
            await submit(transit, '[data-transfer-edit-form] button[type=submit]');
            assert.equal(new URL(transit.page.url()).searchParams.get('page'), 'transfer');
            assert.equal(new URL(transit.page.url()).searchParams.has('edit'), false);
            assert.equal(read().doctor_id, otherDoctor);
            assert.equal(read().planned_room, 'IGD');
            const unchanged = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['doctor_id', 'planned_room', 'updated_by', 'updated_at'].includes(key)));
            assert.deepEqual(unchanged(read()), unchanged(previous));
            assert.deepEqual(one('SELECT * FROM beds WHERE id = ?', [fixture.bed_id]), bed);
            assert.deepEqual(query('SELECT * FROM vital_signs WHERE patient_id = ? ORDER BY id', [fixture.id]), vitals);
            assert.equal(await transit.page.locator('tbody tr').filter({ hasText: 'QA-TRANSFER-EDIT' }).locator('td:nth-child(7)').innerText(), 'IGD');
            assert.equal(count('audit_logs', "action = 'Edit rencana transfer' AND description LIKE ?", ['%QA-TRANSFER-EDIT%']), 1);

            const save = (changes, c = transit) => post(c, `transfer&edit=${fixture.id}`, {
                action: 'save_transfer_plan', id: fixture.id, doctor_id: otherDoctor, planned_room: 'IGD', ...changes,
            });
            const afterEdit = read();
            const csrf = await save({ _csrf: 'invalid' });
            assert.match(await csrf.text(), /Sesi formulir tidak valid/);
            assert.deepEqual(read(), afterEdit);
            assert.equal((await post(igd, 'monitor', { action: 'save_transfer_plan', id: fixture.id, doctor_id: otherDoctor, planned_room: 'IGD' })).status(), 403);
            assert.deepEqual(read(), afterEdit);
            query('UPDATE doctors SET is_active = 0 WHERE id = ?', [fixtureDoctor]);
            for (const changes of [{ doctor_id: 0 }, { doctor_id: 999999 }, { doctor_id: fixtureDoctor }, { planned_room: '' }, { planned_room: 'Ruangan tidak terdaftar' }]) {
                const response = await save(changes);
                assert.match(await response.text(), /Dokter DPJP wajib dipilih|Rencana ruangan wajib dipilih/);
                assert.deepEqual(read(), afterEdit);
            }
            query('UPDATE doctors SET is_active = 1, deleted_at = NOW() WHERE id = ?', [fixtureDoctor]);
            assert.match(await (await save({ doctor_id: fixtureDoctor })).text(), /Dokter DPJP wajib dipilih/);
            assert.deepEqual(read(), afterEdit);
            query('UPDATE doctors SET deleted_at = NULL, is_active = 0 WHERE id = ?', [fixtureDoctor]);

            await save({ planned_room: 'Husain bin Ali', full_name: 'Nama palsu', diagnosis: 'Diagnosis palsu', status: 'TRANSFERRED', bed_id: '', arrival_time: '2000-01-01T00:00' }, admin);
            assert.equal(read().planned_room, 'Husain bin Ali');
            assert.deepEqual(unchanged(read()), unchanged(previous));
            await save({ planned_room: 'Said bin Zaid' });
            assert.equal(read().planned_room, 'Said bin Zaid');
            await save({ planned_room: 'Hasan bin Ali' });
            assert.equal(read().planned_room, 'Hasan bin Ali');

            query('UPDATE patients SET doctor_id = ? WHERE id = ?', [fixtureDoctor, fixture.id]);
            await transit.page.goto(`${base}index.php?page=transfer&edit=${fixture.id}`);
            assert.match(await form.locator(`[name=doctor_id] option[value="${fixtureDoctor}"]`).innerText(), /DPJP sebelumnya, nonaktif/);
            await save({ doctor_id: fixtureDoctor, planned_room: 'IGD' });
            assert.equal(read().doctor_id, fixtureDoctor);
            assert.equal(read().planned_room, 'IGD');
            await save({ doctor_id: otherDoctor });

            await post(transit, 'transit', { action: 'mark_ready', id: fixture.id });
            const readyBed = one('SELECT * FROM beds WHERE id = ?', [fixture.bed_id]);
            await save({ planned_room: 'Said bin Zaid' });
            assert.equal(read().status, 'READY_TRANSFER');
            assert.deepEqual(one('SELECT * FROM beds WHERE id = ?', [fixture.bed_id]), readyBed);
            await post(transit, 'transfer', { action: 'transfer_selected', 'selected_patients[0]': fixture.id });
            assert.equal(one('SELECT destination_room FROM transfers WHERE patient_id = ?', [fixture.id]).destination_room, 'Said bin Zaid');
            const history = read();
            assert.match(await (await save({ planned_room: 'IGD' })).text(), /Rencana transfer hanya dapat diubah/);
            assert.deepEqual(read(), history);
            await transit.page.goto(`${base}index.php?page=transfer&edit=${fixture.id}`);
            assert.equal(await form.count(), 0);
            query("UPDATE patients SET status = 'CANCELLED', deleted_at = NOW() WHERE id = ?", [fixture.id]);
            const deleted = read();
            assert.match(await (await save({ planned_room: 'IGD' })).text(), /Pasien tidak ditemukan/);
            assert.deepEqual(read(), deleted);
        } finally {
            await transit.page.setViewportSize({ width: 1440, height: 900 });
            if (fixture) {
                query('UPDATE beds SET status = ?, patient_id = NULL WHERE id = ?', ['KOSONG', fixture.bed_id]);
                query('DELETE FROM transfers WHERE patient_id = ?', [fixture.id]);
                query('DELETE FROM vital_signs WHERE patient_id = ?', [fixture.id]);
                query('DELETE FROM patients WHERE id = ?', [fixture.id]);
            }
            query('DELETE FROM doctors WHERE id = ?', [fixtureDoctor]);
        }
    });
    await check('Active patient cannot transfer', async () => {
        await post(transit, 'transfer', { action: 'transfer_selected', 'selected_patients[0]': p1.id });
        assert.equal(one('SELECT status FROM patients WHERE id = ?', [p1.id]).status, 'ACTIVE');
        assert.equal(count('transfers'), 0);
    });
    await check('No selected patients gives warning', async () => {
        const response = await post(transit, 'transfer', { action: 'transfer_selected' });
        assert.match(await response.text(), /Pilih minimal satu pasien/);
    });
    await check('Ready action updates patient and bed, including IGD automatic polling', async () => {
        await igd.page.clock.install();
        await igd.page.goto(`${base}index.php?page=monitor`);
        await transit.page.goto(`${base}index.php?page=transit`);
        await submit(transit, `form:has([name=action][value=mark_ready]):has([name=id][value="${p1.id}"]) button[type=submit]`, 'page=transit');
        assert.equal(one('SELECT status FROM patients WHERE id = ?', [p1.id]).status, 'READY_TRANSFER');
        assert.equal(one('SELECT status FROM beds WHERE id = ?', [p1.bed_id]).status, 'SIAP_TRANSFER');
        const updated = igd.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api.php'));
        await igd.page.clock.runFor(15100);
        await updated;
        await igd.page.waitForFunction(() => document.querySelectorAll('.bed-siap_transfer').length > 0);
        assert.equal(await igd.page.locator('[data-bed-group=area_1] [data-group-summary=ready]').innerText(), '1');
        assert.equal(await igd.page.locator('[data-bed-group=area_1] [data-group-summary=occupied]').innerText(), '1');
        assert.equal(await igd.page.locator('.bed-actions button').count(), 0);
    });
    await check('Dashboard clock ticks and summary refreshes without reload', async () => {
        await admin.page.clock.install();
        await admin.page.goto(`${base}index.php?page=dashboard`);
        const clock = await admin.page.locator('[data-clock]').innerText();
        await admin.page.clock.runFor(1100);
        assert.notEqual(await admin.page.locator('[data-clock]').innerText(), clock);
        await admin.page.locator('[data-summary=ready]').evaluateAll(items => items.forEach(item => item.textContent = '999'));
        const updated = admin.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api.php'));
        await admin.page.clock.runFor(15100);
        await updated;
        await admin.page.waitForFunction(() => document.querySelector('[data-summary=ready]').textContent !== '999');
        assert.equal(await admin.page.locator('[data-summary=ready]').first().innerText(), '1');
        assert.match(await admin.page.locator('[data-summary=average_stay]').innerText(), /Jam.*Menit/);
        assert.match(await admin.page.locator('[data-summary=active]').innerText(), /bed aktif/);
    });
    await check('Mixed valid and invalid bulk transfer rolls back everything', async () => {
        await post(transit, 'transfer', { action: 'transfer_selected', 'selected_patients[0]': p1.id, 'selected_patients[1]': p2.id });
        assert.equal(one('SELECT status FROM patients WHERE id = ?', [p1.id]).status, 'READY_TRANSFER');
        assert.equal(count('transfers'), 0);
        assert.equal(one('SELECT status FROM beds WHERE id = ?', [p1.bed_id]).status, 'SIAP_TRANSFER');
    });
    await post(transit, 'transit', { action: 'mark_ready', id: p2.id });
    await check('Bulk transfer select-all, cancel confirmation, then confirmed transfer', async () => {
        await transit.page.goto(`${base}index.php?page=transfer`);
        await transit.page.locator('[data-check-all]').check();
        assert.equal(await transit.page.locator('[data-transfer-checkbox]:checked').count(), 2);
        await confirmedSubmit(transit, '[data-transfer-form] button[type=submit]:not([disabled])', false);
        assert.equal(count('transfers'), 0);
        await confirmedSubmit(transit, '[data-transfer-form] button[type=submit]:not([disabled])', true);
        assert.equal(count('transfers'), 2);
        for (const p of [p1, p2]) {
            assert.equal(one('SELECT status FROM patients WHERE id = ?', [p.id]).status, 'TRANSFERRED');
            const bed = one('SELECT status,patient_id FROM beds WHERE id = ?', [p.bed_id]);
            assert.equal(bed.status, 'KOSONG');
            assert.equal(bed.patient_id, null);
            assert.ok(Number(one('SELECT stay_minutes FROM transfers WHERE patient_id = ?', [p.id]).stay_minutes) >= 60);
        }
    });
    await check('Transferred history cannot be deleted by forged POST', async () => {
        await post(transit, 'patients', { action: 'delete_patient', id: p2.id });
        assert.equal(one('SELECT status,deleted_at FROM patients WHERE id = ?', [p2.id]).status, 'TRANSFERRED');
        assert.equal(one('SELECT deleted_at FROM patients WHERE id = ?', [p2.id]).deleted_at, null);
    });
    await check('Transferred history cannot be edited by forged POST', async () => {
        const previous = one('SELECT full_name FROM patients WHERE id = ?', [p1.id]).full_name;
        await post(transit, `patient_form&id=${p1.id}`, { ...first, id: p1.id, full_name: 'Tampered History', arrival_time: arrival(10) });
        assert.equal(one('SELECT full_name FROM patients WHERE id = ?', [p1.id]).full_name, previous);
    });
    await check('Reports daily, monthly, annual and combined filters', async () => {
        const records = query('SELECT arrival_time FROM patients WHERE id IN (?, ?)', [p1.id, p2.id]);
        const reportDay = records[0].arrival_time.slice(0, 10);
        for (const [field, length] of [['day', 10], ['month', 7], ['year', 4]]) {
            const period = reportDay.slice(0, length);
            const filters = `${field}=${period}`;
            const expected = records.filter(record => record.arrival_time.startsWith(period)).length;
            await transit.page.goto(`${base}index.php?page=reports&${filters}&status=TRANSFERRED&room=Hasan`);
            assert.equal(await transit.page.locator('tbody tr').count(), expected);
            assert.equal(await transit.page.locator('.stat-card strong').nth(0).innerText(), String(expected));
            assert.equal(await transit.page.locator('.stat-card strong').nth(1).innerText(), String(expected));
            assert.equal(await transit.page.locator('.year-chart > div').count(), 12);
        }
    });
    await check('Export Excel preserves filters and all 25 patient columns', async () => {
        const reportMonth = one('SELECT arrival_time FROM patients WHERE id = ?', [p2.id]).arrival_time.slice(0, 7);
        await transit.page.goto(`${base}index.php?page=reports&month=${reportMonth}&doctor_id=${doctorId}&diagnosis=Kedua&status=TRANSFERRED`);
        const waiting = transit.page.waitForEvent('download');
        await transit.page.locator('a[href*="page=export"]').click();
        const download = await waiting;
        assert.equal(download.suggestedFilename(), `rekap_e_transit_${reportMonth.replace('-', '_')}.xlsx`);
        const filename = path.join(temporary, 'filtered.xlsx');
        await download.saveAs(filename);
        const rows = cli('xlsx', { path: filename });
        assert.equal(rows.length, 2);
        assert.equal(rows[0].length, 25);
        assert.equal(rows[1][1], 'QA-002');
        assert.deepEqual(rows[1].slice(15), [second.identity_number, second.religion, second.payer_type, second.care_class, second.guardian_name, second.guardian_relationship, second.guardian_phone, second.education, second.planned_room, second.consciousness_status]);
    });

    await check('Iso A and Iso B support detail, readiness, transfer and bed release with correct group counts', async () => {
        for (const [index, code] of ['Iso A', 'Iso B'].entries()) {
            const data = patient(`QA-ISO-${index}`, doctorId);
            await post(transit, 'patient_form', data);
            const saved = one('SELECT * FROM patients WHERE medical_record_number = ?', [data.medical_record_number]);
            const isolation = one('SELECT * FROM beds WHERE bed_code = ?', [code]);
            query("UPDATE beds SET patient_id = NULL, status = 'KOSONG' WHERE id = ?", [saved.bed_id]);
            query('UPDATE patients SET bed_id = ? WHERE id = ?', [isolation.id, saved.id]);
            query("UPDATE beds SET patient_id = ?, status = 'TERISI' WHERE id = ?", [saved.id, isolation.id]);
            await transit.page.goto(`${base}index.php?page=transit`);
            assert.equal(await transit.page.locator('[data-bed-group=isolation] [data-group-summary=occupied]').innerText(), '1');
            assert.ok((await transit.page.locator('[data-bed-group=isolation]').innerText()).includes(data.medical_record_number));
            await transit.page.goto(`${base}index.php?page=patient_detail&id=${saved.id}`);
            assert.ok((await transit.page.locator('.detail-panel').innerText()).includes(code));
            await transit.page.goto(`${base}index.php?page=transit`);
            await submit(transit, `form:has([name=action][value=mark_ready]):has([name=id][value="${saved.id}"]) button`);
            assert.equal(await transit.page.locator('[data-bed-group=isolation] [data-group-summary=ready]').innerText(), '1');
            await confirmedSubmit(transit, `form:has([name=action][value=transfer_selected]):has([name="selected_patients[]"][value="${saved.id}"]) button`, true, 'page=transfer');
            assert.equal(one('SELECT status FROM patients WHERE id = ?', [saved.id]).status, 'TRANSFERRED');
            assert.equal(one('SELECT bed_id FROM transfers WHERE patient_id = ?', [saved.id]).bed_id, isolation.id);
            assert.equal(one('SELECT status FROM beds WHERE id = ?', [isolation.id]).status, 'KOSONG');
            assert.equal(one('SELECT patient_id FROM beds WHERE id = ?', [isolation.id]).patient_id, null);
            await transit.page.goto(`${base}index.php?page=transit`);
            assert.equal(await transit.page.locator('[data-bed-group=isolation] [data-group-summary=empty]').innerText(), '2');
        }
    });
    await post(transit, 'patient_form', patient('QA-DELETE', doctorId));
    const deleted = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-DELETE']);
    await check('Patient soft delete via confirmation frees bed and retains vitals', async () => {
        await transit.page.goto(`${base}index.php?page=patient_detail&id=${deleted.id}`);
        await confirmedSubmit(transit, '.danger-zone button', true, 'page=patients');
        assert.ok(one('SELECT deleted_at FROM patients WHERE id = ?', [deleted.id]).deleted_at);
        assert.equal(count('vital_signs', 'patient_id = ?', [deleted.id]), 1);
        assert.equal(one('SELECT status FROM beds WHERE id = ?', [deleted.bed_id]).status, 'KOSONG');
        assert.equal((await transit.context.request.get(`index.php?page=patient_detail&id=${deleted.id}`)).status(), 404);
    });
    await check('Soft-deleted unique RM rejected with readable error, not SQL leakage', async () => {
        const response = await post(transit, 'patient_form', patient('QA-DELETE', doctorId));
        const html = await response.text();
        assert.doesNotMatch(html, /SQLSTATE|PDOException|Duplicate entry/);
        assert.match(html, /No\. RM.*(digunakan|terdaftar)/);
    });
    await check('XSS patient text remains escaped after polling and in detail', async () => {
        const text = '<img src=x onerror=window.qaXss=1>';
        await post(transit, 'patient_form', patient('QA-XSS', doctorId, 90, { full_name: text, diagnosis: '=1+1' }));
        const p = one('SELECT id FROM patients WHERE medical_record_number = ?', ['QA-XSS']);
        await transit.page.goto(`${base}index.php?page=patient_detail&id=${p.id}`);
        assert.equal(await transit.page.locator('.detail-panel h2 img').count(), 0);
        assert.match(await transit.page.locator('.detail-panel h2').innerText(), /onerror/);
        assert.equal(await transit.page.evaluate(() => window.qaXss), undefined);
        const response = await transit.context.request.get('index.php?page=export&diagnosis=%3D1%2B1');
        const filename = path.join(temporary, 'formula-safe.xlsx');
        fs.writeFileSync(filename, await response.body());
        assert.equal(cli('xlsx', { path: filename })[1][9], '=1+1');
    });

    await check('No available bed prevents patient insert without orphan vitals', async () => {
        const free = query("SELECT id FROM beds WHERE status = 'KOSONG'");
        query("UPDATE beds SET status = 'NONAKTIF' WHERE status = 'KOSONG'");
        const n = count('patients');
        const v = count('vital_signs');
        const response = await post(transit, 'patient_form', patient('QA-NOBED', doctorId));
        assert.match(await response.text(), /Tidak ada bed kosong/);
        assert.equal(count('patients'), n);
        assert.equal(count('vital_signs'), v);
        for (const bed of free) query("UPDATE beds SET status = 'KOSONG' WHERE id = ?", [bed.id]);
    });
    await check('Concurrent admissions across two servers use distinct beds', async () => {
        const other = await client(secondBase);
        await login(other, 'transit', 'Transit@123', 'dashboard');
        await Promise.all([
            post(transit, 'patient_form', patient('QA-CONCURRENT-A', doctorId)),
            post(other, 'patient_form', patient('QA-CONCURRENT-B', doctorId)),
        ]);
        const records = query("SELECT bed_id FROM patients WHERE medical_record_number IN ('QA-CONCURRENT-A','QA-CONCURRENT-B')");
        assert.equal(records.length, 2);
        assert.notEqual(records[0].bed_id, records[1].bed_id);
        await other.context.close();
    });
    await check('Concurrent repeated transfer creates only one history row', async () => {
        const p = one('SELECT * FROM patients WHERE medical_record_number = ?', ['QA-CONCURRENT-A']);
        await post(transit, 'transit', { action: 'mark_ready', id: p.id });
        const other = await client(secondBase);
        await login(other, 'transit', 'Transit@123', 'dashboard');
        await Promise.all([
            post(transit, 'transfer', { action: 'transfer_selected', 'selected_patients[0]': p.id }),
            post(other, 'transfer', { action: 'transfer_selected', 'selected_patients[0]': p.id }),
        ]);
        assert.equal(count('transfers', 'patient_id = ?', [p.id]), 1);
        await other.context.close();
    });

    const role = one("SELECT id FROM roles WHERE code = 'perawat_igd'").id;
    await check('Admin creates user, duplicate rejected, role stored', async () => {
        await admin.page.goto(`${base}index.php?page=users`);
        await fill(admin, { full_name: 'User QA', username: 'qa_adminuser', email: 'qa_adminuser@example.test', identity_number: 'QA-002', role_id: role, password: 'Testing@123' });
        await submit(admin, 'form:has([name=action][value=save_user]) button');
        assert.equal(one('SELECT role_id FROM users WHERE username = ?', ['qa_adminuser']).role_id, role);
        const response = await post(admin, 'users', { action: 'save_user', full_name: 'User QA', username: 'qa_adminuser', email: 'qa_adminuser@example.test', role_id: role, password: 'Testing@123' });
        assert.match(await response.text(), /sudah digunakan/);
        assert.equal(count('users', 'username = ?', ['qa_adminuser']), 1);
    });
    await check('Deactivated user cannot login or reuse authenticated session', async () => {
        const user = one('SELECT id FROM users WHERE username = ?', ['qa_adminuser']);
        const c = await client(base);
        await login(c, 'qa_adminuser', 'Testing@123', 'monitor');
        await post(admin, 'users', { action: 'toggle_user', id: user.id });
        const privatePage = await c.context.request.get('index.php?page=monitor');
        assert.match(privatePage.url(), /page=login/);
        const response = await post(c, 'login', { identity: 'qa_adminuser', password: 'Testing@123' });
        assert.match(await response.text(), /Username atau password tidak valid/);
        await post(admin, 'users', { action: 'toggle_user', id: user.id });
        await login(c, 'qa_adminuser', 'Testing@123', 'monitor');
        await c.context.close();
    });
    await check('Admin cannot deactivate own account', async () => {
        const id = one("SELECT id FROM users WHERE username = 'admin'").id;
        await post(admin, 'users', { action: 'toggle_user', id });
        assert.equal(one('SELECT is_active FROM users WHERE id = ?', [id]).is_active, 1);
    });
    await check('Profile password validates current password and confirmation', async () => {
        for (const data of [{ current_password: 'Wrong@123', password: 'Newpass@123', password_confirm: 'Newpass@123' }, { current_password: 'Testing@123', password: 'weak', password_confirm: 'weak' }, { current_password: 'Testing@123', password: 'Newpass@123', password_confirm: 'Different@123' }]) {
            const response = await post(anonymous, 'profile', { action: 'change_password', ...data });
            assert.match(await response.text(), /tidak valid|belum memenuhi/);
        }
    });
    await check('Profile password change persists and new password can login', async () => {
        await anonymous.page.goto(`${base}index.php?page=profile`);
        await fill(anonymous, { current_password: 'Testing@123', password: 'Newpass@123', password_confirm: 'Newpass@123' });
        await submit(anonymous, 'form:has([name=action][value=change_password]) button');
        const response = await post(anonymous, 'logout', {});
        assert.match(response.url(), /page=login/);
        const old = await post(anonymous, 'login', { identity: 'qa_register', password: 'Testing@123' });
        assert.match(await old.text(), /Username atau password tidak valid/);
        await login(anonymous, 'qa_register', 'Newpass@123', 'dashboard');
    });
    await check('Session timeout logs out inactive session', async () => {
        const cookie = (await anonymous.context.cookies()).find(c => c.name === 'ETRANSITSESSID');
        cli('expire-session', { id: cookie.value });
        const response = await anonymous.context.request.get('index.php?page=profile');
        assert.match(response.url(), /page=login/);
        assert.match(await response.text(), /Sesi Anda berakhir/);
    });
    await check('Doctor soft deletion retains patient history', async () => {
        await admin.page.goto(`${base}index.php?page=doctors`);
        const row = admin.page.locator('tbody tr').filter({ hasText: 'Dr. QA Edited' });
        await confirmedSubmit(admin, `tbody tr:has(input[name=id][value="${doctorId}"]) .btn-danger`, true);
        assert.ok(one('SELECT deleted_at FROM doctors WHERE id = ?', [doctorId]).deleted_at);
        assert.ok(count('patients', 'doctor_id = ?', [doctorId]) > 0);
        await transit.page.goto(`${base}index.php?page=patient_detail&id=${p1.id}`);
        assert.equal(await transit.page.locator('.detail-panel').count(), 1);
    });
    await check('Audit log covers important actions', async () => {
        const actions = new Set(query('SELECT DISTINCT action FROM audit_logs').map(row => row.action));
        for (const action of ['Login', 'Logout', 'Register', 'Tambah pasien', 'Edit pasien', 'Edit waktu kedatangan', 'Hapus pasien', 'Tambah dokter', 'Edit dokter', 'Hapus dokter', 'Transfer pasien', 'Perubahan status bed', 'Tambah bed', 'Tambah user', 'Edit user', 'Edit profil', 'Export Excel']) assert.ok(actions.has(action), action);
        await admin.page.goto(`${base}index.php?page=audit`);
        assert.ok(await admin.page.locator('tbody tr').count() > 0);
    });
    await check('Mobile forms and tables remain usable on every role', async () => {
        for (const [c, menus] of [[admin, ['dashboard', 'transit', 'patient_form', 'patients', 'transfer', 'doctors', 'reports', 'beds', 'users', 'audit', 'profile']], [igd, ['dashboard', 'monitor', 'profile']], [transit, ['dashboard', 'transit', 'patient_form', 'patients', 'transfer', 'doctors', 'reports', 'profile']]]) {
            await c.page.setViewportSize({ width: 390, height: 844 });
            for (const menu of menus) {
                await c.page.goto(`${base}index.php?page=${menu}`);
                assert.ok(await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), menu);
                assert.equal(await c.page.locator('table:not(.responsive-table table)').count(), 0);
            }
            await c.page.locator('[data-menu-toggle]').click();
            assert.equal(await c.page.locator('[data-menu-toggle]').getAttribute('aria-expanded'), 'true');
            await c.page.keyboard.press('Escape');
            assert.equal(await c.page.locator('[data-menu-toggle]').getAttribute('aria-expanded'), 'false');
        }
    });
    await check('Logout removes access for all roles', async () => {
        for (const c of [admin, igd, transit]) {
            const response = await post(c, 'logout', {});
            assert.match(response.url(), /page=login/);
            assert.match((await c.context.request.get('index.php?page=dashboard')).url(), /page=login/);
        }
    });
    await check('No browser JavaScript errors', async () => assert.deepEqual(errors, []));
}

(async () => {
    try {
        await main();
    } catch (error) {
        results.push({ name: 'Runner', ok: false, error: error.stack });
        console.error(error.stack);
    } finally {
        if (browser) await browser.close();
        for (const child of servers) {
            const stopped = new Promise(resolve => child.once('exit', resolve));
            child.kill();
            await stopped;
        }
        if (created) cli('drop');
        if (before) await check('Application core data unchanged by tests', async () => {
            assert.deepEqual(cli('fingerprint', null, process.env), before);
        });
        fs.writeFileSync(path.join(temporary, 'results.json'), JSON.stringify(results, null, 2));
        const failed = results.filter(item => !item.ok);
        console.log(`\n${results.length - failed.length}/${results.length} test groups passed. Results: ${temporary}`);
        process.exitCode = failed.length ? 1 : 0;
    }
})();
