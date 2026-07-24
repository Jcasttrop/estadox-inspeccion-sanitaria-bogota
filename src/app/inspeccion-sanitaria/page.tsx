import RiesgoMapWrapper from "@/components/inspeccion/RiesgoMapWrapper";

export const metadata = {
  title: { absolute: "Inspección Sanitaria Inteligente | Bogotá" },
  description:
    "Priorización de inspección sanitaria basada en riesgo para los establecimientos vigilados de Bogotá.",
};

export default function InspeccionSanitariaPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Encabezado */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">🩺</span>
          <h1 className="text-2xl font-bold text-gray-900">
            Inspección Sanitaria Inteligente — Bogotá
          </h1>
        </div>
        <p className="text-gray-500 text-sm max-w-3xl">
          De un modelo reactivo y aleatorio a uno{" "}
          <strong className="text-gray-700">predictivo y focalizado</strong>.
          Cada establecimiento recibe un puntaje de riesgo dinámico y auditable
          para que el inspector visite primero donde el riesgo es mayor.
        </p>
      </div>

      {/* Mapa de riesgo */}
      <RiesgoMapWrapper />
    </div>
  );
}
