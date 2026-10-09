// Read-only pages/API on the actual XAMPP app. Login/logout update session/audit metadata only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

const root = path.resolve(__dirname, '..');
const php = process.env.PHP_BINARY || 'C:\\xampp\\php\\php.exe';
const baseURL = process.env.LIVE_BASE_URL || 'http://localhost/project_web/';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-live-health-'));
const errors = [], resourceErrors = [], results = [];
const fingerprint = () => JSON.parse(execFileSync(php, [path.join(__dirname, 'support.php'), 'fingerprint'], { cwd: root, encoding: 'utf8', windowsHide: true }));
const metadata = JSON.parse(execFileSync(php, ['-r', `
    $GLOBALS['config']=require 'config/app.php'; require 'includes/helpers.php'; require 'config/database.php';
    $stmt=db()->prepare('SELECT password_hash,is_active FROM users WHERE username=?');
    $flags=[]; foreach (['admin'=>'Admin@123','igd'=>'Igd@1234','transit'=>'Transit@123'] as $name=>$password) {
        $stmt->execute([$name]); $row=$stmt->fetch();
        $flags[$name]=$row && $row['is_active'] && password_verify($password,$row['password_hash']);
    }
    echo json_encode(['login_available'=>$flags,'detail_id'=>db()->query('SELECT MIN(id) FROM patients WHERE deleted_at IS NULL')->fetchColumn()]);
`], { cwd: root, encoding: 'utf8', windowsHide: true }));
const roles = [
    { name: 'admin', password: 'Admin@123', pages: ['dashboard', 'monitor', 'transit', 'patient_form', 'patients', 'transfer', 'doctors', 'reports', 'beds', 'users', 'audit', 'profile'] },
    { name: 'igd', password: 'Igd@1234', pages: ['dashboard', 'monitor', 'profile'] },
    { name: 'transit', password: 'Transit@123', pages: ['dashboard', 'transit', 'patient_form', 'patients', 'transfer', 'doctors', 'reports', 'profile'] },
];
if (metadata.detail_id) {
    for (const role of roles.filter(role => role.name !== 'igd')) role.pages.push(`patient_detail&id=${Number(metadata.detail_id)}`);
}
let browser;
const before = fingerprint();

(async () => {
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        for (const role of roles) {
            assert.ok(metadata.login_available[role.name], `Default login unavailable for ${role.name}; no password changed by audit.`);
            const context = await browser.newContext({ baseURL, reducedMotion: 'reduce', colorScheme: 'light' });
            context.on('requestfailed', request => {
                if (request.failure()?.errorText !== 'net::ERR_ABORTED') resourceErrors.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
            });
            context.on('response', response => {
                if (response.status() >= 400) resourceErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('index.php?page=login');
            await page.locator('[name=identity]').fill(role.name);
            await page.locator('[name=password]').fill(role.password);
            await Promise.all([
                page.waitForURL(url => url.searchParams.get('page') === (role.name === 'igd' ? 'monitor' : 'dashboard')),
                page.locator('.auth-submit').click(),
            ]);
            for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
                await page.setViewportSize({ width, height: 900 });
                if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click();
                for (const route of role.pages) {
                    const response = await page.goto(`index.php?page=${route}`);
                    assert.equal(response.status(), 200, `${role.name}: ${route}`);
                    assert.equal(await page.locator('.content-shell').count(), 1, `${role.name}: ${route} missing app layout`);
                    assert.equal(await page.locator('.sidebar-brand span').innerText(), { admin: 'Admin', igd: 'Perawat IGD', transit: 'Perawat Transit' }[role.name]);
                    const state = await page.evaluate(() => ({
                        overflow: document.body.scrollWidth > innerWidth + 1,
                        missingSheets: Array.from(document.querySelectorAll('link[rel=stylesheet]')).filter(link => !link.sheet).map(link => new URL(link.href).pathname),
                        brokenImages: Array.from(document.images).filter(image => !image.complete || !image.naturalWidth).length,
                        theme: document.documentElement.dataset.theme,
                        failure: /Database belum siap|Terjadi kesalahan pada sistem|Fatal error|SQLSTATE\[/.test(document.body.innerText),
                    }));
                    assert.deepEqual(state, { overflow: false, missingSheets: [], brokenImages: 0, theme, failure: false }, `${role.name}: ${route}`);
                    if (route === 'dashboard') {
                        const bedPayload = await (await context.request.get('api.php?action=beds')).json();
                        assert.equal(await page.locator('[data-transit-bed]').count(), bedPayload.beds.length);
                        assert.deepEqual(await page.locator('.transit-room-heading h3').allTextContents(), bedPayload.groups.map(group => group.label));
                        for (const bed of bedPayload.beds) {
                            assert.equal(await page.locator(`[data-transit-bed="${bed.id}"]`).getAttribute('data-status'), bed.status);
                        }
                    }
                    results.push({ role: role.name, route: route.split('&')[0], width, theme, ok: true });
                }
            }
            for (let i = 0; i < 2; i++) {
                const response = await context.request.get('api.php?action=beds');
                assert.equal(response.status(), 200);
                const payload = await response.json();
                assert.equal(payload.ok, true);
                assert.equal(payload.beds.length, 19);
                assert.equal(payload.summary.empty + payload.summary.occupied + payload.summary.ready + payload.summary.inactive, 19);
                results.push({ role: role.name, route: 'api.beds', ok: true });
            }
            await page.getByRole('button', { name: 'Buka menu', exact: true }).click();
            const logout = page.locator('.logout-form');
            await Promise.all([page.waitForURL(url => url.searchParams.get('page') === 'login'), logout.locator('button').click()]);
            await context.close();
            console.log(`PASS Apache XAMPP pages, mobile, assets, theme, live bed API, login/logout: ${role.name}`);
        }
        assert.deepEqual(errors, [], 'JavaScript errors');
        assert.deepEqual(resourceErrors, [], 'Failed live resources');
        console.log(`PASS ${results.length} live page/API checks; no runtime/resource errors.`);
    } catch (error) {
        errors.push(error.message);
        process.exitCode = 1;
        console.error(error.message);
    } finally {
        await browser?.close();
        const unchanged = JSON.stringify(before) === JSON.stringify(fingerprint());
        if (!unchanged) { process.exitCode = 1; errors.push('Core database fingerprint changed during audit.'); }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), baseURL, results, errors, resourceErrors, coreDataUnchanged: unchanged }, null, 2));
        console.log(`Core data unchanged: ${unchanged}. Artifacts: ${output}`);
    }
})();
