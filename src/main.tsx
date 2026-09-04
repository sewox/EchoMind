import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MeetingIslandWindow } from "./components/MeetingIslandWindow";
import "./index.css";
import { I18nProvider } from "./locales/i18nContext";

const isIslandView =
  typeof window !== "undefined" &&
  window.location.search.includes("view=island");

if (isIslandView && typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "transparent";
  document.body.className = "bg-transparent text-slate-100 antialiased h-screen w-screen overflow-hidden select-none";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isIslandView ? (
      <MeetingIslandWindow />
    ) : (
      <I18nProvider>
        <App />
      </I18nProvider>
    )}
  </React.StrictMode>,
);
