"use client";

import { useState } from "react";
import { PhotoUpload } from "@/components/report/PhotoUpload";
import { type Establecimiento, NIVEL_CONFIG } from "@/data/inspeccion";
import {
  Eye,
  MapPin,
  Send,
  X,
  Sparkles,
  CheckCircle2,
  LocateFixed,
} from "lucide-react";

interface Props {
  establecimiento: Establecimiento;
  // Distancia (km) desde la ubicación del ciudadano, si llegó por geolocalización.
  distanciaKm?: number | null;
  onEnviar: (comentario: string, fotoUrl: string) => void;
  onCancelar: () => void;
}

// Formatea la distancia: metros si es < 1 km, si no en km con un decimal.
function formatoDistancia(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Ejemplos rápidos para que el ciudadano reporte de un toque (como en /reportar).
const SUGERENCIAS = [
  "Vi una rata / plaga",
  "Mal olor / basura acumulada",
  "Alimentos en mal estado",
  "Personal sin guantes ni tapabocas",
  "Baño o cocina en malas condiciones",
];

export default function ReporteCiudadano({
  establecimiento,
  distanciaKm,
  onEnviar,
  onCancelar,
}: Props) {
  const [comentario, setComentario] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const cfg = NIVEL_CONFIG[establecimiento.nivel_riesgo];
  const puedeEnviar = comentario.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide flex items-center gap-1">
            <Eye size={13} /> Reporte ciudadano
          </p>
          <h3 className="text-lg font-bold text-gray-900 leading-tight">
            {establecimiento.nombre}
          </h3>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <MapPin size={12} /> {establecimiento.localidad} ·{" "}
            {establecimiento.categoria}
          </p>
        </div>
        <button
          onClick={onCancelar}
          className="text-gray-400 hover:text-gray-700 transition-colors shrink-0"
          aria-label="Cancelar reporte"
        >
          <X size={18} />
        </button>
      </div>

      {typeof distanciaKm === "number" && (
        <div className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-blue-700 bg-blue-100 rounded-full px-2.5 py-1">
          <LocateFixed size={12} />
          Establecimiento más cercano · a {formatoDistancia(distanciaKm)} de ti
        </div>
      )}

      <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
        <p className="text-xs text-blue-800 leading-relaxed">
          ¿Notaste algo en este lugar? Tu reporte suma al puntaje de riesgo del
          establecimiento y alimenta la vigilancia de brotes en tiempo real.
        </p>
      </div>

      {/* Foto (opcional) */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Foto (opcional)
        </p>
        <PhotoUpload onPhotoUploaded={setFotoUrl} />
      </div>

      {/* Comentario */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          ¿Qué viste?
        </p>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={3}
          placeholder="Ej.: se me apareció una rata cerca de la cocina…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              onClick={() => setComentario(s)}
              className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-indigo-600 flex items-start gap-1">
        <Sparkles size={12} className="mt-0.5 shrink-0" />
        En producción, la IA valida la foto y clasifica el comentario (¿es una
        queja sanitaria real?) para descartar reportes falsos antes de sumar al
        score.
      </p>

      <button
        onClick={() => puedeEnviar && onEnviar(comentario.trim(), fotoUrl)}
        disabled={!puedeEnviar}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Send size={15} /> Enviar reporte
      </button>

      <p className="text-[11px] text-gray-400 flex items-center gap-1">
        <CheckCircle2 size={12} style={{ color: cfg.color }} /> Score actual:{" "}
        {Math.round(establecimiento.score)} · Riesgo {cfg.label}
      </p>
    </div>
  );
}
