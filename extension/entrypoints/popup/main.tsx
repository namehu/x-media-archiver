import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "../../src/popup/Popup";
import "../../src/popup/popup.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
