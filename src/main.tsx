import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import HostedApp from "./components/HostedApp.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {import.meta.env.MODE === "hosted" ? <HostedApp /> : <App />}
  </StrictMode>,
);
