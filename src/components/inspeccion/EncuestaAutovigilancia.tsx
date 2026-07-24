"use client";

import { useMemo, useState } from "react";
import { PhotoUpload } from "@/components/report/PhotoUpload";
import {
  type Establecimiento,
  NIVEL_CONFIG,
} from "@/data/inspeccion";
import {
  type EstadoRespuesta,
  type Respuestas,
  type TipoEvidencia,
  type OpcionRespuesta,
  type PreguntaCalculada,
  EVIDENCIA_LABEL,
  TIPO_AUTORREPORTE_LABEL,
  PUNTOS_RESULTADO_ANTERIOR,
  encuestaParaTipo,
  desglosarAutorreporte,
  recalcularConFactor,
  tipoDesdeCategoria,
  estadoDesdeNumero,
} from "@/lib/autorreporte";
import { type Cluster } from "@/lib/brotes";
import { contradiccionSeguroBajoBrote } from "@/lib/integridad";
import {
  X,
  Camera,
  Check,
  AlertTriangle,
  ClipboardCheck,
  ShieldCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface Props {
  establecimiento: Establecimiento;
  clusters: Cluster[];
  onCerrar: () => void;
  onAplicar: (actualizado: Establecimiento) => void;
}

const EVIDENCIA_ICONO: Record<TipoEvidencia, React.ReactNode> = {
  "foto-ia": <Camera size={12} />,
  numerico: <span className="font-bold text-[11px]">#</span>,
  texto: <span className="font-bold text-[11px]">✎</span>,
  opcion: <ClipboardCheck size={12} />,
};

export default function EncuestaAutovigilancia({
  establecimiento,
  clusters,
  onCerrar,
  onAplicar,
}: Props) {
  const tipo = useMemo(
    () => tipoDesdeCategoria(establecimiento.categoria),
    [establecimiento.categoria]
  );
  const modulos = useMemo(() => encuestaParaTipo(tipo), [tipo]);
  const [respuestas, setRespuestas] = useState<Respuestas>({});

  const desglose = useMemo(
    () => desglosarAutorreporte(tipo, respuestas),
    [tipo, respuestas]
  );
  const resultado = desglose.total;

  // Regla anti-envenenamiento `seguro-bajo-brote`: si el establecimiento es la
  // fuente probable de un cluster activo, el autorreporte NO puede bajar el
  // riesgo (solo lo verifica un inspector). Se permite que suba, nunca que baje.
  const contradiccion = useMemo(
    () => contradiccionSeguroBajoBrote(establecimiento, clusters),
    [establecimiento, clusters]
  );
  const bloqueado = contradiccion !== null;
  const resultadoEfectivo = bloqueado
    ? Math.max(resultado, establecimiento.desglose.resultado_anterior)
    : resultado;

  // Vista previa del establecimiento con el nuevo factor resultado_anterior.
  const preview = useMemo(
    () =>
      recalcularConFactor(
        establecimiento,
        "resultado_anterior",
        resultadoEfectivo
      ),
    [establecimiento, resultadoEfectivo]
  );

  const cfgAntes = NIVEL_CONFIG[establecimiento.nivel_riesgo];
  const cfgDespues = NIVEL_CONFIG[preview.nivel_riesgo];
  const subeNivel = Math.round(preview.score) > Math.round(establecimiento.score);

  const totalPreguntas = modulos.reduce((s, m) => s + m.preguntas.length, 0);
  const contestadas = modulos.reduce(
    (s, m) =>
      s +
      m.preguntas.filter((p) => {
        const e = respuestas[p.id]?.estado;
        return e === "favorable" || e === "desfavorable";
      }).length,
    0
  );

  // Marca manual (foto, texto o numérico sin rango). Vuelve a "sin reportar" si
  // se toca el mismo botón; conserva el valor crudo ya escrito.
  function marcar(id: string, estado: EstadoRespuesta) {
    setRespuestas((r) => {
      const actual = r[id];
      const nuevo = actual?.estado === estado ? "sin_dato" : estado;
      return { ...r, [id]: { ...actual, estado: nuevo } };
    });
  }

  // Número: guarda el valor crudo y, si la pregunta tiene rango, deriva el estado.
  function cambiarNumero(p: PreguntaCalculada, raw: string) {
    setRespuestas((r) => {
      if (raw === "") {
        const { [p.id]: _omit, ...resto } = r;
        return resto;
      }
      const num = Number(raw);
      const estado =
        p.rango && !Number.isNaN(num)
          ? estadoDesdeNumero(p.rango, num)
          : r[p.id]?.estado ?? "sin_dato";
      return { ...r, [p.id]: { estado, valor: raw } };
    });
  }

  // Texto: guarda la declaración; el estado lo fijan los botones manuales.
  function cambiarTexto(p: PreguntaCalculada, raw: string) {
    setRespuestas((r) => ({
      ...r,
      [p.id]: { estado: r[p.id]?.estado ?? "sin_dato", valor: raw },
    }));
  }

  // Opción: cada opción ya trae su estado. Reelegir la misma la deja sin reportar.
  function elegirOpcion(p: PreguntaCalculada, opt: OpcionRespuesta) {
    setRespuestas((r) => {
      if (r[p.id]?.valor === opt.label) {
        const { [p.id]: _omit, ...resto } = r;
        return resto;
      }
      return { ...r, [p.id]: { estado: opt.estado, valor: opt.label } };
    });
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg h-[92vh] sm:h-[88vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Encabezado */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-pereira-red uppercase tracking-wide flex items-center gap-1">
                <ClipboardCheck size={13} /> Autovigilancia asistida · Eje 3
              </p>
              <h3 className="text-base font-bold text-gray-900 leading-tight mt-0.5">
                {establecimiento.nombre}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Perfil: {TIPO_AUTORREPORTE_LABEL[tipo]}
              </p>
            </div>
            <button
              onClick={onCerrar}
              className="text-gray-400 hover:text-gray-700 transition-colors shrink-0"
              aria-label="Cerrar encuesta"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            Reporte cada punto con honestidad. Mientras un ítem no se reporte, el
            sistema asume el peor caso (riesgo no descartado).
          </p>
        </div>

        {/* Cuerpo: módulos y preguntas */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {modulos.map((m) => (
            <div key={m.key}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-900 text-white text-[11px] font-black">
                    {m.key}
                  </span>
                  {m.label}
                </p>
                <span className="text-[11px] text-gray-400">
                  {m.puntosModulo.toFixed(2)} pts
                </span>
              </div>

              <div className="space-y-3">
                {m.preguntas.map((p) => {
                  const respuesta = respuestas[p.id];
                  const estado = respuesta?.estado ?? "sin_dato";
                  const valor = respuesta?.valor;
                  // Los botones manuales solo aplican cuando el estado no se
                  // deriva del valor (foto, texto o numérico sin rango).
                  const mostrarBotones =
                    p.tipoEvidencia === "foto-ia" ||
                    p.tipoEvidencia === "texto" ||
                    (p.tipoEvidencia === "numerico" && !p.rango);
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-gray-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-700 leading-snug">
                          {p.texto}
                        </p>
                        <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
                          {p.puntos.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">
                          {EVIDENCIA_ICONO[p.tipoEvidencia]}
                          {EVIDENCIA_LABEL[p.tipoEvidencia]}
                        </span>
                      </div>

                      {p.ayudaIA && (
                        <p className="text-[11px] text-indigo-600 mt-1.5 flex items-start gap-1">
                          <Sparkles size={11} className="mt-0.5 shrink-0" />
                          {p.ayudaIA}
                        </p>
                      )}

                      {/* Foto validada por IA */}
                      {p.tipoEvidencia === "foto-ia" && (
                        <div className="mt-2">
                          <PhotoUpload onPhotoUploaded={() => {}} />
                        </div>
                      )}

                      {/* Dato numérico */}
                      {p.tipoEvidencia === "numerico" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={typeof valor === "string" ? valor : ""}
                            onChange={(e) => cambiarNumero(p, e.target.value)}
                            placeholder={p.placeholder}
                            className="w-28 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-pereira-red"
                          />
                          {p.rango?.unidad && (
                            <span className="text-xs text-gray-500">
                              {p.rango.unidad}
                            </span>
                          )}
                          {p.rango && (
                            <span className="text-[11px] text-gray-400">
                              rango {p.rango.min}–{p.rango.max}
                              {p.rango.unidad ? ` ${p.rango.unidad}` : ""}
                            </span>
                          )}
                          {p.rango && estado !== "sin_dato" && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                                estado === "favorable"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {estado === "favorable" ? (
                                <>
                                  <Check size={11} /> En regla
                                </>
                              ) : (
                                <>
                                  <AlertTriangle size={11} /> Hallazgo
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Declaración de texto */}
                      {p.tipoEvidencia === "texto" && (
                        <textarea
                          rows={2}
                          value={typeof valor === "string" ? valor : ""}
                          onChange={(e) => cambiarTexto(p, e.target.value)}
                          placeholder={p.placeholder}
                          className="mt-2 w-full resize-y rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-pereira-red"
                        />
                      )}

                      {/* Selección de una opción */}
                      {p.tipoEvidencia === "opcion" && p.opciones && (
                        <div className="mt-2 space-y-1.5">
                          {p.opciones.map((opt, idx) => {
                            const sel = valor === opt.label;
                            const fav = opt.estado === "favorable";
                            return (
                              <button
                                key={idx}
                                onClick={() => elegirOpcion(p, opt)}
                                className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs text-left transition-all ${
                                  sel
                                    ? fav
                                      ? "bg-green-50 border-green-500 text-green-800"
                                      : "bg-red-50 border-red-500 text-red-800"
                                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border shrink-0 ${
                                    sel
                                      ? fav
                                        ? "bg-green-500 border-green-500"
                                        : "bg-red-500 border-red-500"
                                      : "border-gray-300"
                                  }`}
                                />
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Botones de estado (solo captura manual) */}
                      {mostrarBotones && (
                        <div className="grid grid-cols-2 gap-2 mt-2.5">
                          <button
                            onClick={() => marcar(p.id, "favorable")}
                            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold border transition-all ${
                              estado === "favorable"
                                ? "bg-green-600 border-green-600 text-white"
                                : "bg-white border-gray-200 text-gray-600 hover:border-green-300"
                            }`}
                          >
                            <Check size={13} /> En regla
                          </button>
                          <button
                            onClick={() => marcar(p.id, "desfavorable")}
                            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold border transition-all ${
                              estado === "desfavorable"
                                ? "bg-red-600 border-red-600 text-white"
                                : "bg-white border-gray-200 text-gray-600 hover:border-red-300"
                            }`}
                          >
                            <AlertTriangle size={13} /> Hallazgo
                          </button>
                        </div>
                      )}

                      {/* Confianza de la respuesta favorable: verificable vs. solo declarada */}
                      {estado === "favorable" && (
                        <p
                          className={`text-[10px] mt-1.5 flex items-center gap-1 ${
                            p.tipoEvidencia === "foto-ia"
                              ? "text-green-600"
                              : "text-amber-600"
                          }`}
                        >
                          {p.tipoEvidencia === "foto-ia" ? (
                            <>
                              <ShieldCheck size={10} /> Verificable con la foto:
                              baja el riesgo por completo.
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={10} /> Declarado sin prueba:
                              queda sin verificar (baja solo la mitad).
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Pie: resultado en vivo + aplicar */}
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className="text-xs text-gray-500">
              <p>
                {contestadas}/{totalPreguntas} ítems reportados
              </p>
              <p className="font-semibold text-gray-700 mt-0.5">
                Riesgo autorreporte: {resultado.toFixed(1)} /{" "}
                {PUNTOS_RESULTADO_ANTERIOR}
              </p>
              {desglose.provisional > 0.05 && (
                <p className="text-amber-600 mt-0.5 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {desglose.provisional.toFixed(1)} pts sin verificar (declarados
                  sin foto)
                </p>
              )}
            </div>

            {/* Antes -> Después */}
            <div className="flex items-center gap-2">
              <div
                className="flex flex-col items-center rounded-lg px-2.5 py-1 text-white"
                style={{ backgroundColor: cfgAntes.color }}
              >
                <span className="text-lg font-black leading-none">
                  {Math.round(establecimiento.score)}
                </span>
                <span className="text-[9px] uppercase opacity-90">antes</span>
              </div>
              <ArrowRight size={16} className="text-gray-400" />
              <div
                className="flex flex-col items-center rounded-lg px-2.5 py-1 text-white"
                style={{ backgroundColor: cfgDespues.color }}
              >
                <span className="text-lg font-black leading-none">
                  {Math.round(preview.score)}
                </span>
                <span className="text-[9px] uppercase opacity-90">después</span>
              </div>
            </div>
          </div>

          {/* Contradicción crítica con datos de salud independientes (Reto 4) */}
          {contradiccion && (
            <div className="mb-2 rounded-lg border border-red-300 bg-red-50 p-2.5">
              <p className="text-[11px] font-bold text-red-700 flex items-center gap-1">
                <AlertTriangle size={12} className="shrink-0" />
                Contradicción crítica · seguro-bajo-brote
              </p>
              <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                Este establecimiento es la <strong>fuente probable</strong> del
                Cluster #{contradiccion.cluster.id} (
                {contradiccion.numCasos} casos en {contradiccion.ventanaHoras}h:
                SIVIGILA/urgencias/quejas). El autorreporte{" "}
                <strong>no puede bajar el riesgo</strong> hasta que un inspector
                lo verifique: las fuentes de salud no las controla el
                establecimiento.
              </p>
            </div>
          )}

          {preview.nivel_riesgo !== establecimiento.nivel_riesgo && (
            <p
              className={`text-[11px] mb-2 flex items-center gap-1 ${
                subeNivel ? "text-red-600" : "text-green-600"
              }`}
            >
              {subeNivel ? (
                <AlertTriangle size={12} />
              ) : (
                <ShieldCheck size={12} />
              )}
              El nivel pasaría de <strong>{cfgAntes.label}</strong> a{" "}
              <strong>{cfgDespues.label}</strong>.
            </p>
          )}

          <button
            onClick={() => onAplicar(preview)}
            className="w-full bg-pereira-red text-white rounded-lg py-2.5 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
          >
            {bloqueado
              ? "Registrar autorreporte (sin bajar el riesgo)"
              : "Aplicar autorreporte al score"}
          </button>
        </div>
      </div>
    </div>
  );
}
