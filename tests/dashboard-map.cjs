const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(__dirname, '..');
const php = process.env.PHP_BINARY || 'C:\\xampp\\php\\php.exe';
const env = { ...process.env, DB_DATABASE: `e_transit_qa_${Date.now()}_${process.pid}` };
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-dashboard-map-'));
const cli = (command, input = null, environment = env) => JSON.parse(execFileSync(php, [path.join(__dirname, 'support.php'), command], {
    cwd: root, env: environment, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true,
}));
const query = (sql, params = []) => cli('query', { sql, params });
const errors = [], results = [];
let browser, server, created = false;
const before = cli('fingerprint', null, process.env);
const poll = page => page.evaluate(async () => { await window.__qaBedPoll(); });

(async () => {
    try {
        execFileSync(php, [path.join(__dirname, 'support.php'), 'create'], { cwd: root, env, windowsHide: true });
        created = true;
        for (const [code, status] of [['1A', 'ACTIVE'], ['1B', 'READY_TRANSFER']]) {
            const bed = query('SELECT id FROM beds WHERE bed_code=?', [code])[0].id;
            query("INSERT INTO patients (medical_record_number,full_name,gender,birth_date,address,marital_status,dependency_level,doctor_id,diagnosis,consciousness_status,planned_room,arrival_time,bed_id,status) VALUES (?,'Contoh Denah','L','1990-01-01','Alamat Contoh','Menikah','Minimal Care',1,'Observasi','Compos Mentis','Hasan bin Ali',NOW(),?,?)", [`MAP-${code}`, bed, status]);
            const patient = query('SELECT id FROM patients WHERE medical_record_number=?', [`MAP-${code}`])[0].id;
            query('UPDATE beds SET patient_id=?,status=? WHERE id=?', [patient, status === 'ACTIVE' ? 'TERISI' : 'SIAP_TRANSFER', bed]);
        }
        query("UPDATE beds SET status='NONAKTIF' WHERE bed_code='1D'");
        const port = await new Promise(resolve => {
            const socket = net.createServer().listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
        });
        server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        server.stderr.pipe(fs.createWriteStream(path.join(output, 'server.log')));
        const baseURL = `http://127.0.0.1:${port}/`;
        for (let i = 0; i < 60; i++) {
            try { if ((await fetch(baseURL)).ok) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        for (const [role, password] of [['admin', 'Admin@123'], ['igd', 'Igd@1234'], ['transit', 'Transit@123']]) {
            const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', colorScheme: 'light' });
            await context.addInitScript(() => {
                const native = window.setInterval;
                window.setInterval = (handler, delay, ...args) => {
                    if (delay === 15000) window.__qaBedPoll = handler;
                    return native(handler, delay, ...args);
                };
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('index.php?page=login');
            await page.locator('[name=identity]').fill(role);
            await page.locator('[name=password]').fill(password);
            await Promise.all([page.waitForURL(url => url.searchParams.get('page') !== 'login'), page.locator('.auth-submit').click()]);
            await page.goto('index.php?page=dashboard');
            for (const theme of ['light', 'dark']) {
                if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click();
                for (const width of [1440, 1280, 1024, 821, 390, 320]) {
                    await page.setViewportSize({ width, height: 960 });
                    assert.equal(await page.locator('[data-transit-bed]').count(), 19);
                    assert.deepEqual(await page.locator('.transit-room-heading h3').allTextContents(), ['1A-1F', '2A-2F', '4A-4C', '5A-5B', 'Isolasi']);
                    const api = await (await context.request.get('api.php?action=beds')).json();
                    for (const bed of api.beds) {
                        const seat = page.locator(`[data-transit-bed="${bed.id}"]`);
                        assert.equal(await seat.getAttribute('data-status'), bed.status);
                        assert.equal(await seat.getAttribute('aria-label'), `Bed ${bed.bed_code}, ${bed.status_label}`);
                        assert.equal(await seat.locator('.transit-seat-code').innerText(), bed.bed_code);
                    }
                    const visual = await page.locator('.transit-map').evaluate(map => {
                        const rgb = value => value.match(/[\d.]+/g).map(Number).slice(0, 3);
                        const luminance = value => value.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
                        return {
                            overflow: document.body.scrollWidth > innerWidth + 1 || map.scrollWidth > map.clientWidth,
                            seats: Array.from(map.querySelectorAll('[data-transit-bed]'), seat => {
                                const shape = getComputedStyle(seat.querySelector('svg'));
                                const fill = rgb(shape.fill);
                                const ink = rgb(getComputedStyle(seat.querySelector('strong')).color);
                                const line = rgb(shape.stroke);
                                const a = luminance(fill), b = luminance(ink);
                                return { status: seat.dataset.status, line, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
                            }),
                        };
                    });
                    assert.equal(visual.overflow, false, `${role}, ${theme}, ${width}`);
                    for (const seat of visual.seats) {
                        assert.ok(seat.contrast >= 4.5, `Bed code contrast: ${JSON.stringify(seat)}`);
                        const dominant = seat.line.indexOf(Math.max(...seat.line));
                        if (seat.status === 'KOSONG') assert.equal(dominant, 1);
                        if (seat.status === 'TERISI') assert.equal(dominant, 0);
                        if (seat.status === 'SIAP_TRANSFER') assert.equal(dominant, 2);
                    }
                    if (width === 1440 || width === 390 || width === 320) {
                        await page.evaluate(() => document.fonts.ready);
                        await page.locator('.transit-map').screenshot({ path: path.join(output, `${role}-${theme}-${width}.png`) });
                    }
                    results.push({ role, theme, width, ok: true });
                }
            }
            query("UPDATE patients SET status='READY_TRANSFER' WHERE medical_record_number='MAP-1A'");
            query("UPDATE beds SET status='SIAP_TRANSFER' WHERE bed_code='1A'");
            await poll(page);
            const firstBedId = query("SELECT id FROM beds WHERE bed_code='1A'")[0].id;
            assert.equal(await page.locator(`[data-transit-bed="${firstBedId}"]`).getAttribute('data-status'), 'SIAP_TRANSFER');
            assert.equal(await page.locator('.stat-card [data-summary=ready]').innerText(), '2');
            query("INSERT INTO beds (bed_code,status) VALUES ('QA-X1','KOSONG')");
            await poll(page);
            assert.equal(await page.locator('[data-transit-bed]').count(), 20);
            assert.equal(await page.locator('[data-transit-room=other] h3').innerText(), 'Bed Lainnya');
            assert.equal(await page.locator('[data-transit-map-total]').innerText(), '20 bed · 6 kelompok kamar');
            assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true);
            query("DELETE FROM beds WHERE bed_code='QA-X1'");
            query("UPDATE patients SET status='ACTIVE' WHERE medical_record_number='MAP-1A'");
            query("UPDATE beds SET status='TERISI' WHERE bed_code='1A'");
            await poll(page);
            assert.equal(await page.locator('[data-transit-bed]').count(), 19);
            assert.equal(await page.locator('[data-transit-room=other]').count(), 0);
            await page.evaluate(() => { window.__qaSeatNode = document.querySelector('[data-transit-bed]'); });
            await poll(page);
            assert.equal(await page.evaluate(() => window.__qaSeatNode === document.querySelector('[data-transit-bed]')), true);
            await context.close();
            console.log(`PASS ${role}: bed inventory/status, colors/contrast, both themes, 6 viewports, live status/new bed updates`);
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${results.length} dashboard map layouts; no JavaScript errors. Artifacts: ${output}`);
    } catch (error) {
        errors.push(error.message);
        process.exitCode = 1;
        console.error(error.stack);
    } finally {
        await browser?.close();
        if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
        if (created) execFileSync(php, [path.join(__dirname, 'support.php'), 'drop'], { cwd: root, env, windowsHide: true });
        assert.deepEqual(cli('fingerprint', null, process.env), before, 'Application core data changed');
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, coreDataUnchanged: true }, null, 2));
        console.log(`Application core data unchanged. Artifacts: ${output}`);
    }
})();
