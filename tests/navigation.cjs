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
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'etransit-navigation-'));
const errors = [];
const performanceResults = [];
const edgesOnly = process.argv.includes('--edges-only');
const cli = (command, environment = env) => {
    const text = execFileSync(php, [support, command], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true });
    return text ? JSON.parse(text) : null;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, server, created = false, before, navigations = 0;

async function client(baseURL, role, width, theme, options = {}) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 960 }, colorScheme: theme, reducedMotion: 'no-preference', ...options });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    await context.addInitScript(() => {
        window.__nativeTransition = false;
        addEventListener('pagereveal', event => {
            if (event.viewTransition) {
                window.__nativeTransition = true;
                event.viewTransition.ready.catch(() => {});
            }
        });
        document.addEventListener('click', event => {
            if (event.target.closest?.('.nav-menu a')) window.__clickStart = performance.now();
        }, true);
        addEventListener('click', event => {
            const link = event.target.closest?.('.nav-menu a');
            if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            window.__clickProbe = {
                href: link.href, prevented: event.defaultPrevented, clickedAt: Date.now(),
                handlerDuration: performance.now() - window.__clickStart,
            };
            try { sessionStorage.setItem('navigation-test-click', JSON.stringify(window.__clickProbe)); } catch {}
        });
    });
    const page = await context.newPage();
    await page.bringToFront();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /view.transition/i.test(message.text())) errors.push(message.text()); });
    await page.goto('index.php?page=login');
    await page.locator('[name=identity]').fill(role.user);
    await page.locator('[name=password]').fill(role.password);
    await Promise.all([page.waitForURL(url => url.searchParams.get('page') !== 'login'), page.locator('.auth-submit').click()]);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.nav-active-indicator').waitFor({ state: 'attached' });
    return { context, page };
}

async function navigate(page, href, mobile) {
    if (mobile) await page.getByRole('button', { name: 'Buka menu', exact: true }).click();
    await Promise.all([
        page.waitForURL(url => url.href === href),
        page.locator(`.nav-menu a[href="${new URL(href).pathname.split('/').pop()}${new URL(href).search}"]`).click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.nav-active-indicator').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.nav-menu [aria-current=page]').getAttribute('href'), `index.php${new URL(href).search}`);
    assert.equal(await page.locator('.content-shell').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true);
    const alignment = await page.locator('.nav-menu').evaluate(menu => {
        const active = menu.querySelector('[aria-current=page]');
        const marker = menu.querySelector('.nav-active-indicator');
        const matrix = new DOMMatrixReadOnly(getComputedStyle(marker).transform);
        return Math.abs(matrix.m42 - active.offsetTop) < 1 && marker.offsetHeight === active.offsetHeight;
    });
    assert.equal(alignment, true, 'The selection indicator must align with the actual active link');
    const state = await page.evaluate(() => {
        const main = document.querySelector('.content-shell');
        const style = getComputedStyle(main);
        return {
            click: JSON.parse(sessionStorage.getItem('navigation-test-click')),
            transform: style.transform, opacity: style.opacity,
            transitionName: style.viewTransitionName, native: window.__nativeTransition,
        };
    });
    assert.equal(state.click.href, href);
    assert.equal(state.click.prevented, false, 'A menu click must start normal navigation immediately');
    assert.equal(state.transform, 'none', 'Sidebar feedback must not move the page layout');
    assert.equal(state.opacity, '1', 'Sidebar feedback must not hide page content');
    assert.equal(state.transitionName, 'none');
    assert.equal(state.native, false, 'Sidebar navigation must not create full-page snapshots');
    if (mobile) assert.equal(await page.locator('[data-menu-toggle]').getAttribute('aria-expanded'), 'false');
    navigations++;
}

(async () => {
    try {
        before = cli('fingerprint', process.env);
        execFileSync(php, [support, 'create'], { cwd: root, env, windowsHide: true });
        created = true;
        const port = await new Promise(resolve => { const socket = net.createServer().listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
        server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        server.stderr.pipe(fs.createWriteStream(path.join(output, 'server.log')));
        const baseURL = `http://127.0.0.1:${port}/`;
        for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(baseURL)).ok) break; } catch {} await pause(100); }
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const roles = [{ user: 'admin', password: 'Admin@123' }, { user: 'igd', password: 'Igd@1234' }, { user: 'transit', password: 'Transit@123' }];
        for (const role of (edgesOnly ? [] : roles)) {
            for (const theme of ['light', 'dark']) {
                for (const width of [1440, 390]) {
                    const { context, page } = await client(baseURL, role, width, theme);
                    if (width <= 820) await page.getByRole('button', { name: 'Buka menu', exact: true }).click();
                    const links = await page.locator('.nav-menu a').evaluateAll(links => links.map(link => link.href));
                    if (width <= 820) await page.keyboard.press('Escape');
                    for (const href of links.filter(href => href !== page.url())) await navigate(page, href, width <= 820);
                    if (width <= 820) await page.getByRole('button', { name: 'Buka menu', exact: true }).click();
                    const active = page.locator('.nav-menu [aria-current=page]');
                    const oldURL = page.url();
                    await active.click();
                    const press = await active.evaluate(link => {
                        const animations = link.getAnimations({ subtree: true });
                        const names = animations.map(animation => animation.animationName || (animation.effect.target.classList.contains('nav-icon') ? 'icon-press' : 'other'));
                        animations.forEach(animation => { animation.pause(); animation.currentTime = 80; });
                        return names;
                    });
                    assert.ok(press.includes('sidebar-ripple'), 'Click feedback must animate');
                    assert.ok(press.includes('icon-press'), 'The clicked icon must animate');
                    await page.screenshot({ path: path.join(output, `${role.user}-${theme}-${width}-press.png`) });
                    await active.evaluate(link => link.getAnimations({ subtree: true }).forEach(animation => animation.play()));
                    await page.waitForFunction(() => !document.querySelector('.nav-click-ripple'));
                    assert.equal(page.url(), oldURL);
                    assert.equal(await page.locator('.nav-pending').count(), 0);
                    await page.screenshot({ path: path.join(output, `${role.user}-${theme}-${width}-sidebar.png`) });
                    if (width <= 820) await page.keyboard.press('Escape');
                    await page.goBack();
                    await page.waitForLoadState('domcontentloaded');
                    assert.equal(await page.locator('.content-shell').getAttribute('aria-busy'), null);
                    assert.equal(await page.locator('.nav-pending').count(), 0);
                    await context.close();
                }
            }
            console.log(`PASS Every sidebar item, both themes, immediate navigation, click effects and back: ${role.user}`);
        }

        for (const role of (edgesOnly ? [] : roles)) {
            const responsive = await client(baseURL, role, 1440, 'dark');
            const hrefs = await responsive.page.locator('.nav-menu a').evaluateAll(links => links.slice(0, 2).map(link => link.href));
            for (const width of [320, 390, 820, 821, 1024, 1440]) {
                await responsive.page.setViewportSize({ width, height: width === 320 ? 568 : 960 });
                await navigate(responsive.page, hrefs.find(href => href !== responsive.page.url()), width <= 820);
                if (width <= 820) await responsive.page.getByRole('button', { name: 'Buka menu', exact: true }).click();
                await responsive.page.locator('.nav-menu [aria-current=page]').scrollIntoViewIfNeeded();
                await responsive.page.waitForFunction(() => Math.abs(document.querySelector('.sidebar').getBoundingClientRect().left) < 1);
                assert.equal(await responsive.page.locator('.sidebar').evaluate(sidebar => sidebar.scrollWidth <= sidebar.clientWidth), true);
                await responsive.page.screenshot({ path: path.join(output, role.user + '-responsive-' + width + '.png') });
                if (width <= 820) await responsive.page.keyboard.press('Escape');
            }
            await responsive.context.close();
            console.log('PASS Resize across phone/tablet/desktop breakpoints without overflow: ' + role.user);
        }

        for (const role of (edgesOnly ? [] : roles)) {
            for (const width of [1440, 390]) {
                const slow = await client(baseURL, role, width, 'dark');
                await slow.page.goto('index.php?page=profile');
                await slow.page.waitForLoadState('domcontentloaded');
                const cdp = await slow.context.newCDPSession(slow.page);
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
                if (width <= 820) await slow.page.getByRole('button', { name: 'Buka menu', exact: true }).click();
                await slow.page.locator('.nav-menu [aria-current=page]').click();
                const feedback = await slow.page.evaluate(() => {
                    const main = document.querySelector('.content-shell');
                    return {
                        transform: getComputedStyle(main).transform,
                        opacity: getComputedStyle(main).opacity,
                        busy: main.getAttribute('aria-busy'),
                        sidebarAnimating: document.querySelector('.nav-menu').getAnimations({ subtree: true }).length > 0,
                    };
                });
                assert.deepEqual(feedback, { transform: 'none', opacity: '1', busy: null, sidebarAnimating: true });
                if (width <= 820) await slow.page.keyboard.press('Escape');
                await slow.page.locator('[name=current_password]').fill('Still responsive');
                assert.equal(await slow.page.locator('[name=current_password]').inputValue(), 'Still responsive');

                const href = baseURL + 'index.php?page=dashboard';
                let requestAt;
                await slow.page.route(href, async route => { requestAt = Date.now(); await route.continue(); });
                await navigate(slow.page, href, width <= 820);
                const probe = await slow.page.evaluate(() => JSON.parse(sessionStorage.getItem('navigation-test-click')));
                assert.equal(probe.prevented, false, 'Slow devices must also follow links immediately');
                assert.ok(requestAt);
                performanceResults.push({ role: role.user, width, cpuSlowdown: 6, clickHandlerMs: probe.handlerDuration, requestAfterClickMs: requestAt - probe.clickedAt });
                await slow.context.close();
                console.log('PASS Form input with sidebar feedback and immediate navigation at 6x CPU slowdown: ' + role.user + ' / ' + width + 'px');
            }
        }

        const { context, page } = await client(baseURL, roles[0], 1440, 'dark');
        const target = page.locator('.nav-menu a[href="index.php?page=doctors"]');
        await target.focus();
        await Promise.all([page.waitForURL(url => url.searchParams.get('page') === 'doctors'), page.keyboard.press('Enter')]);
        await page.waitForLoadState('domcontentloaded');
        assert.equal(await page.locator('[aria-current=page] .nav-label').innerText(), 'Data Dokter');
        const current = page.url();
        const popupWaiting = context.waitForEvent('page');
        await page.locator('.nav-menu a[href="index.php?page=patients"]').click({ modifiers: ['Control'] });
        const popup = await popupWaiting;
        await popup.waitForLoadState();
        assert.equal(new URL(popup.url()).searchParams.get('page'), 'patients');
        assert.equal(page.url(), current);
        assert.equal(await page.locator('.nav-pending').count(), 0);
        await popup.close();
        await context.close();
        console.log('PASS Keyboard Enter and Ctrl-click keep normal link behavior');

        const c = await client(baseURL, roles[0], 390, 'dark');
        await c.page.getByRole('button', { name: 'Buka menu', exact: true }).click();
        await c.page.evaluate(() => {
            document.querySelector('.nav-menu a[href="index.php?page=patients"]').click();
            document.querySelector('.nav-menu a[href="index.php?page=doctors"]').click();
        });
        // The browser cancels the first request when the second link wins.
        // Observe the final document rather than waiting on that aborted load.
        await c.page.waitForFunction(() => new URL(location.href).searchParams.get('page') === 'doctors');
        await c.page.waitForLoadState('domcontentloaded');
        assert.equal(await c.page.locator('.nav-pending').count(), 0);
        await c.context.close();
        console.log('PASS Rapid clicks reach the latest menu without animation timers');

        const reduced = await client(baseURL, roles[0], 1440, 'dark', { reducedMotion: 'reduce' });
        await reduced.page.locator('.nav-menu a[href="index.php?page=profile"]').click();
        assert.equal(new URL(reduced.page.url()).searchParams.get('page'), 'profile');
        assert.equal(await reduced.page.locator('.nav-click-ripple').count(), 0);
        assert.equal(await reduced.page.locator('.content-shell').evaluate(main => getComputedStyle(main).animationName), 'none');
        await reduced.context.close();
        console.log('PASS Reduced-motion preference preserves instant navigation');

        const older = await client(baseURL, roles[0], 1440, 'light');
        await older.context.addInitScript(() => { delete window.CSSViewTransitionRule; });
        await older.page.reload();
        await navigate(older.page, `${baseURL}index.php?page=profile`, false);
        await older.context.close();
        const blocked = await client(baseURL, roles[0], 390, 'dark');
        await blocked.context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
        await blocked.page.reload();
        await blocked.page.getByRole('button', { name: 'Buka menu', exact: true }).click();
        await Promise.all([
            blocked.page.waitForURL(url => url.searchParams.get('page') === 'profile'),
            blocked.page.locator('.nav-menu a[href="index.php?page=profile"]').click(),
        ]);
        assert.equal(new URL(blocked.page.url()).searchParams.get('page'), 'profile');
        assert.equal(await blocked.page.locator('.content-shell').getAttribute('aria-busy'), null);
        await blocked.context.close();
        assert.deepEqual(errors, []);
        console.log('PASS ' + navigations + ' immediate sidebar navigations. No JavaScript errors. Screenshots: ' + output);
    } catch (error) {
        console.error(error.stack);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(performanceResults, null, 2));
        if (browser) await browser.close();
        if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
        if (created) cli('drop');
        if (before) assert.deepEqual(cli('fingerprint', process.env), before, 'Application core data changed');
        console.log(`Application data unchanged. Artifacts: ${output}`);
    }
})();
