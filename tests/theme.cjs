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
const env = { ...process.env, DB_DATABASE: `e_transit_qa_${Date.now()}_${process.pid}` };
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-theme-'));
const errors = [];
const resourceErrors = [];
let browser, server, created = false, before;
let pagesChecked = 0, contrastChecked = 0;
let failure = null;
const cli = (command, input = null, environment = env) => {
    const result = execFileSync(php, [support, command], { cwd: root, env: environment, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true });
    return result ? JSON.parse(result) : null;
};
const query = (sql, params = []) => cli('query', { sql, params });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const trackResources = context => {
    context.on('requestfailed', request => {
        if (request.failure()?.errorText !== 'net::ERR_ABORTED') resourceErrors.push({ url: request.url(), error: request.failure()?.errorText });
    });
    context.on('response', response => {
        if (response.status() >= 400) resourceErrors.push({ url: response.url(), status: response.status() });
    });
};

async function checkPage(page, theme) {
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(await page.getByRole('switch', { name: 'Mode gelap' }).getAttribute('aria-checked'), String(theme === 'dark'));
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true, `Overflow: ${page.url()}`);
    assert.equal(await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).length), 0);
    const contrast = await page.evaluate(() => {
        const rgba = value => {
            const numbers = value.match(/[\d.]+/g)?.map(Number);
            return numbers?.length >= 3 ? [...numbers.slice(0, 3), numbers[3] ?? 1] : [0, 0, 0, 0];
        };
        const blend = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
        const luminance = color => color.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const background = element => {
            const ancestors = [];
            for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
            let candidates = [[255, 255, 255]];
            for (const node of ancestors) {
                const style = getComputedStyle(node);
                const solid = rgba(style.backgroundColor);
                candidates = candidates.map(bg => blend(solid, bg));
                const stops = style.backgroundImage.match(/rgba?\([^)]*\)/g);
                if (stops) candidates = candidates.flatMap(bg => stops.map(color => blend(rgba(color), bg)));
                if (candidates.length > 24) candidates = candidates.sort((a, b) => luminance(a) - luminance(b)).filter((_, i, all) => i < 3 || i >= all.length - 3);
            }
            return candidates;
        };
        const selectors = 'h1, h2, h3, label, .btn, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, .eyebrow, .nav-menu a, .sidebar-brand span, .sidebar-institution, .user-chip span, .user-chip small, .panel-title p, .toolbar-panel p, .stat-heading span, .stat-card > span, .bed-patient strong, .bed-patient span, .bed-patient small, .bed-empty, .status-badge, .legend span, .bed-group-count, .bed-group-summary span, .data-table th, .data-table td:not(.table-actions), .detail-grid span, .detail-grid strong, .dashboard-criterion p, .dashboard-section-meta, .password-hint, .recommendation-box, .auth-brand p, .auth-switch, .theme-toggle-copy small, [data-theme-label], .transit-map-heading p, .transit-map-meta, .transit-map-legend span, .transit-room-heading span, .transit-seat-code, .transit-seat-status';
        const failures = [];
        let checked = 0;
        for (const element of document.querySelectorAll(selectors)) {
            const style = getComputedStyle(element);
            const field = element.matches('input,select,textarea');
            const text = field ? element.value || element.placeholder || 'Form field' : element.textContent.trim();
            if (!element.getClientRects().length || style.visibility === 'hidden' || element.closest('[inert]') || element.disabled || !text) continue;
            const color = rgba(field && !element.value && element.placeholder ? getComputedStyle(element, '::placeholder').color : style.color);
            const ratios = background(element).map(bg => {
                const fg = luminance(blend(color, bg)), back = luminance(bg);
                return (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05);
            });
            const ratio = Math.min(...ratios);
            const size = parseFloat(style.fontSize);
            const target = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5;
            checked++;
            if (ratio < target) failures.push({ tag: element.tagName, class: element.className, text: text.slice(0, 65), ratio: Number(ratio.toFixed(2)), target, color: style.color });
        }
        return { checked, failures };
    });
    contrastChecked += contrast.checked;
    if (contrast.failures.length) {
        await page.screenshot({ path: path.join(output, 'contrast-failure.png'), fullPage: true });
        const diagnostics = await page.evaluate(() => ({
            bodyClass: document.body.className,
            theme: document.documentElement.dataset.theme,
            sheets: Array.from(document.styleSheets, sheet => ({ href: sheet.href, disabled: sheet.disabled, rules: sheet.cssRules.length })),
            links: Array.from(document.querySelectorAll('link[rel=stylesheet]'), link => ({ href: link.href, loaded: Boolean(link.sheet) })),
        }));
        fs.writeFileSync(path.join(output, 'contrast-failure.json'), JSON.stringify({ contrast, diagnostics, resourceErrors }, null, 2));
    }
    assert.deepEqual(contrast.failures, [], `Text contrast on ${page.url()} (${theme}): ${JSON.stringify(contrast.failures)}`);
    pagesChecked++;
}

(async () => {
    try {
        before = cli('fingerprint', null, process.env);
        execFileSync(php, [support, 'create'], { cwd: root, env, windowsHide: true });
        created = true;
        for (const [index, status] of ['ACTIVE', 'READY_TRANSFER'].entries()) {
            const bed = index + 1;
            query("INSERT INTO patients (medical_record_number,full_name,gender,birth_date,address,marital_status,dependency_level,doctor_id,diagnosis,consciousness_status,planned_room,arrival_time,bed_id,status) VALUES (?,'Pasien Contoh Tampilan','L','1990-01-01','Alamat Contoh','Menikah','Minimal Care',1,'Observasi','Compos Mentis','Hasan bin Ali',NOW(),?,?)", [`THEME-${bed}`, bed, status]);
            const id = query('SELECT id FROM patients WHERE medical_record_number=?', [`THEME-${bed}`])[0].id;
            query('UPDATE beds SET patient_id=?,status=? WHERE id=?', [id, index ? 'SIAP_TRANSFER' : 'TERISI', bed]);
        }
        query("UPDATE beds SET status='NONAKTIF' WHERE id=4");
        const detailId = query('SELECT id FROM patients ORDER BY id LIMIT 1')[0].id;
        const port = await new Promise(resolve => {
            const socket = net.createServer().listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
        });
        server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        server.stderr.pipe(fs.createWriteStream(path.join(output, 'server.log')));
        const baseURL = `http://127.0.0.1:${port}/`;
        for (let i = 0; i < 60; i++) { try { if ((await fetch(baseURL)).ok) break; } catch {} await pause(100); }
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const roles = [
            { name: 'admin', password: 'Admin@123', pages: ['dashboard', 'monitor', 'transit', 'patient_form', 'patients', `patient_detail&id=${detailId}`, 'transfer', 'doctors', 'reports', 'beds', 'users', 'audit', 'profile'] },
            { name: 'igd', password: 'Igd@1234', pages: ['dashboard', 'monitor', 'profile'] },
            { name: 'transit', password: 'Transit@123', pages: ['dashboard', 'transit', 'patient_form', 'patients', `patient_detail&id=${detailId}`, 'transfer', 'doctors', 'reports', 'profile'] },
        ];
        for (const role of roles) {
            const context = await browser.newContext({ baseURL, colorScheme: 'light', reducedMotion: 'reduce' });
            trackResources(context);
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('index.php?page=login');
            await page.locator('[name=identity]').fill(role.name);
            await page.locator('[name=password]').fill(role.password);
            await Promise.all([page.waitForURL(url => url.searchParams.get('page') !== 'login'), page.locator('.auth-submit').click()]);
            for (const width of [1440, 1024, 821, 390, 320]) {
                await page.setViewportSize({ width, height: 960 });
                for (const theme of ['dark', 'light']) {
                    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click();
                    for (const route of role.pages) {
                        const response = await page.goto(`index.php?page=${route}`);
                        assert.equal(response.status(), 200);
                        await checkPage(page, theme);
                        if (width === 1440 && role.name === 'admin' && ['dashboard', 'transit', 'patient_form', 'patients', 'reports'].includes(route)
                            || width === 390 && theme === 'dark' && ['monitor', 'transit', 'patient_form'].includes(route)) {
                            await page.screenshot({ path: path.join(output, `${role.name}-${route}-${theme}-${width}.png`), fullPage: true });
                        }
                    }
                }
            }
            console.log(`PASS Both themes, all pages, contrast, assets and mobile layouts: ${role.name}`);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.getByRole('switch', { name: 'Mode gelap' }).focus();
            await page.keyboard.press('Space');
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
            await page.reload();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
            await page.getByRole('button', { name: 'Buka menu', exact: true }).click();
            const navContrast = await page.locator('.sidebar').evaluate(sidebar => getComputedStyle(sidebar).backgroundImage);
            assert.ok(navContrast.includes('21, 38, 58'));
            await checkPage(page, 'dark');
            await page.screenshot({ path: path.join(output, `${role.name}-mobile-sidebar-dark.png`) });
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('[data-menu-toggle]').getAttribute('aria-expanded'), 'false');
            const second = await context.newPage();
            await second.goto('index.php?page=dashboard');
            await page.getByRole('switch', { name: 'Mode gelap' }).click();
            await second.waitForFunction(() => document.documentElement.dataset.theme === 'light');
            await second.close();
            await page.emulateMedia({ media: 'print' });
            const printed = await page.locator('.theme-toggle').evaluate(button => getComputedStyle(button).display);
            assert.equal(printed, 'none');
            await context.close();
        }
        const context = await browser.newContext({ baseURL, colorScheme: 'dark', reducedMotion: 'reduce' });
        trackResources(context);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('index.php?page=login');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await page.getByRole('switch', { name: 'Mode gelap' }).click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.emulateMedia({ colorScheme: 'light' });
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        for (const route of ['login', 'register']) {
            for (const width of [1440, 390, 320]) {
                await page.setViewportSize({ width, height: 960 });
                for (const theme of ['dark', 'light']) {
                    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('switch', { name: 'Mode gelap' }).click();
                    await page.goto(`index.php?page=${route}`);
                    await checkPage(page, theme);
                    if (theme === 'dark' && width !== 320) await page.screenshot({ path: path.join(output, `${route}-${theme}-${width}.png`), fullPage: true });
                }
            }
        }
        await context.close();
        const blocked = await browser.newContext({ baseURL, colorScheme: 'light' });
        trackResources(blocked);
        await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
        const blockedPage = await blocked.newPage();
        blockedPage.on('pageerror', error => errors.push(error.message));
        await blockedPage.goto('index.php?page=login');
        await blockedPage.getByRole('switch', { name: 'Mode gelap' }).click();
        assert.equal(await blockedPage.locator('html').getAttribute('data-theme'), 'dark');
        await blocked.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(resourceErrors, [], 'Failed page resources');
        console.log('PASS Keyboard switch, reload persistence, cross-tab sync, system theme, blocked storage and print');
        console.log(`PASS ${pagesChecked} page/theme/viewport checks; ${contrastChecked} text contrast checks. Screenshots: ${output}`);
    } catch (error) {
        failure = error.message;
        console.error(error.stack);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
        if (created) cli('drop');
        if (before) assert.deepEqual(cli('fingerprint', null, process.env), before, 'Application core data changed');
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ pagesChecked, contrastChecked, failure, errors, resourceErrors }, null, 2));
        console.log(`Application core data unchanged. Artifacts: ${output}`);
    }
})();
