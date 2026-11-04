/**
 * Applies the saved theme before first paint, so a refresh never flashes the
 * other theme while React loads. Same rule as ThemeToggle: the saved choice
 * (device storage key "theme"), else the system preference.
 */
export const THEME_STORAGE_KEY = "bs_device_theme";

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;c.add(d?"dark-mode":"light-mode");c.remove(d?"light-mode":"dark-mode");}catch(e){}})();`;
