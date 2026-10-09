(function () {
    'use strict';

    const key = 'etransit-theme';
    const root = document.documentElement;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const validTheme = (value) => value === 'light' || value === 'dark';
    let preference = null;

    function readPreference() {
        try {
            const saved = window.localStorage.getItem(key);
            preference = validTheme(saved) ? saved : null;
        } catch (_) {
            // The toggle still works when the browser blocks local storage.
        }
    }

    function syncControls() {
        const dark = root.dataset.theme === 'dark';
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.setAttribute('aria-checked', String(dark));
            button.title = dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
            const label = button.querySelector('[data-theme-label]');
            if (label) label.textContent = dark ? 'Gelap' : 'Terang';
        });
    }

    function applyTheme() {
        root.dataset.theme = preference || (systemTheme.matches ? 'dark' : 'light');
        syncControls();
    }

    // Runs in the head before styles and the first paint, avoiding a light flash.
    readPreference();
    applyTheme();

    document.addEventListener('DOMContentLoaded', syncControls, { once: true });
    document.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-theme-toggle]') : null;
        if (!button) return;
        preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
            window.localStorage.setItem(key, preference);
        } catch (_) {
            // Keep the current choice in memory for this page.
        }
        applyTheme();
    });

    systemTheme.addEventListener('change', () => {
        if (!preference) applyTheme();
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== key && event.key !== null) return;
        readPreference();
        applyTheme();
    });

    window.addEventListener('pageshow', () => {
        readPreference();
        applyTheme();
    });
}());
