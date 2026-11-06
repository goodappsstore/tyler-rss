// Apply the saved theme before the loading screen paints, without waiting for React.
try {
  const saved = localStorage.getItem("tyler-theme");
  document.documentElement.dataset.theme =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
