import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/jetbrains-mono";
import "./components/reader.css";
import "./components/dialogs.css";
import App from "./App";
import { ToastProvider } from "./store";

document.documentElement.dataset.os =
  /Mac|iPhone|iPad/.test(navigator.platform || "") ||
  /Macintosh|Mac OS X/.test(navigator.userAgent || "")
    ? "mac"
    : "other";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
