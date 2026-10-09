// Security regressions run only against an isolated e_transit_qa_* database.
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
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-security-'));
const results = [], servers = [], contexts = [];
let browser, created = false, before, throttlePath, lockProcess;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cli = (command, input = null, environment = env) => {
    const value = execFileSync(php, [support, command], { cwd: root, env: environment, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true });
    return value ? JSON.parse(value) : null;
};
const query = (sql, params = []) => cli('query', { sql, params });
const one = (sql, params = []) => query(sql, params)[0];
async function check(name, work) {
    try { await work(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function startServer() {
    const port = await new Promise(resolve => {
        const socket = net.createServer();
        socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
    });
    const child = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.pipe(fs.createWriteStream(path.join(output, `server-${port}.log`)));
    servers.push(child);
    const base = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`${base}index.php?page=login`)).ok) return base; } catch {}
        await pause(100);
    }
    throw new Error('Security test server did not start.');
}
async function client(base) {
    const context = await browser.newContext({ baseURL: base });
    contexts.push(context);
    return { context, base };
}
async function post(c, page, data, options = {}) {
    const url = `${c.base}index.php?page=${page}`;
    const html = await (await c.context.request.get(url)).text();
    const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.ok(token, `Missing CSRF token on ${page}`);
    return c.context.request.post(url, { form: { _csrf: token, ...data }, headers: { Referer: url }, ...options });
}
async function login(c, identity, password) {
    const response = await post(c, 'login', { identity, password });
    assert.match(response.url(), /page=(dashboard|monitor)/);
}
const cookie = async c => (await c.context.cookies()).find(item => item.name === 'ETRANSITSESSID');

(async () => {
    try {
        before = cli('fingerprint', null, process.env);
        execFileSync(php, [support, 'create'], { cwd: root, env, windowsHide: true });
        created = true;
        throttlePath = cli('login-throttle-path', { ip: '127.0.0.1' });
        const base = await startServer(), secondBase = await startServer();
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const admin = await client(base), transit = await client(base);
        await login(admin, 'admin', 'Admin@123');
        await login(transit, 'transit', 'Transit@123');

        await check('Security headers protect login, private pages and API', async () => {
            for (const url of ['index.php?page=login', 'index.php?page=patients', 'api.php?action=beds']) {
                const response = await admin.context.request.get(url);
                const headers = response.headers();
                assert.equal(headers['x-content-type-options'], 'nosniff');
                assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
                assert.equal(headers['referrer-policy'], 'same-origin');
                assert.match(headers['content-security-policy'], /script-src 'self'/);
                assert.match(headers['content-security-policy'], /object-src 'none'/);
                assert.match(headers['content-security-policy'], /frame-ancestors 'self'/);
                assert.equal(headers['x-powered-by'], undefined);
            }
        });
        await check('Uninitialized attacker-chosen session IDs are replaced and cookies are HttpOnly', async () => {
            const c = await client(base);
            const chosen = 'attackerchosen12345678901234567890';
            await c.context.addCookies([{ name: 'ETRANSITSESSID', value: chosen, url: base }]);
            await c.context.request.get('index.php?page=login');
            const newCookie = await cookie(c);
            assert.notEqual(newCookie.value, chosen);
            assert.equal(newCookie.httpOnly, true);
            assert.equal(newCookie.sameSite, 'Lax');
        });
        await check('Untrusted Referer cannot redirect the browser off-site', async () => {
            const c = await client(base);
            for (const referer of ['https://example.invalid/phishing', '//example.invalid/', 'https://example.invalid/index.php?page=login']) {
                const response = await c.context.request.post('index.php?page=login', {
                    form: { _csrf: 'invalid' }, headers: { Referer: referer }, maxRedirects: 0,
                });
                assert.match(response.headers().location, /^index\.php(?:\?|$)/);
            }
        });
        await check('Login failures remain limited across new cookies, email aliases and expiry', async () => {
            const c = await client(base);
            for (let i = 0; i < 5; i++) {
                assert.match(await (await post(c, 'login', { identity: 'igd', password: 'Wrong@123' })).text(), /Username atau password tidak valid/);
            }
            const fresh = await client(secondBase);
            const blocked = await post(fresh, 'login', { identity: 'igd@etransit.local', password: 'Igd@1234' }, { maxRedirects: 0 });
            assert.ok(Number(blocked.headers()['retry-after']) > 0);
            assert.match(blocked.headers().location, /page=login/);
            assert.match(await (await fresh.context.request.get('index.php?page=login')).text(), /Terlalu banyak percobaan login/);
            // Expire only this QA database's throttle file; no waiting or production resets.
            const state = JSON.parse(fs.readFileSync(throttlePath, 'utf8'));
            state.started_at -= 301;
            fs.writeFileSync(throttlePath, JSON.stringify(state));
            await login(fresh, 'igd', 'Igd@1234');
        });
        await check('Changing password rotates the current session and revokes other sessions', async () => {
            const a = await client(base), b = await client(secondBase);
            await login(a, 'transit', 'Transit@123');
            await login(b, 'transit', 'Transit@123');
            const oldCookie = await cookie(a);
            await post(a, 'profile', { action: 'change_password', current_password: 'Transit@123', password: 'Changed@123', password_confirm: 'Changed@123' });
            assert.notEqual((await cookie(a)).value, oldCookie.value);
            assert.match((await a.context.request.get('index.php?page=patients')).url(), /page=patients/);
            assert.match((await b.context.request.get('index.php?page=patients')).url(), /page=login/);
            await post(a, 'profile', { action: 'change_password', current_password: 'Changed@123', password: 'Transit@123', password_confirm: 'Transit@123' });
            await login(transit, 'transit', 'Transit@123');
        });
        await check('Role changes revoke already-authenticated sessions', async () => {
            const c = await client(base);
            await login(c, 'igd', 'Igd@1234');
            const user = one("SELECT id,role_id FROM users WHERE username = 'igd'");
            try {
                query("UPDATE users SET role_id = (SELECT id FROM roles WHERE code='perawat_transit') WHERE id = ?", [user.id]);
                assert.match((await c.context.request.get('index.php?page=patients')).url(), /page=login/);
            } finally { query('UPDATE users SET role_id = ? WHERE id = ?', [user.role_id, user.id]); }
        });
        await check('Registration stays immediately active but rejects passwords exceeding bcrypt length', async () => {
            const c = await client(base);
            const data = { full_name: 'Security QA', username: 'security_qa', email: 'security_qa@example.test', role: 'perawat_transit', password: 'Security@123', password_confirm: 'Security@123' };
            await post(c, 'register', { ...data, password: 'Long@123' + 'x'.repeat(80), password_confirm: 'Long@123' + 'x'.repeat(80) });
            assert.equal(one('SELECT COUNT(*) AS n FROM users WHERE username = ?', [data.username]).n, 0);
            await post(c, 'register', data);
            assert.equal(one('SELECT is_active FROM users WHERE username = ?', [data.username]).is_active, 1);
            await login(c, data.username, data.password);
            for (const action of ['save_user', 'toggle_user', 'save_bed', 'toggle_bed']) {
                assert.equal((await post(c, 'dashboard', { action, id: 1 })).status(), 403);
            }
        });
        await check('Untrusted export filter cannot inject attachment headers; formulas remain plain text', async () => {
            const response = await admin.context.request.get('index.php?page=export&month=' + encodeURIComponent('2026-10"\r\nX-Injected: yes'));
            assert.equal(response.status(), 200);
            assert.equal(response.headers()['x-injected'], undefined);
            assert.match(response.headers()['content-disposition'], /^attachment; filename="[A-Za-z0-9_.-]+"$/);
            const xml = execFileSync(php, ['-r', "require 'includes/xlsx.php'; echo xlsx_sheet_xml([['=HYPERLINK(\"https://example.invalid\")']]);"], { cwd: root, encoding: 'utf8', windowsHide: true });
            assert.match(xml, /t="inlineStr"/);
            assert.doesNotMatch(xml, /<f[ >]/);
        });
        await check('Bed deactivation waits for admission and cannot deactivate a newly occupied bed', async () => {
            const bed = one("SELECT id FROM beds WHERE status = 'KOSONG' ORDER BY id LIMIT 1");
            query("INSERT INTO patients (medical_record_number,full_name,gender,birth_date,address,marital_status,dependency_level,doctor_id,diagnosis,consciousness_status,planned_room,arrival_time,bed_id,status) VALUES ('SEC-RACE','Pasien Uji Keamanan','L','1990-01-01','Alamat Uji','Menikah','Minimal Care',1,'Observasi','Compos Mentis','Hasan bin Ali',NOW(),?,'ACTIVE')", [bed.id]);
            const patient = one("SELECT id FROM patients WHERE medical_record_number='SEC-RACE'");
            const phpLock = `
                $GLOBALS['config']=require 'config/app.php'; require 'includes/helpers.php'; require 'config/database.php';
                if (!preg_match('/^e_transit_qa_[0-9_]+$/', app_config('db.database'))) { exit(1); }
                $pdo=db(); $pdo->beginTransaction();
                $stmt=$pdo->prepare('SELECT * FROM beds WHERE id=? FOR UPDATE'); $stmt->execute([(int)$argv[1]]);
                echo "LOCKED\\n"; flush(); stream_set_timeout(STDIN,15);
                if (fgets(STDIN) === false) { $pdo->rollBack(); exit(1); }
                $pdo->prepare("UPDATE beds SET status='TERISI',patient_id=? WHERE id=?")->execute([(int)$argv[2],(int)$argv[1]]);
                $pdo->commit();
            `;
            lockProcess = spawn(php, ['-r', phpLock, String(bed.id), String(patient.id)], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
            let text = '';
            await new Promise((resolve, reject) => {
                lockProcess.stdout.on('data', data => { text += data; if (text.includes('LOCKED')) resolve(); });
                lockProcess.once('error', reject);
                lockProcess.once('exit', code => { if (!text.includes('LOCKED')) reject(new Error(`Lock helper exited ${code}`)); });
            });
            const pending = post(admin, 'beds', { action: 'toggle_bed', id: bed.id });
            let blocked = false;
            for (let i = 0; i < 50; i++) {
                if (one("SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX t JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id WHERE p.DB = ? AND t.trx_state = 'LOCK WAIT'", [database]).n > 0) { blocked = true; break; }
                await pause(50);
            }
            const exited = new Promise(resolve => lockProcess.once('exit', resolve));
            lockProcess.stdin.end('commit\n');
            const response = await pending;
            await exited;
            lockProcess = null;
            assert.ok(blocked, 'Concurrent request did not wait on the row lock');
            assert.match(await response.text(), /Bed sedang digunakan/);
            assert.deepEqual(one('SELECT status,patient_id FROM beds WHERE id = ?', [bed.id]), { status: 'TERISI', patient_id: patient.id });
        });
    } catch (error) { results.push({ name: 'Runner', ok: false, error: error.stack }); console.error(error.stack); }
    finally {
        lockProcess?.kill();
        await browser?.close();
        for (const child of servers) {
            const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped;
        }
        if (created) cli('drop');
        if (throttlePath && fs.existsSync(throttlePath)) fs.unlinkSync(throttlePath);
        if (before) await check('Main application data unchanged by security tests', async () => assert.deepEqual(cli('fingerprint', null, process.env), before));
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        const failed = results.filter(item => !item.ok);
        console.log(`${results.length - failed.length}/${results.length} security groups passed. Artifacts: ${output}`);
        process.exitCode = failed.length ? 1 : 0;
    }
})();
