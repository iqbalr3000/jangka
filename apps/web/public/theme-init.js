// Apply the saved theme before first paint (key matches src/lib/theme.ts).
try {
  const theme = localStorage.getItem("jangka.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (_) {}
