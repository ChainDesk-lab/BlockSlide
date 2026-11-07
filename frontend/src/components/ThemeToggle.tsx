import { useEffect, useState } from "react";
import { getDeviceStorage, setDeviceStorage } from "../lib/unifiedStorage";
import { MoonIcon, SunIcon } from "./icons";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize theme from device-level storage or system preference
  useEffect(() => {
    const storedTheme = getDeviceStorage("theme");

    if (storedTheme) {
      // User has manually set a preference (persists across wallet switches)
      const isDarkMode = storedTheme === "dark";
      setIsDark(isDarkMode);
      applyTheme(isDarkMode);
    } else {
      // Check system preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDark(prefersDark);
      if (prefersDark) {
        applyTheme(true);
      }
    }
    setIsMounted(true);
  }, []);

  const applyTheme = (dark: boolean) => {
    if (dark) {
      document.documentElement.classList.add("dark-mode");
      document.documentElement.classList.remove("light-mode");
    } else {
      document.documentElement.classList.add("light-mode");
      document.documentElement.classList.remove("dark-mode");
    }
  };

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    applyTheme(newIsDark);
    setDeviceStorage("theme", newIsDark ? "dark" : "light");
  };

  // Until mounted the theme isn't known (it lives in device storage), so render an inert
  // placeholder of the same size: no hydration mismatch, and the header doesn't shift when it appears.
  if (!isMounted) return <span className="theme-toggle theme-toggle--placeholder" aria-hidden="true" />;

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
