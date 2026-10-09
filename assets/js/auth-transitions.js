(function () {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const nativeTransitions = 'CSSViewTransitionRule' in window && 'onpagereveal' in window;
    let navigating = false;
    let submitTransitionStyle;

    // These listeners run before the first paint, so native snapshots do not capture the entry animation.
    window.addEventListener('pagereveal', (event) => {
        if (event.viewTransition) {
            // The next document can opt out of page snapshots for performance.
            event.viewTransition.ready.catch(() => {});
            root.classList.add('auth-transition-native');
        }
    });

    window.addEventListener('pageswap', (event) => {
        if (event.viewTransition) {
            event.viewTransition.ready.catch(() => {});
            root.classList.add('auth-transition-native');
        }
    });

    window.addEventListener('pageshow', (event) => {
        submitTransitionStyle?.remove();
        submitTransitionStyle = null;
        navigating = false;
        root.classList.remove('auth-transition-leaving');
        document.querySelector('.auth-shell')?.removeAttribute('aria-busy');
        if (event.persisted) root.classList.add('auth-transition-native');
    });

    document.addEventListener('submit', () => {
        if (!nativeTransitions || reducedMotion.matches) return;
        // Authentication POSTs can redirect into the app, whose pages opt out
        // of snapshots. Opt out before submitting as well to keep that handoff
        // immediate and avoid a rejected cross-document transition.
        submitTransitionStyle = document.createElement('style');
        submitTransitionStyle.textContent = '@view-transition { navigation: none; }';
        document.head.append(submitTransitionStyle);
    });

    document.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[data-auth-link]') : null;
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin || !['login', 'register'].includes(destination.searchParams.get('page'))) return;
        if (nativeTransitions || reducedMotion.matches) return;

        event.preventDefault();
        if (navigating) return;
        navigating = true;
        root.classList.add('auth-transition-leaving');
        document.querySelector('.auth-shell')?.setAttribute('aria-busy', 'true');

        // Keep navigation independent of animation events, including when an animation is cancelled.
        window.setTimeout(() => window.location.assign(destination.href), 200);
    });
}());
