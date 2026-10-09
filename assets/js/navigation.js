(function () {
    'use strict';

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const recordKey = 'etransit-sidebar-navigation';
    let menu, indicator, pendingLink, pressAnimation, recoveryTimer, resizeFrame;

    function readArrival() {
        try {
            const value = window.sessionStorage.getItem(recordKey);
            window.sessionStorage.removeItem(recordKey);
            const record = value ? JSON.parse(value) : null;
            if (record && record.href === window.location.href && Date.now() - record.at < 8000) return record;
        } catch (_) { /* Menu feedback also works when storage is disabled. */ }
        return null;
    }

    function alignIndicator(link = menu?.querySelector('[aria-current="page"]')) {
        if (!indicator || !link) return;
        const height = link.offsetHeight + 'px';
        const position = 'translateY(' + link.offsetTop + 'px)';
        if (indicator.style.height !== height) indicator.style.height = height;
        if (indicator.style.transform !== position) indicator.style.transform = position;
    }

    function animateIcon(link) {
        pressAnimation?.cancel();
        const icon = link?.querySelector('.nav-icon');
        if (!icon || motion.matches || !icon.animate) return;
        // Restart the small icon effect without forcing a page layout on click.
        pressAnimation = icon.animate([
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(-1px) scale(1.1)', offset: 0.4 },
            { transform: 'translateY(0) scale(1)' },
        ], { duration: 180, easing: 'ease-out' });
    }

    function resetNavigation() {
        window.clearTimeout(recoveryTimer);
        pressAnimation?.cancel();
        menu?.classList.remove('nav-moving');
        menu?.querySelectorAll('.nav-pending').forEach(link => link.classList.remove('nav-pending'));
        menu?.querySelectorAll('.nav-click-ripple').forEach(ripple => ripple.remove());
        pendingLink = null;
        alignIndicator();
    }

    function pressEffect(link, event) {
        const rect = link.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height);
        ripple.className = 'nav-click-ripple';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = ((event.detail ? event.clientX - rect.left : rect.width / 2) - size / 2) + 'px';
        ripple.style.top = ((event.detail ? event.clientY - rect.top : rect.height / 2) - size / 2) + 'px';
        link.append(ripple);
        animateIcon(link);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    }

    function initializeMenu() {
        menu = document.querySelector('.nav-menu');
        if (!menu) return;
        indicator = document.createElement('span');
        indicator.className = 'nav-active-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        alignIndicator();
        menu.prepend(indicator);
        menu.classList.add('nav-motion-ready');
        if ('ResizeObserver' in window) {
            new ResizeObserver(() => {
                window.cancelAnimationFrame(resizeFrame);
                resizeFrame = window.requestAnimationFrame(() => alignIndicator(pendingLink || undefined));
            }).observe(menu);
        }
        const arrival = readArrival();
        if (arrival && !motion.matches && window.matchMedia('(min-width: 821px)').matches) {
            animateIcon(menu.querySelector('[aria-current="page"]'));
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeMenu, { once: true });
    else initializeMenu();

    document.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest('.nav-menu a') : null;
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || motion.matches) return;
        if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin || destination.pathname !== new URL('index.php', window.location.href).pathname) return;

        resetNavigation();
        pressEffect(link, event);
        if (destination.href === window.location.href) {
            event.preventDefault();
            return;
        }
        pendingLink = link;
        menu?.classList.add('nav-moving');
        alignIndicator(link);
        link.classList.add('nav-pending');
        try {
            window.sessionStorage.setItem(recordKey, JSON.stringify({ href: destination.href, at: Date.now() }));
        } catch (_) { /* Normal link navigation does not depend on storage. */ }

        // Let the browser follow the link immediately. Only sidebar elements
        // animate, so page content and form controls remain fully interactive.
        recoveryTimer = window.setTimeout(resetNavigation, 1200);
    });

    window.addEventListener('pageshow', event => { if (event.persisted) resetNavigation(); });
    document.addEventListener('submit', resetNavigation);
    motion.addEventListener('change', resetNavigation);
}());
