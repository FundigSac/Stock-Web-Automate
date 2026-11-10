import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-500.css";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/archivo/latin-700.css";
import "@fontsource/fraunces/latin-600.css";
import "@fontsource/fraunces/latin-700.css";
import App from "./App";
import { LimiteError } from "./components/LimiteError";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LimiteError>
      <App />
    </LimiteError>
  </StrictMode>,
);
