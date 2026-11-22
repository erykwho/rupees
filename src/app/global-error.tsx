"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[rupees] Erro global não tratado:", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#f6f7f9",
          color: "#0f172a",
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "380px",
            borderRadius: "16px",
            backgroundColor: "#ffffff",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            Algo deu errado
          </h1>
          <p
            style={{
              marginTop: "8px",
              marginBottom: "20px",
              fontSize: "14px",
              lineHeight: 1.5,
              color: "#64748b",
            }}
          >
            Ocorreu um erro inesperado no aplicativo. Seus dados continuam
            seguros — tente novamente ou recarregue a página.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "44px",
                borderRadius: "12px",
                border: "1px solid rgba(15, 23, 42, 0.12)",
                backgroundColor: "#f8fafc",
                color: "#334155",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Recarregar app
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: "44px",
                borderRadius: "12px",
                border: "none",
                backgroundColor: "#059669",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
