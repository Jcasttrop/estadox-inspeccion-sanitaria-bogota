"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import { Spinner } from "@/components/ui/Spinner";
import {
  type Establecimiento,
  type NivelRiesgo,
  NIVEL_CONFIG,
  NIVELES_ORDEN,
  FACTOR_LABEL,
  FACTOR_MAX,
  FUENTE_INSPECCION,
} from "@/data/inspeccion";
import {
  generarAgenda,
  haversineKm,
  type Agenda,
  UMBRAL_PRESENCIA_DIAS,
} from "@/lib/agenda";
import {
  generarCasos,
  detectarClusters,
  type Cluster,
  type FuenteCaso,
  type CasoEpidemiologico,
  FUENTES_CASO,
  FUENTE_CASO_CONFIG,
  VENTANA_HORAS,
  RADIO_CLUSTER_KM,
  MIN_CASOS,
} from "@/lib/brotes";
import {
  recalcularConFactor,
  INCREMENTO_QUEJA_CIUDADANA,
  MODULOS,
  modulosAplicables,
  tipoDesdeCategoria,
} from "@/lib/autorreporte";
import {
  evaluarVisita,
  estadoInicialVisita,
  type EstadoModulo,
  type ResultadoVisita,
} from "@/lib/visita";
import EncuestaAutovigilancia from "@/components/inspeccion/EncuestaAutovigilancia";
import ReporteCiudadano from "@/components/inspeccion/ReporteCiudadano";
import Backtest from "@/components/inspeccion/Backtest";
import {
  AlertTriangle,
  MapPin,
  ShieldCheck,
  Baby,
  MessageSquareWarning,
  CalendarClock,
  Route,
  Clock,
  Navigation,
  X,
  Flag,
  Activity,
  ShieldAlert,
  Crosshair,
  Eye,
  ClipboardCheck,
  CheckCircle2,
  LocateFixed,
  ArrowLeft,
  Check,
  FlaskConical,
  Info,
  Flame,
} from "lucide-react";

const BOGOTA_CENTER: [number, number] = [4.63, -74.09];
const ZOOM = 12;

function RecenterButton() {
  const map = useMap();
  return (
    <button
      onClick={() => map.setView(BOGOTA_CENTER, ZOOM)}
      className="absolute top-4 right-4 z-[1000] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-50 transition-colors"
    >
      Centrar mapa
    </button>
  );
}

// Ícono numerado para las paradas de la ruta del inspector.
function iconoParada(numero: number, color: string) {
  return new L.DivIcon({
    html: `<div style="
      background-color:${color};
      color:#fff;
      border:2px solid #fff;
      border-radius:50%;
      width:24px;height:24px;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:800;
      box-shadow:0 1px 6px rgba(0,0,0,0.5);
    ">${numero}</div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

// Ícono de la base del inspector (punto de partida de la jornada).
const iconoBase = new L.DivIcon({
  html: `<div style="
    background:#111827;color:#fff;border:2px solid #fff;border-radius:6px;
    width:26px;height:26px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 6px rgba(0,0,0,0.5);
  "><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/></svg></div>`,
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// Ajusta la vista del mapa para encuadrar la ruta cuando se genera la agenda.
function AjustarAAgenda({ agenda }: { agenda: Agenda | null }) {
  const map = useMap();
  useEffect(() => {
    if (!agenda || agenda.paradas.length === 0) return;
    const puntos: [number, number][] = [
      [agenda.base.lat, agenda.base.lon],
      ...agenda.paradas.map(
        (p) =>
          [p.establecimiento.lat, p.establecimiento.lon] as [number, number]
      ),
    ];
    map.fitBounds(L.latLngBounds(puntos), { padding: [50, 50] });
  }, [agenda, map]);
  return null;
}

// Ícono de la fuente probable de un brote (establecimiento sospechoso).
const iconoFuenteProbable = new L.DivIcon({
  html: `<div style="
    background:#dc2626;color:#fff;border:2px solid #fff;border-radius:50% 50% 50% 0;
    width:26px;height:26px;transform:rotate(-45deg);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 6px rgba(0,0,0,0.5);
  "><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(45deg)"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>`,
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
  popupAnchor: [0, -24],
});

// Ajusta la vista del mapa para encuadrar un cluster de brote seleccionado.
function AjustarACluster({ cluster }: { cluster: Cluster | null }) {
  const map = useMap();
  // Marca si ya encuadramos algún foco: así, al deseleccionar, volvemos a la
  // vista general en vez de dejar al usuario atrapado en el zoom del foco.
  const encuadrado = useMemo(() => ({ activo: false }), []);
  useEffect(() => {
    if (!cluster) {
      if (encuadrado.activo) {
        map.setView(BOGOTA_CENTER, ZOOM);
        encuadrado.activo = false;
      }
      return;
    }
    encuadrado.activo = true;
    const puntos: [number, number][] = cluster.casos.map(
      (c) => [c.lat, c.lon] as [number, number]
    );
    if (cluster.fuenteProbable) {
      puntos.push([cluster.fuenteProbable.lat, cluster.fuenteProbable.lon]);
    }
    map.fitBounds(L.latLngBounds(puntos), { padding: [80, 80], maxZoom: 16 });
  }, [cluster, map, encuadrado]);
  return null;
}

// Capa de mapa de calor del riesgo: cada establecimiento aporta intensidad
// proporcional a su score, revelando de un vistazo dónde se concentra el riesgo
// en la ciudad (más útil que puntos sueltos cuando hay miles de vigilados).
function CapaCalor({ puntos }: { puntos: Establecimiento[] }) {
  const map = useMap();
  useEffect(() => {
    const heatPoints: [number, number, number][] = puntos.map((e) => [
      e.lat,
      e.lon,
      // Piso de 0.05 para que hasta el riesgo bajo aporte algo de señal.
      Math.max(e.score / 100, 0.05),
    ]);
    const layer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 18,
      maxZoom: 15,
      minOpacity: 0.25,
      // Mismo lenguaje cromático que los niveles: verde → amarillo → rojo.
      gradient: {
        0.2: "#16a34a",
        0.5: "#f59e0b",
        0.75: "#f97316",
        1.0: "#dc2626",
      },
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [puntos, map]);
  return null;
}

// Centra el mapa en un punto (usado al ubicar el establecimiento más cercano
// al ciudadano por geolocalización).
function CentrarEn({ punto }: { punto: { lat: number; lon: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (punto) map.setView([punto.lat, punto.lon], 16);
  }, [punto, map]);
  return null;
}

// Cómo se califica cada factor del score (0–100). Texto pensado para que un
// ciudadano o inspector entienda la escala sin leer el código: cada entrada
// describe el criterio y los tramos de puntaje reales del modelo.
const FACTOR_AYUDA: Record<
  keyof typeof FACTOR_LABEL,
  { resumen: string; tramos: { etiqueta: string; pts: string }[] }
> = {
  tipo_establecimiento: {
    resumen:
      "Riesgo inherente a la actividad: qué tan sensible es a un problema sanitario. No depende del historial, solo del giro del negocio.",
    tramos: [
      { etiqueta: "Clínica / laboratorio · Jardín infantil", pts: "30" },
      { etiqueta: "Consultorio médico / odontológico", pts: "26.7" },
      { etiqueta: "Carnicería", pts: "23.3" },
      { etiqueta: "Restaurante · Comida rápida", pts: "20" },
      { etiqueta: "Droguería · Panadería · Supermercado", pts: "16.7" },
      { etiqueta: "Bar · Café · Fruver", pts: "13.3" },
      { etiqueta: "Gimnasio · Tienda de barrio", pts: "10" },
      { etiqueta: "Peluquería", pts: "6.7" },
      { etiqueta: "Café internet", pts: "3.3" },
    ],
  },
  antiguedad_concepto: {
    resumen:
      "Tiempo desde el último concepto sanitario. Crece de forma gradual (≈ días ÷ 90) y llega al tope a los ~5 años. El concepto se considera vencido pasado 1 año.",
    tramos: [
      { etiqueta: "Recién emitido (< 1 mes)", pts: "≈ 0" },
      { etiqueta: "1 año (límite de vigencia)", pts: "≈ 4" },
      { etiqueta: "2 años", pts: "≈ 8" },
      { etiqueta: "3 años", pts: "≈ 12" },
      { etiqueta: "5 años o más", pts: "20 (tope)" },
    ],
  },
  tiempo_sin_visita: {
    resumen:
      "Días desde la última visita de inspección. Crece de forma gradual (≈ días ÷ 100) y llega al tope a los ~4 años. Un establecimiento nunca visitado parte del máximo.",
    tramos: [
      { etiqueta: "Nunca visitado", pts: "15 (tope)" },
      { etiqueta: "~1 año sin visita", pts: "≈ 3.7" },
      { etiqueta: "~2 años sin visita", pts: "≈ 7" },
      { etiqueta: "~4 años sin visita", pts: "15 (tope)" },
    ],
  },
  resultado_anterior: {
    resumen:
      "Resultado de la visita previa (o del autorreporte de autovigilancia, si lo diligenció). A peor resultado, más puntaje.",
    tramos: [
      { etiqueta: "Favorable", pts: "0" },
      { etiqueta: "Sin visita previa (no se sabe)", pts: "8" },
      { etiqueta: "Favorable con requerimientos", pts: "7" },
      { etiqueta: "Desfavorable", pts: "15 (tope)" },
    ],
  },
  quejas_ciudadanas: {
    resumen:
      "Quejas ciudadanas de los últimos 12 meses. Cada queja suma 2 puntos, hasta un tope de 12 (6 quejas o más).",
    tramos: [
      { etiqueta: "Sin quejas", pts: "0" },
      { etiqueta: "Por cada queja (12 meses)", pts: "+2" },
      { etiqueta: "6 quejas o más", pts: "12 (tope)" },
    ],
  },
  poblacion_vulnerable: {
    resumen:
      "Si el establecimiento atiende a población vulnerable (niñez, adultos mayores, personas enfermas), un problema sanitario tiene mayor impacto.",
    tramos: [
      { etiqueta: "Atiende población vulnerable", pts: "8 (tope)" },
      { etiqueta: "No atiende población vulnerable", pts: "0" },
    ],
  },
};

// Tooltip accesible (hover + foco por teclado) que explica cómo se califica un
// factor. Se muestra al pasar el mouse o al enfocar el icono con Tab.
function FactorTooltip({ factor }: { factor: keyof typeof FACTOR_LABEL }) {
  const ayuda = FACTOR_AYUDA[factor];
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        aria-label={`Cómo se califica: ${FACTOR_LABEL[factor]}`}
        className="text-gray-400 hover:text-gray-600 focus:text-gray-600 focus:outline-none cursor-help"
      >
        <Info size={12} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 bottom-full z-[9999] mb-1.5 w-60 rounded-lg bg-gray-900 p-2.5 text-left text-[11px] leading-snug text-gray-100 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block font-semibold text-white mb-1">
          {FACTOR_LABEL[factor]}
          <span className="text-gray-400 font-normal">
            {" "}
            · 0–{FACTOR_MAX[factor]} pts
          </span>
        </span>
        <span className="block text-gray-300 mb-1.5">{ayuda.resumen}</span>
        <span className="block space-y-0.5">
          {ayuda.tramos.map((t, i) => (
            <span key={i} className="flex justify-between gap-2">
              <span className="text-gray-300">{t.etiqueta}</span>
              <span className="font-semibold text-white shrink-0">{t.pts}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

function nivelBadge(nivel: NivelRiesgo) {
  const cfg = NIVEL_CONFIG[nivel];
  return (
    <span
      className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full"
      style={{
        backgroundColor: `${cfg.color}22`,
        color: cfg.color,
        border: `1px solid ${cfg.color}55`,
      }}
    >
      Riesgo {cfg.label}
    </span>
  );
}

// Panel lateral: "¿por qué está arriba?" — el corazón de la demo.
function PanelDetalle({
  e,
  onDiligenciar,
}: {
  e: Establecimiento;
  onDiligenciar: () => void;
}) {
  const cfg = NIVEL_CONFIG[e.nivel_riesgo];
  const factores = Object.entries(e.desglose) as [
    keyof typeof FACTOR_LABEL,
    number
  ][];
  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-900 leading-tight">
            {e.nombre}
          </h3>
          <div
            className="flex flex-col items-center justify-center rounded-xl px-3 py-1.5 text-white shrink-0"
            style={{ backgroundColor: cfg.color }}
          >
            <span className="text-2xl font-black leading-none">
              {Math.round(e.score)}
            </span>
            <span className="text-[10px] uppercase tracking-wide opacity-90">
              score
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {nivelBadge(e.nivel_riesgo)}
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <MapPin size={12} /> {e.localidad}
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-1">{e.categoria}</p>
      </div>

      {/* Señales de alerta */}
      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          <AlertTriangle size={13} /> Por qué está priorizado
        </p>
        <ul className="space-y-1.5">
          {e.razones.map((r, i) => (
            <li
              key={i}
              className="text-sm text-gray-700 flex items-start gap-2"
            >
              <span
                className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: cfg.color }}
              />
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Desglose auditable del puntaje */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          <ShieldCheck size={13} /> Desglose del puntaje (auditable)
        </p>
        <div className="space-y-2">
          {factores.map(([k, v]) => {
            const max = FACTOR_MAX[k];
            const pct = max > 0 ? (v / max) * 100 : 0;
            return (
              <div key={k}>
                <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                  <span className="flex items-center gap-1">
                    {FACTOR_LABEL[k]}
                    <FactorTooltip factor={k} />
                  </span>
                  <span className="font-semibold text-gray-800">
                    {v.toFixed(1)}
                    <span className="text-gray-400"> / {max}</span>
                  </span>
                </div>
                <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: cfg.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ficha rápida */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex items-center gap-2">
          <MessageSquareWarning size={14} className="text-gray-400" />
          <span className="text-gray-600">
            {e.quejas_12m} queja(s) / 12m
          </span>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex items-center gap-2">
          <CalendarClock size={14} className="text-gray-400" />
          <span className="text-gray-600">
            {e.dias_ultima_visita === null
              ? "Nunca visitado"
              : `Últ. visita: ${Math.round(e.dias_ultima_visita / 30)} m`}
          </span>
        </div>
        {e.poblacion_vulnerable && (
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex items-center gap-2 col-span-2">
            <Baby size={14} className="text-gray-400" />
            <span className="text-gray-600">
              Atiende población vulnerable
            </span>
          </div>
        )}
      </div>

      {/* Autovigilancia asistida (Eje 3): el establecimiento se autoevalúa
          antes de la visita y su score se recalcula en vivo. */}
      <button
        onClick={onDiligenciar}
        className="w-full bg-pereira-red text-white rounded-lg py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        <ClipboardCheck size={16} /> Diligenciar autorreporte
      </button>
      <p className="-mt-2 text-[11px] text-gray-400 leading-relaxed">
        Encuesta de autovigilancia guiada (Eje 3): el establecimiento reporta su
        cumplimiento y el factor <em>resultado_anterior</em> del score se
        recalcula al instante.
      </p>
    </div>
  );
}

// Panel del itinerario del inspector (Eje 2).
function PanelAgenda({
  agenda,
  onCerrar,
  onSeleccionarParada,
  paradaActivaId,
  visitas,
  dia,
}: {
  agenda: Agenda;
  onCerrar: () => void;
  onSeleccionarParada: (e: Establecimiento) => void;
  paradaActivaId: number | null;
  visitas: Record<number, ResultadoVisita>;
  dia: number | null; // día de la rotación (1-based); null si es foco forzado
}) {
  const numVisitadas = agenda.paradas.filter(
    (p) => visitas[p.establecimiento.id]
  ).length;
  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-pereira-red uppercase tracking-wide flex items-center gap-1">
            <Route size={13} /> {dia !== null ? `Agenda · Día ${dia}` : "Agenda"}
          </p>
          <h3 className="text-lg font-bold text-gray-900 leading-tight">
            {agenda.localidadFoco}
          </h3>
        </div>
        <button
          onClick={onCerrar}
          className="text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Cerrar agenda"
        >
          <X size={18} />
        </button>
      </div>

      {/* Alerta de presencia institucional (restricción de UPZ) */}
      {agenda.superaUmbral && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">
            <strong>{agenda.diasSinPresencia} días</strong> sin presencia
            institucional en esta localidad (umbral: {UMBRAL_PRESENCIA_DIAS}{" "}
            días). Priorizada automáticamente.
          </p>
        </div>
      )}

      {/* Resumen del día */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
          <p className="text-lg font-black text-gray-900">
            {agenda.resumen.totalVisitas}
          </p>
          <p className="text-[10px] text-gray-500 uppercase">visitas</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
          <p className="text-lg font-black text-gray-900">
            {agenda.resumen.distanciaTotalKm} km
          </p>
          <p className="text-[10px] text-gray-500 uppercase">recorrido</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
          <p className="text-lg font-black text-gray-900">
            {agenda.resumen.horaInicio}–{agenda.resumen.horaFin}
          </p>
          <p className="text-[10px] text-gray-500 uppercase">jornada</p>
        </div>
      </div>

      {/* Almuerzo y visitas que no alcanzan en la jornada */}
      {(agenda.resumen.almuerzo || agenda.resumen.omitidas > 0) && (
        <div className="flex flex-col gap-2 -mt-1">
          {agenda.resumen.almuerzo && (
            <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
              <Clock size={12} className="text-gray-400" />
              Incluye almuerzo {agenda.resumen.almuerzo.inicio}–
              {agenda.resumen.almuerzo.fin}.
            </p>
          )}
          {agenda.resumen.omitidas > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                <strong>{agenda.resumen.omitidas}</strong>{" "}
                {agenda.resumen.omitidas === 1
                  ? "visita priorizada no alcanza"
                  : "visitas priorizadas no alcanzan"}{" "}
                en la jornada de hoy; quedan como primeras para mañana.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Itinerario */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Navigation size={13} />{" "}
            {agenda.rutaReal
              ? "Ruta óptima por calles reales"
              : "Ruta estimada (línea recta)"}
          </p>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              numVisitadas === agenda.paradas.length
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {numVisitadas}/{agenda.paradas.length} visitadas
          </span>
        </div>
        <ol className="relative border-l-2 border-gray-200 ml-3 space-y-3">
          {/* Base */}
          <li className="ml-4 flex items-center gap-2 -mt-1">
            <span className="absolute -left-[9px] w-4 h-4 rounded bg-gray-900" />
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Flag size={11} /> Base — {agenda.resumen.horaInicio}
            </span>
          </li>
          {agenda.paradas.map((p) => {
            const cfg = NIVEL_CONFIG[p.establecimiento.nivel_riesgo];
            const activa = paradaActivaId === p.establecimiento.id;
            const visita = visitas[p.establecimiento.id];
            return (
              <li key={p.establecimiento.id} className="ml-4">
                <span
                  className="absolute -left-[13px] w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black text-white border-2 border-white"
                  style={{
                    backgroundColor: visita ? "#16a34a" : cfg.color,
                  }}
                >
                  {visita ? <Check size={13} strokeWidth={3} /> : p.orden}
                </span>
                <button
                  onClick={() => onSeleccionarParada(p.establecimiento)}
                  className={`text-left w-full rounded-lg px-2 py-1.5 transition-colors ${
                    activa ? "bg-gray-100" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm font-semibold leading-tight ${
                        visita ? "text-gray-500" : "text-gray-800"
                      }`}
                    >
                      {p.establecimiento.nombre}
                    </span>
                    <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                      <Clock size={11} /> {p.horaLlegada}–{p.horaSalida}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {visita ? (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${visita.veredicto.color}22`,
                          color: visita.veredicto.color,
                        }}
                      >
                        {visita.gravedadReal.label}
                      </span>
                    ) : (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${cfg.color}22`,
                          color: cfg.color,
                        }}
                      >
                        {p.tipoVisita}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-500">
                      {p.establecimiento.categoria}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      · score {Math.round(p.establecimiento.score)} ·{" "}
                      {p.distanciaKm} km · {p.duracionMin} min
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-100 pt-2">
        {agenda.rutaReal ? (
          <>
            Orden y tiempos de viaje sobre la <strong>red vial real</strong>{" "}
            (OSRM). {agenda.resumen.inspecciones} inspecciones de alto riesgo con{" "}
            {agenda.resumen.verificaciones} verificaciones rápidas de paso. La
            permanencia en cada local se estima por factores (tipo de local,
            concepto vencido, quejas y población vulnerable).
          </>
        ) : (
          <>
            Sin conexión al motor de ruteo: viajes{" "}
            <strong>estimados en línea recta</strong>.{" "}
            {agenda.resumen.inspecciones} inspecciones de alto riesgo con{" "}
            {agenda.resumen.verificaciones} verificaciones rápidas. La
            permanencia en cada local se estima por factores del establecimiento.
          </>
        )}
      </p>
    </div>
  );
}

// Formulario del reporte de visita del inspector: checklist por módulo.
function FormularioVisita({
  e,
  inicial,
  onRegistrar,
}: {
  e: Establecimiento;
  inicial?: Record<string, EstadoModulo>;
  onRegistrar: (r: ResultadoVisita) => void;
}) {
  const tipo = tipoDesdeCategoria(e.categoria);
  const aplicables = modulosAplicables(tipo);
  const [estados, setEstados] = useState<Record<string, EstadoModulo>>(
    () => inicial ?? estadoInicialVisita(e)
  );

  const opciones: { v: EstadoModulo; label: string; color: string }[] = [
    { v: "conforme", label: "Conforme", color: "#16a34a" },
    { v: "hallazgo", label: "Hallazgo", color: "#dc2626" },
    { v: "no_aplica", label: "N/A", color: "#9ca3af" },
  ];
  const numHallazgos = aplicables.filter((k) => estados[k] === "hallazgo").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
        <ClipboardCheck size={13} /> Reporte de visita
      </p>
      <div className="flex flex-col gap-2">
        {aplicables.map((k) => (
          <div
            key={k}
            className="rounded-lg border border-gray-100 bg-gray-50 p-2"
          >
            <p className="text-xs font-semibold text-gray-700 mb-1.5">
              {MODULOS[k].label}
            </p>
            <div className="grid grid-cols-3 gap-1">
              {opciones.map((o) => {
                const sel = estados[k] === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() => setEstados((s) => ({ ...s, [k]: o.v }))}
                    className="text-[11px] font-medium rounded-md py-1 border transition-colors"
                    style={{
                      backgroundColor: sel ? o.color : "#fff",
                      color: sel ? "#fff" : "#6b7280",
                      borderColor: sel ? o.color : "#e5e7eb",
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => onRegistrar(evaluarVisita(e, estados))}
        className="w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        <Check size={16} /> Guardar visita ({numHallazgos}{" "}
        {numHallazgos === 1 ? "hallazgo" : "hallazgos"})
      </button>
    </div>
  );
}

// Tarjeta de comparación "predicho vs encontrado" tras registrar la visita.
function ComparacionCard({
  resultado,
  onEditar,
}: {
  resultado: ResultadoVisita;
  onEditar: () => void;
}) {
  const r = resultado;
  const predCfg = NIVEL_CONFIG[r.nivelPredicho];
  const acierto = r.veredicto.tipo === "acierto";
  return (
    <div className="flex flex-col gap-3">
      {/* Veredicto */}
      <div
        className="rounded-xl p-3 flex items-start gap-2"
        style={{
          backgroundColor: `${r.veredicto.color}12`,
          border: `1px solid ${r.veredicto.color}44`,
        }}
      >
        {acierto ? (
          <CheckCircle2
            size={16}
            style={{ color: r.veredicto.color }}
            className="mt-0.5 shrink-0"
          />
        ) : (
          <AlertTriangle
            size={16}
            style={{ color: r.veredicto.color }}
            className="mt-0.5 shrink-0"
          />
        )}
        <div>
          <p
            className="text-sm font-bold leading-tight"
            style={{ color: r.veredicto.color }}
          >
            {r.veredicto.label}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">{r.veredicto.detalle}</p>
        </div>
      </div>

      {/* Predicho vs Encontrado */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gray-100 p-2.5 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">
            Modelo predijo
          </p>
          <p
            className="text-sm font-black mt-1"
            style={{ color: predCfg.color }}
          >
            Riesgo {predCfg.label}
          </p>
          <p className="text-[11px] text-gray-400">score {r.scoreAntes}</p>
        </div>
        <div className="rounded-lg border border-gray-100 p-2.5 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">
            Inspector encontró
          </p>
          <p
            className="text-sm font-black mt-1"
            style={{ color: r.gravedadReal.color }}
          >
            {r.gravedadReal.label}
          </p>
          <p className="text-[11px] text-gray-400">
            score {r.scoreDespues}{" "}
            {r.scoreDespues !== r.scoreAntes && (
              <span
                style={{
                  color: r.scoreDespues > r.scoreAntes ? "#dc2626" : "#16a34a",
                }}
              >
                ({r.scoreDespues > r.scoreAntes ? "+" : ""}
                {r.scoreDespues - r.scoreAntes})
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Hallazgos */}
      {r.hallazgos.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Hallazgos ({r.hallazgos.length})
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {r.hallazgos.map((h) => (
              <li
                key={h.key}
                className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100"
              >
                {h.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-green-700 flex items-center gap-1">
          <CheckCircle2 size={12} /> Sin incumplimientos observados.
        </p>
      )}

      <button
        onClick={onEditar}
        className="w-full border border-gray-200 text-gray-600 rounded-lg py-2 text-xs font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
      >
        <ClipboardCheck size={14} /> Editar reporte de visita
      </button>
    </div>
  );
}

// Panel de una parada de la agenda: perfil del establecimiento + reporte de
// visita + comparación con lo predicho por el modelo.
function PanelVisita({
  e,
  resultado,
  onVolver,
  onRegistrar,
  onDiligenciar,
}: {
  e: Establecimiento;
  resultado: ResultadoVisita | undefined;
  onVolver: () => void;
  onRegistrar: (r: ResultadoVisita) => void;
  onDiligenciar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const mostrarForm = !resultado || editando;

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onVolver}
        className="text-xs text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1 self-start"
      >
        <ArrowLeft size={14} /> Volver a la agenda
      </button>

      {mostrarForm ? (
        <FormularioVisita
          key={e.id}
          e={e}
          inicial={resultado?.estados}
          onRegistrar={(r) => {
            onRegistrar(r);
            setEditando(false);
          }}
        />
      ) : (
        <ComparacionCard
          resultado={resultado!}
          onEditar={() => setEditando(true)}
        />
      )}

      {/* Perfil del establecimiento */}
      <div className="border-t border-gray-100 pt-4">
        <PanelDetalle e={e} onDiligenciar={onDiligenciar} />
      </div>
    </div>
  );
}

// Un paso de la secuencia explicativa 1→2→3 del modo "Alerta de brotes".
// Traduce el mapa (puntos, círculo, bandera) a una historia legible para
// cualquier persona, sin esconder el método del jurado técnico.
function PasoBrote({
  n,
  titulo,
  desc,
  children,
}: {
  n: number;
  titulo: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 min-w-[160px]">
      <span className="shrink-0 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-gray-900">{titulo}</p>
        <p className="text-[11px] text-gray-500">{desc}</p>
        {children}
      </div>
    </div>
  );
}

// Panel lateral del modo "Alerta de brotes" (Eje 4).
function PanelBrotes({
  clusters,
  clusterSel,
  onSeleccionar,
}: {
  clusters: Cluster[];
  clusterSel: Cluster | null;
  onSeleccionar: (c: Cluster | null) => void;
}) {
  if (clusters.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3">
        <ShieldCheck size={32} strokeWidth={1.5} />
        <p className="text-sm max-w-[200px]">
          Sin clusters activos en la ventana de {VENTANA_HORAS}h. La vigilancia
          cruza SIVIGILA, urgencias y quejas ciudadanas en tiempo real.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold text-red-600 uppercase tracking-wide flex items-center gap-1">
          <Activity size={13} /> Alerta epidemiológica
        </p>
        <h3 className="text-lg font-bold text-gray-900 leading-tight">
          {clusters.length} foco{clusters.length > 1 ? "s" : ""} de posible
          brote
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Concentración anómala de casos de enfermedad en las últimas{" "}
          {VENTANA_HORAS}h.
          <span className="text-gray-400">
            {" "}
            Método: radio {RADIO_CLUSTER_KM * 1000} m · mínimo {MIN_CASOS} casos.
          </span>
        </p>
        {clusterSel && (
          <button
            onClick={() => onSeleccionar(null)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 transition-colors"
          >
            <ArrowLeft size={13} /> Ver todos los focos
          </button>
        )}
      </div>

      <div className="space-y-3">
        {clusters.map((c) => {
          const activo = clusterSel?.id === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onSeleccionar(activo ? null : c)}
              className={`w-full text-left rounded-xl border p-3 transition-all ${
                activo
                  ? "border-red-300 bg-red-50 ring-2 ring-red-200"
                  : "border-gray-200 hover:border-red-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert size={15} className="text-red-500 shrink-0" />
                  <span className="text-sm font-bold text-gray-900">
                    Cluster #{c.id} · {c.localidad}
                  </span>
                </div>
                <span className="text-lg font-black text-red-600 leading-none">
                  {c.numCasos}
                  <span className="text-[10px] font-medium text-gray-400">
                    {" "}
                    casos
                  </span>
                </span>
              </div>

              {/* Desglose por fuente */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {FUENTES_CASO.filter((f) => c.porFuente[f] > 0).map((f) => {
                  const cfg = FUENTE_CASO_CONFIG[f];
                  return (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${cfg.color}15`,
                        color: cfg.color,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: cfg.color }}
                      />
                      {cfg.label}: {c.porFuente[f]}
                    </span>
                  );
                })}
              </div>

              {/* Por qué es sospechoso: la coincidencia de fuentes es la señal. */}
              <p className="text-[11px] text-gray-500 mt-2 flex items-start gap-1">
                <AlertTriangle
                  size={11}
                  className="text-amber-500 mt-0.5 shrink-0"
                />
                {(() => {
                  const nf = FUENTES_CASO.filter(
                    (f) => c.porFuente[f] > 0
                  ).length;
                  const metros = Math.round(c.radioKm * 1000);
                  return nf > 1
                    ? `${nf} fuentes distintas coinciden en ${metros} m durante ${c.ventanaHoras} h.`
                    : `${c.numCasos} casos concentrados en ${metros} m durante ${c.ventanaHoras} h.`;
                })()}
              </p>

              {/* Fuente probable */}
              {c.fuenteProbable && (
                <div className="mt-2.5 bg-white/70 rounded-lg border border-red-100 p-2">
                  <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide flex items-center gap-1">
                    <Crosshair size={11} /> Fuente probable
                  </p>
                  <p className="text-sm font-semibold text-gray-800 leading-tight mt-0.5">
                    {c.fuenteProbable.nombre}
                  </p>
                  <p className="text-xs text-gray-500">
                    {c.fuenteProbable.categoria} · score{" "}
                    <strong className="text-gray-700">
                      {Math.round(c.fuenteProbable.score)}
                    </strong>
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1 leading-tight">
                    El establecimiento de mayor riesgo dentro del foco.
                  </p>
                  {activo && (
                    <p className="text-xs text-red-700 mt-2 flex items-start gap-1.5">
                      <Navigation size={12} className="mt-0.5 shrink-0" />
                      Despachar inspector con hipótesis de fuente armada.
                    </p>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function RiesgoMap() {
  const [data, setData] = useState<Establecimiento[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<Establecimiento | null>(null);
  const [filtroNivel, setFiltroNivel] = useState<NivelRiesgo | "todos">("todos");
  const [filtroLocalidad, setFiltroLocalidad] = useState<string>("todas");
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas");
  // Vista del modo Riesgo: puntos individuales o mapa de calor por densidad.
  const [vistaRiesgo, setVistaRiesgo] = useState<"puntos" | "calor">("puntos");
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [generandoAgenda, setGenerandoAgenda] = useState(false);
  // Rotación de la agenda: cada generación avanza al "día siguiente" y enfoca la
  // siguiente UPZ más desatendida, para que la demo no muestre siempre la misma.
  const [proximoDia, setProximoDia] = useState(0);
  const [diaMostrado, setDiaMostrado] = useState<number | null>(null);
  // Reportes de visita del inspector, por id de establecimiento (Eje 2: cierre
  // del ciclo agenda -> visita -> comparación con lo predicho).
  const [visitas, setVisitas] = useState<Record<number, ResultadoVisita>>({});
  const [modo, setModo] = useState<
    "riesgo" | "brotes" | "ciudadano" | "backtest"
  >("riesgo");
  const [clusterSel, setClusterSel] = useState<Cluster | null>(null);
  // Eje 3: encuesta de autovigilancia abierta como modal.
  const [mostrarEncuesta, setMostrarEncuesta] = useState(false);
  // Reporte ciudadano: casos inyectados en vivo + confirmación tras enviar.
  const [casosCiudadanos, setCasosCiudadanos] = useState<CasoEpidemiologico[]>(
    []
  );
  const [reporteConfirmado, setReporteConfirmado] = useState<{
    nombre: string;
    score: number;
    nivel: NivelRiesgo;
  } | null>(null);
  // Geolocalización del ciudadano: centrado del mapa + distancia al más cercano.
  const [centro, setCentro] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const [distanciaUbicacion, setDistanciaUbicacion] = useState<number | null>(
    null
  );
  const [ubicando, setUbicando] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/establecimientos.json")
      .then((r) => r.json())
      .then((d: Establecimiento[]) => setData(d))
      .catch(() => setData([]));
  }, []);

  const localidades = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.map((e) => e.localidad))).sort();
  }, [data]);

  const categorias = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.map((e) => e.categoria))).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((e) => {
      const mNivel = filtroNivel === "todos" || e.nivel_riesgo === filtroNivel;
      const mLoc =
        filtroLocalidad === "todas" || e.localidad === filtroLocalidad;
      const mCat =
        filtroCategoria === "todas" || e.categoria === filtroCategoria;
      return mNivel && mLoc && mCat;
    });
  }, [data, filtroNivel, filtroLocalidad, filtroCategoria]);

  const conteos = useMemo(() => {
    const c: Record<string, number> = { Critico: 0, Alto: 0, Medio: 0, Bajo: 0 };
    for (const e of filtered) c[e.nivel_riesgo]++;
    return c;
  }, [filtered]);

  // Casos epidemiológicos y clusters (Eje 4). Deterministas -> se calculan una
  // vez cuando llegan los datos.
  const casos = useMemo(
    () => (data ? [...generarCasos(data), ...casosCiudadanos] : []),
    [data, casosCiudadanos]
  );
  const clusters = useMemo(
    () => (data ? detectarClusters(casos, data) : []),
    [casos, data]
  );

  // Actualiza un establecimiento en el dataset en memoria (recálculo en vivo).
  function actualizarEstablecimiento(nuevo: Establecimiento) {
    setData((prev) =>
      prev ? prev.map((e) => (e.id === nuevo.id ? nuevo : e)) : prev
    );
    setSeleccionado((s) => (s && s.id === nuevo.id ? nuevo : s));
  }

  // Eje 3: aplica el autorreporte (ya trae el nuevo resultado_anterior y score).
  function handleAplicarAutorreporte(actualizado: Establecimiento) {
    actualizarEstablecimiento(actualizado);
    setMostrarEncuesta(false);
  }

  // Eje 2: guarda el reporte de visita del inspector, recalcula el score real y
  // recolorea el punto en el mapa (cierra el ciclo predicción -> realidad).
  function handleRegistrarVisita(resultado: ResultadoVisita) {
    setVisitas((prev) => ({ ...prev, [resultado.establecimientoId]: resultado }));
    actualizarEstablecimiento(resultado.establecimientoActualizado);
  }

  // Ubica al ciudadano y selecciona el establecimiento más cercano para reportar.
  function handleUbicacionCercana() {
    if (!data || data.length === 0) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Tu navegador no permite geolocalización.");
      return;
    }
    setUbicando(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const punto = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        let mejor = data[0];
        let mejorDist = Infinity;
        for (const e of data) {
          const d = haversineKm(punto, e);
          if (d < mejorDist) {
            mejorDist = d;
            mejor = e;
          }
        }
        setSeleccionado(mejor);
        setReporteConfirmado(null);
        setCentro({ lat: mejor.lat, lon: mejor.lon });
        setDistanciaUbicacion(mejorDist);
        setUbicando(false);
      },
      () => {
        setGeoError(
          "No pudimos obtener tu ubicación. Revisa los permisos del navegador."
        );
        setUbicando(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Reporte ciudadano: suma al factor quejas_ciudadanas (tope 12), recalcula el
  // score e inyecta un caso azul (queja ciudadana) que alimenta el Eje 4.
  function handleEnviarReporteCiudadano(e: Establecimiento) {
    const nuevoFactor = Math.min(
      FACTOR_MAX.quejas_ciudadanas,
      e.desglose.quejas_ciudadanas + INCREMENTO_QUEJA_CIUDADANA
    );
    const recalculado = recalcularConFactor(e, "quejas_ciudadanas", nuevoFactor);
    const actualizado: Establecimiento = {
      ...recalculado,
      quejas_12m: e.quejas_12m + 1,
    };
    actualizarEstablecimiento(actualizado);
    setCasosCiudadanos((prev) => [
      ...prev,
      {
        id: `ciudadano-${e.id}-${prev.length}`,
        lat: e.lat,
        lon: e.lon,
        fuente: "Queja ciudadana",
        horasAtras: 0,
      },
    ]);
    setReporteConfirmado({
      nombre: actualizado.nombre,
      score: actualizado.score,
      nivel: actualizado.nivel_riesgo,
    });
    setSeleccionado(null);
  }

  async function handleGenerarAgenda() {
    if (!data || generandoAgenda) return;
    // Si el usuario filtró una localidad, se usa como foco; si no, el motor
    // elige automáticamente la de mayor índice de desatención.
    setGenerandoAgenda(true);
    // Si el usuario forzó una localidad, no rotamos (foco fijo). Si no, cada clic
    // avanza al día siguiente de la rotación entre las UPZ más desatendidas.
    const rotando = filtroLocalidad === "todas";
    const offset = rotando ? proximoDia : 0;
    try {
      const a = await generarAgenda(data, {
        localidadFoco: rotando ? undefined : filtroLocalidad,
        diaOffset: offset,
      });
      if (a) {
        setAgenda(a);
        setDiaMostrado(rotando ? offset + 1 : null); // 1-based para la UI
        if (rotando) setProximoDia(offset + 1);
        setSeleccionado(null);
      }
    } finally {
      setGenerandoAgenda(false);
    }
  }

  function cambiarModo(nuevo: "riesgo" | "brotes" | "ciudadano" | "backtest") {
    setModo(nuevo);
    setAgenda(null);
    setProximoDia(0);
    setDiaMostrado(null);
    setSeleccionado(null);
    setClusterSel(null);
    setReporteConfirmado(null);
    setMostrarEncuesta(false);
    setCentro(null);
    setDistanciaUbicacion(null);
    setGeoError(null);
  }

  const enRiesgo = modo === "riesgo";
  const enBrotes = modo === "brotes";
  const enCiudadano = modo === "ciudadano";
  const enBacktest = modo === "backtest";

  if (!data) {
    return (
      <div className="h-[600px] w-full flex items-center justify-center bg-gray-100 rounded-xl">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toggle de modo: Riesgo (Eje 1/2) <-> Brotes (Eje 4) */}
      <div className="inline-flex self-start rounded-xl border border-gray-200 bg-gray-50 p-1">
        <button
          onClick={() => cambiarModo("riesgo")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            enRiesgo
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          <ShieldCheck size={16} /> Mapa de riesgo
        </button>
        <button
          onClick={() => cambiarModo("ciudadano")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            enCiudadano
              ? "bg-white text-blue-600 shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          <Eye size={16} /> Reporte ciudadano
        </button>
        <button
          onClick={() => cambiarModo("brotes")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            enBrotes
              ? "bg-white text-red-600 shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          <Activity size={16} /> Alerta de brotes
          {clusters.length > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[11px] font-bold text-white bg-red-500 rounded-full px-1">
              {clusters.length}
            </span>
          )}
        </button>
        <button
          onClick={() => cambiarModo("backtest")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            enBacktest
              ? "bg-white text-violet-600 shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          <FlaskConical size={16} /> Backtest
        </button>
      </div>

      {/* Barra de estadísticas (solo en modo riesgo) */}
      {enRiesgo && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {NIVELES_ORDEN.map((nivel) => {
          const cfg = NIVEL_CONFIG[nivel];
          return (
            <button
              key={nivel}
              onClick={() =>
                setFiltroNivel(filtroNivel === nivel ? "todos" : nivel)
              }
              className={`rounded-xl p-3 border text-left transition-all ${
                filtroNivel === nivel
                  ? "ring-2 ring-offset-1"
                  : "hover:border-gray-300"
              }`}
              style={{
                borderColor: `${cfg.color}55`,
                backgroundColor: `${cfg.color}0d`,
                ...(filtroNivel === nivel
                  ? ({ ["--tw-ring-color" as string]: cfg.color } as React.CSSProperties)
                  : {}),
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: cfg.color }}
                />
                <span className="text-xs font-medium text-gray-600">
                  {cfg.label}
                </span>
              </div>
              <p
                className="text-2xl font-black mt-1"
                style={{ color: cfg.color }}
              >
                {conteos[nivel].toLocaleString("es-CO")}
              </p>
            </button>
          );
        })}
      </div>
      )}

      {/* Filtros (riesgo) · leyenda (brotes) · instrucción (ciudadano) */}
      {enRiesgo ? (
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filtroLocalidad}
          onChange={(e) => setFiltroLocalidad(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pereira-red bg-white"
        >
          <option value="todas">Todas las localidades</option>
          {localidades.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pereira-red bg-white"
        >
          <option value="todas">Todos los tipos</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {(filtroNivel !== "todos" ||
          filtroLocalidad !== "todas" ||
          filtroCategoria !== "todas") && (
          <button
            onClick={() => {
              setFiltroNivel("todos");
              setFiltroLocalidad("todas");
              setFiltroCategoria("todas");
            }}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Limpiar filtros
          </button>
        )}
        {/* Vista: puntos individuales o mapa de calor. */}
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm ml-auto">
          <button
            onClick={() => setVistaRiesgo("puntos")}
            className={`px-3 py-2 font-medium transition-colors ${
              vistaRiesgo === "puntos"
                ? "bg-pereira-red text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Puntos
          </button>
          <button
            onClick={() => setVistaRiesgo("calor")}
            className={`px-3 py-2 font-medium transition-colors flex items-center gap-1.5 ${
              vistaRiesgo === "calor"
                ? "bg-pereira-red text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Flame size={14} /> Calor
          </button>
        </div>
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {filtered.length.toLocaleString("es-CO")} establecimientos
        </span>
        {vistaRiesgo === "calor" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
            Menor
            <span
              className="h-2 w-20 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg,#16a34a,#f59e0b,#f97316,#dc2626)",
              }}
            />
            Mayor riesgo
          </span>
        )}
        <button
          onClick={handleGenerarAgenda}
          disabled={generandoAgenda}
          className="flex items-center gap-2 bg-pereira-red text-white rounded-lg px-4 py-2 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait"
        >
          <Route size={16} className={generandoAgenda ? "animate-spin" : ""} />
          {generandoAgenda ? "Trazando ruta real…" : "Generar agenda de mañana"}
        </button>
      </div>
      ) : enBrotes ? (
      <div className="rounded-xl border border-red-100 bg-red-50/60 px-4 py-3">
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-red-700">
            Cuando varias personas se enferman cerca del mismo lugar
          </span>
          , el sistema lo detecta como un posible brote y señala el
          establecimiento sospechoso —{" "}
          <span className="font-semibold">antes de que escale</span>.
        </p>

        {/* Secuencia 1→2→3: es a la vez el relato y la leyenda del mapa. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 mt-3">
          <PasoBrote
            n={1}
            titulo="Casos"
            desc="Gente enferma, reportada por 3 fuentes"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
              {FUENTES_CASO.map((f) => {
                const cfg = FUENTE_CASO_CONFIG[f];
                return (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-500"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: cfg.color }}
                    />
                    {cfg.label}
                  </span>
                );
              })}
            </div>
          </PasoBrote>

          <PasoBrote
            n={2}
            titulo="Foco"
            desc="Concentración anómala = posible brote"
          >
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 mt-1">
              <span className="w-3 h-3 rounded-full border-2 border-red-400 bg-red-400/10" />
              círculo en el mapa
            </span>
          </PasoBrote>

          <PasoBrote
            n={3}
            titulo="Fuente probable"
            desc="El establecimiento sospechoso del foco"
          >
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 mt-1">
              <Flag size={12} className="text-red-600" /> bandera roja
            </span>
          </PasoBrote>

          <span className="ml-auto self-center text-sm text-gray-500 whitespace-nowrap">
            {casos.length} casos · ventana {VENTANA_HORAS}h
          </span>
        </div>

        {/* Método (para el jurado técnico). */}
        <p className="text-[11px] text-gray-400 mt-2.5">
          Método: ventana {VENTANA_HORAS} h · radio {RADIO_CLUSTER_KM * 1000} m ·
          mínimo {MIN_CASOS} casos · agrupamiento espacial por densidad (tipo
          DBSCAN).
        </p>
      </div>
      ) : enCiudadano ? (
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        <Eye size={15} className="text-blue-600 shrink-0" />
        <span>
          Toca un establecimiento en el mapa o usa tu ubicación para reportar el
          más cercano.
        </span>
        <button
          onClick={handleUbicacionCercana}
          disabled={ubicando}
          className="inline-flex items-center gap-1.5 bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait"
        >
          <LocateFixed
            size={14}
            className={ubicando ? "animate-spin" : ""}
          />
          {ubicando ? "Ubicando…" : "Usar mi ubicación"}
        </button>
        {geoError && (
          <span className="text-red-600 text-xs">{geoError}</span>
        )}
        {casosCiudadanos.length > 0 && (
          <span className="ml-auto text-blue-700 font-semibold whitespace-nowrap">
            {casosCiudadanos.length} reporte
            {casosCiudadanos.length > 1 ? "s" : ""} ciudadano
            {casosCiudadanos.length > 1 ? "s" : ""} en esta sesión
          </span>
        )}
      </div>
      ) : null}

      {/* Backtest estilo Chicago (cierre del pitch) */}
      {enBacktest && (
        <div className="rounded-xl border border-gray-200 shadow-sm bg-white p-4">
          <Backtest data={data} visitas={visitas} />
        </div>
      )}

      {/* Mapa + panel */}
      {!enBacktest && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 relative rounded-xl overflow-hidden border border-gray-200 shadow-sm">
          <MapContainer
            center={BOGOTA_CENTER}
            zoom={ZOOM}
            preferCanvas
            className="h-[600px] w-full z-0"
            style={{ zIndex: 0 }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RecenterButton />
            <AjustarAAgenda agenda={agenda} />
            <AjustarACluster cluster={clusterSel} />
            <CentrarEn punto={centro} />
            {enRiesgo && vistaRiesgo === "calor" && (
              <CapaCalor puntos={filtered} />
            )}
            {(enRiesgo && vistaRiesgo === "calor"
              ? []
              : enRiesgo
              ? filtered
              : data
            ).map((e) => {
              const cfg = NIVEL_CONFIG[e.nivel_riesgo];
              const activo = seleccionado?.id === e.id;
              return (
                <CircleMarker
                  key={e.id}
                  center={[e.lat, e.lon]}
                  radius={activo ? 9 : e.nivel_riesgo === "Critico" ? 6 : 4}
                  pathOptions={{
                    color: activo ? "#111827" : cfg.borderColor,
                    weight: activo ? 2 : 1,
                    fillColor: cfg.color,
                    // Se atenúa el fondo para dar foco a la ruta o a los brotes.
                    fillOpacity: enBrotes
                      ? 0.12
                      : enCiudadano
                      ? 0.7
                      : agenda
                      ? 0.25
                      : 0.85,
                  }}
                  eventHandlers={{
                    click: () => {
                      if (enRiesgo) setSeleccionado(e);
                      else if (enCiudadano) {
                        setSeleccionado(e);
                        setReporteConfirmado(null);
                        setDistanciaUbicacion(null);
                      }
                    },
                  }}
                />
              );
            })}

            {/* Capa de reportes ciudadanos de esta sesión (Eje 3 → Eje 4) */}
            {enCiudadano &&
              casosCiudadanos.map((c) => (
                <CircleMarker
                  key={c.id}
                  center={[c.lat, c.lon]}
                  radius={5}
                  pathOptions={{
                    color: "#fff",
                    weight: 1,
                    fillColor: FUENTE_CASO_CONFIG["Queja ciudadana"].color,
                    fillOpacity: 0.95,
                  }}
                />
              ))}

            {/* Capa de brotes (Eje 4) */}
            {enBrotes && (
              <>
                {clusters.map((c) => (
                  <Circle
                    key={`cl-${c.id}`}
                    center={[c.centro.lat, c.centro.lon]}
                    radius={Math.max(c.radioKm, 0.15) * 1000}
                    pathOptions={{
                      color: "#dc2626",
                      weight: clusterSel?.id === c.id ? 2.5 : 1.5,
                      fillColor: "#dc2626",
                      fillOpacity: clusterSel?.id === c.id ? 0.12 : 0.06,
                    }}
                    eventHandlers={{ click: () => setClusterSel(c) }}
                  />
                ))}
                {casos.map((ca) => (
                  <CircleMarker
                    key={ca.id}
                    center={[ca.lat, ca.lon]}
                    radius={3}
                    pathOptions={{
                      color: "#fff",
                      weight: 0.5,
                      fillColor: FUENTE_CASO_CONFIG[ca.fuente].color,
                      fillOpacity: 0.9,
                    }}
                  />
                ))}
                {clusters.map((c) =>
                  c.fuenteProbable ? (
                    <Marker
                      key={`fp-${c.id}`}
                      position={[c.fuenteProbable.lat, c.fuenteProbable.lon]}
                      icon={iconoFuenteProbable}
                      eventHandlers={{ click: () => setClusterSel(c) }}
                    />
                  ) : null
                )}
              </>
            )}

            {/* Ruta del inspector (Eje 2) */}
            {agenda && (
              <>
                <Polyline
                  positions={agenda.geometria}
                  pathOptions={{
                    color: "#111827",
                    weight: 4,
                    opacity: 0.85,
                    // Línea continua cuando sigue las calles reales; punteada
                    // cuando es la estimación de respaldo (línea recta).
                    dashArray: agenda.rutaReal ? undefined : "6 8",
                  }}
                />
                <Marker
                  position={[agenda.base.lat, agenda.base.lon]}
                  icon={iconoBase}
                />
                {agenda.paradas.map((p) => (
                  <Marker
                    key={p.establecimiento.id}
                    position={[p.establecimiento.lat, p.establecimiento.lon]}
                    icon={iconoParada(
                      p.orden,
                      NIVEL_CONFIG[p.establecimiento.nivel_riesgo].color
                    )}
                    eventHandlers={{
                      click: () => setSeleccionado(p.establecimiento),
                    }}
                  />
                ))}
              </>
            )}
          </MapContainer>
        </div>

        {/* Panel lateral */}
        <div className="lg:col-span-1 rounded-xl border border-gray-200 shadow-sm bg-white p-4 h-[600px] overflow-y-auto">
          {enBrotes ? (
            <PanelBrotes
              clusters={clusters}
              clusterSel={clusterSel}
              onSeleccionar={setClusterSel}
            />
          ) : enCiudadano ? (
            reporteConfirmado ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-2">
                <CheckCircle2 size={36} className="text-blue-600" />
                <p className="text-sm font-semibold text-gray-800">
                  ¡Gracias! Tu reporte sobre{" "}
                  <span className="text-gray-900">
                    {reporteConfirmado.nombre}
                  </span>{" "}
                  fue registrado.
                </p>
                <p className="text-xs text-gray-500 max-w-[220px]">
                  El score se recalculó a{" "}
                  <strong>{Math.round(reporteConfirmado.score)}</strong> (riesgo{" "}
                  {NIVEL_CONFIG[reporteConfirmado.nivel].label}) y el caso alimenta
                  la vigilancia de brotes.
                </p>
                <button
                  onClick={() => setReporteConfirmado(null)}
                  className="mt-1 text-sm font-semibold text-blue-600 hover:underline"
                >
                  Reportar otro establecimiento
                </button>
              </div>
            ) : seleccionado ? (
              <ReporteCiudadano
                establecimiento={seleccionado}
                distanciaKm={distanciaUbicacion}
                onEnviar={() => handleEnviarReporteCiudadano(seleccionado)}
                onCancelar={() => setSeleccionado(null)}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3">
                <Eye size={32} strokeWidth={1.5} />
                <p className="text-sm max-w-[200px]">
                  ¿Fuiste a un lugar y viste algo? Toca el establecimiento en el
                  mapa y repórtalo con una foto o comentario.
                </p>
              </div>
            )
          ) : agenda ? (
            seleccionado &&
            agenda.paradas.some(
              (p) => p.establecimiento.id === seleccionado.id
            ) ? (
              <PanelVisita
                e={seleccionado}
                resultado={visitas[seleccionado.id]}
                onVolver={() => setSeleccionado(null)}
                onRegistrar={handleRegistrarVisita}
                onDiligenciar={() => setMostrarEncuesta(true)}
              />
            ) : (
              <PanelAgenda
                agenda={agenda}
                onCerrar={() => setAgenda(null)}
                onSeleccionarParada={(e) => setSeleccionado(e)}
                paradaActivaId={seleccionado?.id ?? null}
                visitas={visitas}
                dia={diaMostrado}
              />
            )
          ) : seleccionado ? (
            <PanelDetalle
              e={seleccionado}
              onDiligenciar={() => setMostrarEncuesta(true)}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3">
              <MapPin size={32} strokeWidth={1.5} />
              <p className="text-sm max-w-[200px]">
                Haga clic en un establecimiento del mapa para ver por qué está
                priorizado y su puntaje de riesgo detallado.
              </p>
            </div>
          )}
        </div>
      </div>

      )}

      {/* Modal de autovigilancia asistida (Eje 3) */}
      {mostrarEncuesta && seleccionado && (
        <EncuestaAutovigilancia
          establecimiento={seleccionado}
          clusters={clusters}
          onCerrar={() => setMostrarEncuesta(false)}
          onAplicar={handleAplicarAutorreporte}
        />
      )}

      {/* Fuente */}
      <p className="text-xs text-gray-400 leading-relaxed">* {FUENTE_INSPECCION}</p>
    </div>
  );
}
