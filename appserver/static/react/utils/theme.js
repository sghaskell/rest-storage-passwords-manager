/**
 * theme.js — Shared dark theme detection utility
 */

function isDarkTheme() {
    return document.documentElement.classList.contains('dark-theme') ||
        document.documentElement.classList.contains('theme-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        (document.body && document.body.classList.contains('dark-theme'));
}

module.exports = { isDarkTheme };
