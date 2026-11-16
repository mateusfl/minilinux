import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

// Sem StrictMode: o efeito duplo dele tentaria criar um segundo kernel.
createRoot(document.getElementById("root")!).render(<App />);
