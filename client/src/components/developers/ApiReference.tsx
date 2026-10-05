import { useEffect } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import type { AnyApiReferenceConfiguration } from "@scalar/api-reference-react";
import scalarCss from "@scalar/api-reference-react/style.css?inline";
import { API_BASE } from "../../lib/api";

// The interactive Scalar reference. It bundles several MB, so DevelopersPage
// loads it as its own lazy chunk and keeps the page's own content out of it,
// letting the prerenderer capture the page before this chunk has arrived.

// Scalar fetches the OpenAPI spec from API_BASE, which resolves to VITE_API_URL.
// In local dev this points to the remote server, so spec changes require deployment
// to be visible here. To test locally: temporarily clear VITE_API_URL in client/.env
// and restart the Vite dev server (the Vite proxy will forward /api to localhost:3001).
const scalarConfig: AnyApiReferenceConfiguration = {
  url: `${API_BASE}/docs/openapi.json`,
  theme: "laserwave",
  layout: "modern",
  defaultOpenAllTags: true,
  hideSearch: true,
  showSidebar: true,
  hideDarkModeToggle: false,
  hideDownloadButton: false,
  hideModels: false,
  withDefaultFonts: true,
  defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
};

export default function ApiReference() {
  // Inject Scalar CSS only while the reference is mounted, then remove it
  // to prevent style leaks (diagonal dashes, layout issues) on other pages
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "scalar-styles";
    style.textContent = scalarCss;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return <ApiReferenceReact configuration={scalarConfig} />;
}
