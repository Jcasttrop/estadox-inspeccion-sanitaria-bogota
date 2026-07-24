"use client";

// Backtest estilo Chicago (Eje 1 · cierre del pitch, §11 de la propuesta).
//
// Acumula el resultado predicho-vs-encontrado sobre DOS órdenes de visita —el del
// modelo de riesgo y el reactivo/aleatorio actual— y grafica cuál detecta antes
// las violaciones críticas. Replica el número de Chicago (≈69% vs ≈55% a mitad de
// periodo) computándolo de un ground-truth simulado y auditable (`lib/backtest`),
// nunca hardcodeado. Las visitas que el inspector registró en vivo (Eje 2) se
// marcan como puntos verificados sobre la curva del modelo.

import { useMemo, useState } from "react";
import { TrendingUp, FlaskConical, Clock, Target, Users } from "lucide-react";
import type { Establecimiento } from "@/data/inspeccion";
import type { ResultadoVisita } from "@/lib/visita";
import {
  ejecutarBacktest,
  localidadesElegibles,
  coberturaAnual,
  UNIVERSO_CIUDAD,
  VISITAS_POR_DIA,
  MIN_N_LOCALIDAD,
  DIAS_LABORALES,
  UNIVERSO_REAL,
  INSPECTORES_DEFECTO,
  type PuntoCurva,
} from "@/lib/backtest";

// Modelo = héroe (violeta sólido); tradicional = baseline neutro (gris punteado).
// La identidad se sostiene por tono + textura (sólido/punteado) + etiqueta directa.
const COLOR_MODELO = "#7c3aed";
const COLOR_TRAD = "#64748b";
// Anotación de "capacidad operativa" (hasta dónde se alcanza a visitar en un año).
const COLOR_CAPACIDAD = "#d97706";

// --- Geometría del lienzo SVG (coordenadas de viewBox) ---
const VW = 560;
const VH = 380;
const PAD_L = 46;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 40;
const PLOT_W = VW - PAD_L - PAD_R;
const PLOT_H = VH - PAD_T - PAD_B;

const sx = (x01: number) => PAD_L + x01 * PLOT_W;
const sy = (y01: number) => PAD_T + (1 - y01) * PLOT_H;

function pathDesde(curva: PuntoCurva[]): string {
  return curva.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ");
}

// Interpola la detección (y) de una curva en una fracción de esfuerzo x.
function interp(curva: PuntoCurva[], x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return curva[curva.length - 1].y;
  for (let i = 1; i < curva.length; i++) {
    if (curva[i].x >= x) {
      const a = curva[i - 1];
      const b = curva[i];
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return curva[curva.length - 1].y;
}

// Primera fracción de esfuerzo (x) en la que la curva alcanza una detección y.
function xParaY(curva: PuntoCurva[], y: number): number {
  for (let i = 1; i < curva.length; i++) {
    if (curva[i].y >= y) {
      const a = curva[i - 1];
      const b = curva[i];
      const t = (y - a.y) / (b.y - a.y || 1);
      return a.x + t * (b.x - a.x);
    }
  }
  return 1;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

interface BacktestProps {
  data: Establecimiento[];
  visitas: Record<number, ResultadoVisita>;
}

export default function Backtest({ data, visitas }: BacktestProps) {
  const localidades = useMemo(() => localidadesElegibles(data), [data]);
  const [universo, setUniverso] = useState(UNIVERSO_CIUDAD);
  const [inspectores, setInspectores] = useState(INSPECTORES_DEFECTO);
  const [metaDeteccion, setMetaDeteccion] = useState(0.8);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const resultado = useMemo(() => {
    const subset =
      universo === UNIVERSO_CIUDAD
        ? data
        : data.filter((e) => e.localidad === universo);
    return ejecutarBacktest(subset, universo);
  }, [data, universo]);

  // Visitas reales de esta sesión que caen dentro del universo, ubicadas sobre la
  // curva del modelo por su posición en el orden de riesgo.
  const puntosVivos = useMemo(() => {
    if (!resultado) return [];
    const orden = resultado.modelo.orden;
    const idxPorId = new Map<number, number>();
    orden.forEach((e, i) => idxPorId.set(e.id, i));
    return Object.values(visitas)
      .map((v) => {
        const idx = idxPorId.get(v.establecimientoId);
        if (idx === undefined) return null;
        const punto = resultado.modelo.curva[idx + 1];
        return { v, x: punto.x, y: punto.y };
      })
      .filter((p): p is { v: ResultadoVisita; x: number; y: number } => p !== null);
  }, [resultado, visitas]);

  if (!resultado) {
    return (
      <div className="h-[600px] flex items-center justify-center text-gray-400 text-sm">
        Sin establecimientos suficientes para el backtest en este universo.
      </div>
    );
  }

  const { modelo, tradicional } = resultado;
  const detModelo = modelo.deteccionEnMitad;
  const detTrad = tradicional.deteccionEnMitad;

  // Capacidad operativa: qué fracción del universo se alcanza a cubrir en un año
  // y, dentro de esa porción alcanzable, cuánto detecta cada orden.
  const cobertura = coberturaAnual(inspectores);
  const detModeloCob = interp(modelo.curva, cobertura);
  const detTradCob = interp(tradicional.curva, cobertura);
  const ratioCob = detTradCob > 0 ? detModeloCob / detTradCob : 0;
  const visitasAnio = inspectores * VISITAS_POR_DIA * DIAS_LABORALES;

  // El reverso: para cubrir TODO el universo hacen falta estos inspectores; pero
  // priorizando, se alcanza una meta de detección con muchos menos.
  const inspectoresTodo = Math.round(UNIVERSO_REAL / (VISITAS_POR_DIA * DIAS_LABORALES));
  const inspModelo = Math.round(xParaY(modelo.curva, metaDeteccion) * inspectoresTodo);
  const inspReactivo = Math.round(
    xParaY(tradicional.curva, metaDeteccion) * inspectoresTodo
  );

  const hoverDet =
    hoverX !== null
      ? { modelo: interp(modelo.curva, hoverX), trad: interp(tradicional.curva, hoverX) }
      : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VW;
    const x01 = (px - PAD_L) / PLOT_W;
    setHoverX(Math.min(1, Math.max(0, x01)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* IZQUIERDA — qué es, con qué se compara y cómo leerlo */}
        <aside className="lg:border-r lg:border-gray-100 lg:pr-5 flex flex-col gap-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical size={18} className="text-violet-600" />
              ¿Qué es este backtest?
            </h3>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">
              Es la <strong>prueba</strong> de que ordenar las visitas por el riesgo
              del modelo encuentra los problemas graves <strong>antes</strong> que el
              método actual (reactivo/aleatorio). Es la réplica del estudio de{" "}
              <strong>Chicago 2015</strong>, calculada sobre este universo.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
              La idea, con un ejemplo
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Imagina 100 locales y 20 con una falla grave (aún no sabes cuáles). Si
              los visitas <strong>al azar</strong>, a mitad de camino encontraste ~10.
              Si visitas primero <strong>los que el modelo marca como más
              riesgosos</strong>, a mitad de camino ya encontraste ~14. Mismo esfuerzo,
              mismos inspectores — pero los hallas antes.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1 flex items-center gap-1">
              <Users size={12} /> Y nunca se cubre todo
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Son <strong>~400.000 lugares</strong> y solo unos cientos de inspectores
              a <strong>~5 visitas/día</strong>: en un año no se alcanza a visitar
              ni de cerca a todos, solo el <strong>arranque de la lista</strong>. Por
              eso el orden lo es todo — la franja sombreada de la gráfica es lo que
              realmente se cubre, y ahí el modelo concentra los peores casos.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Cómo leer la gráfica →
            </p>
            <ul className="text-xs text-gray-600 space-y-1.5">
              <li className="flex gap-2">
                <span
                  className="mt-1.5 w-4 h-[3px] rounded-full shrink-0"
                  style={{ backgroundColor: COLOR_MODELO }}
                />
                <span>
                  <strong>Línea violeta (modelo):</strong> cuanto más rápido sube,
                  antes detecta.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  className="mt-1.5 w-4 h-0 shrink-0 border-t-2 border-dashed"
                  style={{ borderColor: COLOR_TRAD }}
                />
                <span>
                  <strong>Línea gris (reactivo):</strong> el método actual, ≈ el azar.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 shrink-0 font-bold text-gray-400">↕</span>
                <span>
                  La <strong>distancia entre las dos líneas</strong> en la marca del
                  50% es la ventaja del modelo.
                </span>
              </li>
              <li className="flex gap-2">
                <span
                  className="mt-1 w-4 h-3 rounded-sm shrink-0 border"
                  style={{
                    backgroundColor: `${COLOR_CAPACIDAD}22`,
                    borderColor: `${COLOR_CAPACIDAD}66`,
                  }}
                />
                <span>
                  <strong>Franja ámbar:</strong> lo que se alcanza a cubrir en un año.
                  Solo cuenta lo que cae ahí.
                </span>
              </li>
            </ul>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-100 pt-2">
            Los números se <strong>calculan</strong> del experimento (no están
            escritos a mano). Mide <strong>velocidad de detección</strong>, no
            reducción de intoxicaciones — mismo matiz honesto de Chicago.
          </p>
        </aside>

        {/* DERECHA — lo interactivo: selector + KPIs + gráfica */}
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm self-start">
            <span className="text-gray-500">Universo:</span>
            <select
              value={universo}
              onChange={(e) => setUniverso(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value={UNIVERSO_CIUDAD}>
                {UNIVERSO_CIUDAD} ({data.length.toLocaleString("es-CO")})
              </option>
              {localidades.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          {/* Realidad operativa: cuánto se alcanza a cubrir y qué se detecta ahí */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-amber-600" />
                <label className="text-sm text-gray-700">
                  Inspectores para Bogotá:
                  <input
                    type="number"
                    min={10}
                    max={2000}
                    step={10}
                    value={inspectores}
                    onChange={(e) =>
                      setInspectores(
                        Math.max(1, Math.min(5000, Number(e.target.value) || 0))
                      )
                    }
                    className="ml-2 w-20 border border-amber-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                × {VISITAS_POR_DIA} visitas/día × {DIAS_LABORALES} días ={" "}
                <strong className="text-gray-700">
                  {visitasAnio.toLocaleString("es-CO")}
                </strong>{" "}
                visitas/año
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-2xl font-black text-amber-700">
                {pct(cobertura)}
              </span>
              <span className="text-xs text-gray-600">
                de los {UNIVERSO_REAL.toLocaleString("es-CO")} establecimientos se
                alcanza a visitar en un año.
              </span>
            </div>
            <p className="text-xs text-gray-700 mt-1.5 leading-relaxed">
              Dentro de esa porción alcanzable, el orden del modelo detecta el{" "}
              <strong className="text-violet-700">{pct(detModeloCob)}</strong> de las
              violaciones críticas frente al <strong>{pct(detTradCob)}</strong> del
              orden reactivo
              {ratioCob >= 1.1 && (
                <>
                  {" "}
                  — <strong className="text-amber-700">
                    {ratioCob.toFixed(1)}× más problemas graves
                  </strong>{" "}
                  con exactamente las mismas visitas
                </>
              )}
              .
            </p>
          </div>

          {/* El reverso: cuántos inspectores hacen falta PRIORIZANDO */}
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
              <TrendingUp size={16} className="text-violet-600" />
              <span>Para detectar el</span>
              <select
                value={metaDeteccion}
                onChange={(e) => setMetaDeteccion(Number(e.target.value))}
                className="border border-violet-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value={0.7}>70%</option>
                <option value={0.8}>80%</option>
                <option value={0.9}>90%</option>
              </select>
              <span>de las violaciones críticas:</span>
            </div>

            {/* Comparativo de inspectores necesarios */}
            <div className="mt-2 space-y-1.5">
              {[
                { label: "Priorizando (modelo)", n: inspModelo, color: COLOR_MODELO, fuerte: true },
                { label: "Sin priorizar (reactivo)", n: inspReactivo, color: COLOR_TRAD, fuerte: false },
                { label: "Cubrir todo el universo", n: inspectoresTodo, color: COLOR_CAPACIDAD, fuerte: false },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="w-40 text-[11px] text-gray-600 shrink-0">{f.label}</span>
                  <div className="flex-1 h-5 bg-white rounded-md overflow-hidden border border-gray-100">
                    <div
                      className="h-full rounded-md flex items-center justify-end pr-1.5"
                      style={{
                        width: `${Math.max(6, (f.n / inspectoresTodo) * 100)}%`,
                        backgroundColor: f.fuerte ? f.color : `${f.color}bb`,
                      }}
                    >
                      <span className="text-[11px] font-bold text-white">{f.n}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">
              Priorizando se llega a la misma meta con{" "}
              <strong className="text-violet-700">
                {inspectoresTodo - inspModelo} inspectores menos
              </strong>{" "}
              que cubriendo todo — el mismo resultado con menos personal, porque los
              peores casos se visitan primero.
            </p>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide flex items-center gap-1">
            <Target size={12} /> Detección a mitad de periodo
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black text-violet-700">{pct(detModelo)}</span>
            <span className="text-sm text-gray-400 line-through">{pct(detTrad)}</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">modelo vs reactivo</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <TrendingUp size={12} /> Ventaja del modelo
          </p>
          <p className="mt-1 text-3xl font-black text-gray-900">
            +{Math.round(resultado.liftPuntos)}
            <span className="text-base font-bold text-gray-400"> pts</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">más detección temprana</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Clock size={12} /> Adelanto de detección
          </p>
          <p className="mt-1 text-3xl font-black text-gray-900">
            {resultado.jornadasAntes}
            <span className="text-base font-bold text-gray-400"> jornadas</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {resultado.inspeccionesAhorradas.toLocaleString("es-CO")} inspecciones
            antes (a {VISITAS_POR_DIA}/día)
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Muestra del backtest
          </p>
          <p className="mt-1 text-3xl font-black text-gray-900">
            {resultado.n.toLocaleString("es-CO")}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {resultado.totalViolaciones.toLocaleString("es-CO")} con violación
            crítica ({pct(resultado.tasaBase)})
          </p>
        </div>
      </div>

      {/* Gráfica de detección acumulada */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-4 mb-1 flex-wrap px-1">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <svg width="22" height="8">
              <line x1="0" y1="4" x2="22" y2="4" stroke={COLOR_MODELO} strokeWidth="2.5" />
            </svg>
            Orden del modelo
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <svg width="22" height="8">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke={COLOR_TRAD}
                strokeWidth="2.5"
                strokeDasharray="4 3"
              />
            </svg>
            Orden reactivo/aleatorio
          </span>
          {puntosVivos.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <span className="inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white bg-gray-800" />
              Visitas verificadas en vivo ({puntosVivos.length})
            </span>
          )}
        </div>

        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="w-full h-auto"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverX(null)}
        >
          {/* Grilla + ejes */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={`gy-${g}`}>
              <line
                x1={sx(0)}
                y1={sy(g)}
                x2={sx(1)}
                y2={sy(g)}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text x={sx(0) - 8} y={sy(g) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <text
              key={`gx-${g}`}
              x={sx(g)}
              y={sy(0) + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#94a3b8"
            >
              {Math.round(g * 100)}%
            </text>
          ))}
          {/* Ejes base */}
          <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(0)} stroke="#cbd5e1" strokeWidth="1" />
          <line x1={sx(0)} y1={sy(0)} x2={sx(0)} y2={sy(1)} stroke="#cbd5e1" strokeWidth="1" />

          {/* Zona que SÍ se alcanza a cubrir en un año (capacidad operativa) */}
          <rect
            x={sx(0)}
            y={sy(1)}
            width={sx(cobertura) - sx(0)}
            height={sy(0) - sy(1)}
            fill={COLOR_CAPACIDAD}
            opacity="0.08"
          />

          {/* Diagonal de referencia (azar puro) */}
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(1)}
            y2={sy(1)}
            stroke="#e2e8f0"
            strokeWidth="1"
            strokeDasharray="2 3"
          />

          {/* Marca del 50% del esfuerzo */}
          <line
            x1={sx(0.5)}
            y1={sy(0)}
            x2={sx(0.5)}
            y2={sy(1)}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Curvas */}
          <path d={pathDesde(tradicional.curva)} fill="none" stroke={COLOR_TRAD} strokeWidth="2" strokeDasharray="4 3" />
          <path d={pathDesde(modelo.curva)} fill="none" stroke={COLOR_MODELO} strokeWidth="2.5" />

          {/* Puntos de detección @50% con etiqueta */}
          <circle cx={sx(0.5)} cy={sy(detTrad)} r="3.5" fill={COLOR_TRAD} />
          <circle cx={sx(0.5)} cy={sy(detModelo)} r="4.5" fill={COLOR_MODELO} stroke="#fff" strokeWidth="1.5" />

          {/* Marcador de capacidad operativa (hasta dónde se cubre en un año) */}
          <line
            x1={sx(cobertura)}
            y1={sy(0)}
            x2={sx(cobertura)}
            y2={sy(1)}
            stroke={COLOR_CAPACIDAD}
            strokeWidth="1.5"
          />
          <circle cx={sx(cobertura)} cy={sy(detTradCob)} r="3.5" fill={COLOR_TRAD} stroke="#fff" strokeWidth="1.5" />
          <circle cx={sx(cobertura)} cy={sy(detModeloCob)} r="4.5" fill={COLOR_MODELO} stroke="#fff" strokeWidth="1.5" />
          <text
            x={Math.min(sx(cobertura) + 4, VW - 4)}
            y={sy(1) + 10}
            textAnchor={sx(cobertura) > VW - 70 ? "end" : "start"}
            fontSize="9.5"
            fontWeight="700"
            fill={COLOR_CAPACIDAD}
          >
            cubierto en 1 año ({pct(cobertura)})
          </text>

          {/* Overlay de visitas reales de la sesión */}
          {puntosVivos.map(({ v, x, y }) => (
            <circle
              key={v.establecimientoId}
              cx={sx(x)}
              cy={sy(y)}
              r="5"
              fill={v.veredicto.color}
              stroke="#fff"
              strokeWidth="1.5"
            />
          ))}

          {/* Crosshair de hover */}
          {hoverX !== null && hoverDet && (
            <g>
              <line
                x1={sx(hoverX)}
                y1={sy(0)}
                x2={sx(hoverX)}
                y2={sy(1)}
                stroke="#94a3b8"
                strokeWidth="1"
              />
              <circle cx={sx(hoverX)} cy={sy(hoverDet.modelo)} r="3.5" fill={COLOR_MODELO} />
              <circle cx={sx(hoverX)} cy={sy(hoverDet.trad)} r="3.5" fill={COLOR_TRAD} />
              <g transform={`translate(${Math.min(sx(hoverX) + 8, VW - 118)}, ${PAD_T + 6})`}>
                <rect width="112" height="52" rx="6" fill="#0f172a" opacity="0.92" />
                <text x="8" y="15" fontSize="10" fill="#e2e8f0">
                  {Math.round(hoverX * 100)}% de las visitas
                </text>
                <text x="8" y="30" fontSize="10" fill="#c4b5fd">
                  ● Modelo: {pct(hoverDet.modelo)}
                </text>
                <text x="8" y="44" fontSize="10" fill="#cbd5e1">
                  ● Reactivo: {pct(hoverDet.trad)}
                </text>
              </g>
            </g>
          )}

          {/* Títulos de eje */}
          <text
            x={PAD_L + PLOT_W / 2}
            y={VH - 4}
            textAnchor="middle"
            fontSize="11"
            fill="#64748b"
            fontWeight="600"
          >
            % de inspecciones realizadas
          </text>
          <text
            transform={`translate(12, ${PAD_T + PLOT_H / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="11"
            fill="#64748b"
            fontWeight="600"
          >
            % de violaciones críticas detectadas
          </text>
        </svg>

        <p className="text-[11px] text-gray-500 leading-relaxed px-1 mt-1">
          A mitad de las inspecciones (línea del 50%), el orden del modelo ya
          encontró el <strong className="text-violet-700">{pct(detModelo)}</strong>{" "}
          de las violaciones críticas frente al{" "}
          <strong>{pct(detTrad)}</strong> del orden reactivo — misma cantidad de
          inspectores, mismo esfuerzo. La diagonal punteada es el azar puro.
        </p>
      </div>
        </div>
      </div>

      {/* Cierre del pitch + disclaimer honesto */}
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3">
        <p className="text-sm text-gray-700 leading-relaxed">
          <strong className="text-violet-800">El cierre del pitch:</strong> Chicago
          tenía 32 inspectores para 15.000 restaurantes. En vez de contratar más,
          ordenaron las visitas por riesgo con datos públicos y encontraron las
          violaciones críticas antes, subiendo la detección temprana del 55% al 69%.
          Este reto es exactamente ese problema — y aquí lo montamos sobre Pereira
          Reporta.
        </p>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        * Backtest con ground-truth simulado, <strong>determinista y auditable</strong>{" "}
        (probabilidad de violación convexa sobre el score; el orden reactivo se
        promedia sobre {"120"} barajados). Mide <strong>velocidad de detección</strong>,
        no reducción de intoxicaciones — mismo matiz honesto que la validación de
        Chicago. Se ofrecen solo localidades con ≥ {MIN_N_LOCALIDAD} establecimientos,
        por representatividad de la muestra.
      </p>
    </div>
  );
}
