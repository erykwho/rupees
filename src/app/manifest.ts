import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rupees — Controle de Investimentos",
    short_name: "Rupees",
    description:
      "Controle pessoal de investimentos (B3, EUA, Renda Fixa) com plano de aportes automático.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#059669",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
