(() => {
    const storageKey = 'oceandonate_theme';
    const validTheme = value => value === 'light' ? 'light' : 'dark';
    const readTheme = () => {
        try { return validTheme(localStorage.getItem(storageKey)); }
        catch { return 'dark'; }
    };

    const applyTheme = theme => {
        const selected = validTheme(theme);
        const root = document.documentElement;
        const languageLabel = document.getElementById('langText')?.textContent || root.lang || 'th';
        const isEnglish = /\bEN\b/i.test(languageLabel);
        root.dataset.theme = selected;
        root.style.colorScheme = selected;
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            const isLight = selected === 'light';
            button.setAttribute('aria-pressed', String(isLight));
            button.setAttribute('aria-label', isEnglish ? (isLight ? 'Switch to Dark theme' : 'Switch to Light theme') : (isLight ? 'สลับเป็นธีมมืด' : 'สลับเป็นธีมสว่าง'));
            const icon = button.querySelector('[data-theme-icon]');
            if (icon) icon.className = `fas ${isLight ? 'fa-sun' : 'fa-moon'}`;
            const label = button.querySelector('.theme-toggle-label');
            if (label) label.textContent = isEnglish ? (isLight ? 'Light' : 'Dark') : (isLight ? 'สว่าง' : 'มืด');
        });
        return selected;
    };

    // Set the attribute synchronously in the head so stylesheets never flash the wrong theme.
    applyTheme(readTheme());

    const bindControls = () => {
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            if (button.dataset.themeBound === 'true') return;
            button.dataset.themeBound = 'true';
            button.addEventListener('click', () => {
                const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
                try { localStorage.setItem(storageKey, nextTheme); } catch { /* Theme still changes for this page. */ }
                applyTheme(nextTheme);
            });
        });
        applyTheme(readTheme());
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, { once: true });
    else bindControls();
})();
