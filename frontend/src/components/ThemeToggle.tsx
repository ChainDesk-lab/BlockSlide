import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const storedTheme = localStorage.getItem("blockslide-theme");

    if (storedTheme) {
      // User has manually set a preference
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
    } else {
      document.documentElement.classList.remove("dark-mode");
    }
  };

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    applyTheme(newIsDark);
    localStorage.setItem("blockslide-theme", newIsDark ? "dark" : "light");
  };

  // Don't render until mounted to prevent hydration mismatch
  if (!isMounted) return null;

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? "🌙" : "☀️"}
    </button>
  );
}
