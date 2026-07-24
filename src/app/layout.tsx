import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Inspección Sanitaria Inteligente",
    template: "%s | Inspección Sanitaria",
  },
  description:
    "Priorización de inspección sanitaria basada en riesgo: de un modelo reactivo y aleatorio a uno predictivo, focalizado y auditable.",
  keywords: [
    "inspección sanitaria",
    "riesgo",
    "salud pública",
    "priorización",
    "EstadoX",
    "Pereira",
    "Bogotá",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-white antialiased">{children}</body>
    </html>
  );
}
