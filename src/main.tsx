import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
