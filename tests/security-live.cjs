// Read-only checks of Apache and database configuration. No patient data is printed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const php = process.env.PHP_BINARY || 'C:\\xampp\\php\\php.exe';
const base = process.env.LIVE_BASE_URL || 'http://localhost/project_web/';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-security-live-'));
const fingerprint = () => JSON.parse(execFileSync(php, ['tests/support.php', 'fingerprint'], { cwd: root, encoding: 'utf8', windowsHide: true }));
const results = [], findings = [];
const before = fingerprint();
async function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const library = url.startsWith('https:') ? https : http;
        const req = library.request(url, { timeout: 5000, ...options }, res => {
            let length = 0;
            res.on('data', data => { length += data.length; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, length }));
        });
        req.on('timeout', () => req.destroy(new Error('Connection timeout')));
        req.on('error', reject);
        req.end();
    });
}
async function check(name, work) {
    try { await work(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
(async () => {
    try {
        const configuration = JSON.parse(execFileSync(php, ['-r', `
            $GLOBALS['config']=require 'config/app.php'; require 'includes/helpers.php'; require 'config/database.php';
            $pdo=db(); $accounts=[];
            $stmt=$pdo->prepare('SELECT password_hash,is_active FROM users WHERE username=?');
            foreach (['admin'=>'Admin@123','igd'=>'Igd@1234','transit'=>'Transit@123'] as $name=>$password) {
                $stmt->execute([$name]); $row=$stmt->fetch();
                if ($row && $row['is_active'] && password_verify($password,$row['password_hash'])) { $accounts[]=$name; }
            }
            $grants=$pdo->query('SHOW GRANTS FOR CURRENT_USER()')->fetchAll(PDO::FETCH_COLUMN);
            echo json_encode(['php_version'=>PHP_VERSION,'db_version'=>$pdo->getAttribute(PDO::ATTR_SERVER_VERSION),
                'db_user'=>app_config('db.username'),'empty_db_password'=>app_config('db.password') === '',
                'global_db_privileges'=>count(array_filter($grants,fn($grant)=>str_contains($grant,'ON *.*') && !str_starts_with($grant,'GRANT USAGE ON'))) > 0,
                'active_default_accounts'=>$accounts]);
        `], { cwd: root, encoding: 'utf8', windowsHide: true }));
        if (configuration.active_default_accounts.length) findings.push({ severity: 'high', issue: 'Active demo accounts still use documented default passwords', accounts: configuration.active_default_accounts });
        if (configuration.empty_db_password || configuration.global_db_privileges) findings.push({ severity: 'high', issue: 'Database account lacks a password or has global privileges', user: configuration.db_user });
        if (configuration.php_version === '8.2.12' || /^10\.4\./.test(configuration.db_version)) {
            findings.push({ severity: 'high', issue: 'Old PHP patch or unsupported MariaDB 10.4 requires an update', php: configuration.php_version, database: configuration.db_version });
        }
        await check('Sensitive directories, source documents and hidden configuration denied by Apache', async () => {
            for (const location of ['config/app.php', 'config/database.php', 'includes/helpers.php', 'database/setup.php', 'database/schema.sql', 'database/migrate.php', 'logs/php-error.log', 'tests/support.php', 'tests/security.cjs', 'README.md', '.htaccess', '.env', '.git/HEAD', '.git/config', 'index.php.bak']) {
                const response = await request(base + location);
                assert.ok([403, 404].includes(response.status), `${location}: HTTP ${response.status}`);
            }
        });
        await check('Apache denies anonymous access to patient management and bed API', async () => {
            for (const location of ['index.php?page=patients', 'index.php?page=transfer', 'index.php?page=export', 'api.php?action=beds']) {
                const response = await request(base + location);
                assert.equal(response.status, 302);
                assert.match(response.headers.location, /page=login/);
            }
        });
        await check('Security headers are present on the actual Apache login page', async () => {
            const response = await request(base + 'index.php?page=login');
            assert.equal(response.status, 200);
            assert.equal(response.headers['x-content-type-options'], 'nosniff');
            assert.match(response.headers['content-security-policy'], /script-src 'self'/);
            assert.equal(response.headers['x-powered-by'], undefined);
            const cookies = response.headers['set-cookie'] || [];
            assert.ok(cookies.some(value => /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value) && value.includes('path=' + new URL(base).pathname)));
            if (response.headers.server) findings.push({ severity: 'low', issue: 'Server response exposes software versions', server: response.headers.server });
        });
        await check('External Referer stays inside the actual Apache application', async () => {
            const body = '_csrf=invalid';
            const response = await new Promise((resolve, reject) => {
                const req = http.request(base + 'index.php?page=login', { method: 'POST', headers: { Referer: 'https://example.invalid/phishing', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', () => resolve(res)); });
                req.on('error', reject); req.end(body);
            });
            assert.match(response.headers.location, /^index\.php(?:\?|$)/);
        });
        const trace = await request(base, { method: 'TRACE', headers: { 'X-Audit-Probe': 'benign' } });
        if (trace.status === 200) findings.push({ severity: 'low', issue: 'Apache TRACE is enabled' });
        const secureURL = new URL('index.php?page=login', base); secureURL.protocol = 'https:';
        try { await request(secureURL.href); }
        catch (error) { findings.push({ severity: 'medium', issue: 'HTTPS certificate cannot be validated by this client', reason: error.code || error.message }); }
        if (base.startsWith('http:')) findings.push({ severity: 'high', issue: 'Normal application address uses unencrypted HTTP; require trusted HTTPS for hospital LAN clients' });
        findings.push({ severity: 'accepted-policy', issue: 'New nurse registrations remain immediately active as requested; limit who can reach the application' });
        fs.writeFileSync(path.join(output, 'configuration.json'), JSON.stringify({ configuration, findings }, null, 2));
        console.log(JSON.stringify({ configuration, findings }, null, 2));
    } catch (error) { results.push({ name: 'Runner', ok: false, error: error.message }); process.exitCode = 1; console.error(error.message); }
    finally {
        await check('Main data unchanged by read-only security audit', async () => assert.deepEqual(fingerprint(), before));
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        console.log(`${results.filter(item => item.ok).length}/${results.length} live security groups passed. Artifacts: ${output}`);
        if (results.some(item => !item.ok)) process.exitCode = 1;
    }
})();
