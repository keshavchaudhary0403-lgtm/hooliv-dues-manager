import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installApiAdapter } from "./lib/apiAdapter";

// Route all /api/* calls to Supabase before the app makes any request.
installApiAdapter();

createRoot(document.getElementById("root")!).render(<App />);
