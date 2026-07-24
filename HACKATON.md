ESTOY EN UNA HACKATON DONDE ESTE ES EL RETO 

Hackathon EstadoX: Inspección sanitaria inteligente para 400.000 vigilados
El problema

Bogotá tiene aproximadamente 400.000 establecimientos sujetos a vigilancia sanitaria: restaurantes, panaderías, tiendas de barrio, consultorios médicos y odontológicos, laboratorios clínicos, droguerías, peluquerías, gimnasios, piscinas, jardines infantiles con servicio de alimentación, plantas de procesamiento, entre otros. La Secretaría de Salud cuenta con unos pocos cientos de técnicos de saneamiento para cubrir ese universo. La cuenta no da: si cada inspector visitara cinco establecimientos al día, los 250 días laborales del año no alcanzarían para cubrir ni una fracción del total.

El resultado es un sistema que funciona por inercia y por petición. Se visita al establecimiento que alguien denunció, al que toca por programación anual sin criterio de riesgo, o al que ya causó un brote. El restaurante de alta rotación en zona escolar que nunca ha tenido una queja formal pero tiene prácticas de manipulación riesgosas pasa años sin ser visitado. El consultorio odontológico que esteriliza mal su instrumental no aparece en el radar hasta que hay un evento adverso. Mientras tanto, el inspector gasta horas visitando establecimientos de bajo riesgo que cumplen por cultura organizacional y que no necesitaban la visita.

No existe un modelo de priorización basado en riesgo real. No hay cruce sistemático de datos entre las fuentes que ya existen: quejas en el SDQS, reportes de intoxicación del SIVIGILA, resultados de visitas anteriores, concepto sanitario vigente o vencido, tipo de población atendida (niños, pacientes, adultos mayores), densidad de establecimientos por zona, e incluso señales indirectas como calificaciones en plataformas de domicilios o comentarios en Google Maps.
El reto

Diseñen una solución que use inteligencia artificial para transformar la inspección sanitaria de un modelo reactivo y aleatorio a uno predictivo y focalizado, abordando al menos dos de los siguientes ejes:
Ejes de la solución

¿Cómo puede un modelo de IA asignar a cada establecimiento vigilado un puntaje dinámico de riesgo que combine variables objetivas (tipo de establecimiento, antigüedad del concepto sanitario, historial de visitas, resultados previos, población atendida) con señales no estructuradas (quejas ciudadanas, reportes epidemiológicos, reseñas en plataformas digitales) para que el inspector visite primero donde el riesgo es mayor?

¿Cómo puede un algoritmo generar la agenda diaria del inspector agrupando visitas por proximidad, intercalando establecimientos de alto riesgo con verificaciones rápidas a establecimientos cercanos, y garantizando que ninguna UPZ pase más de un umbral de tiempo sin presencia institucional?

¿Cómo puede la tecnología habilitar un canal donde los propios establecimientos reporten condiciones sanitarias mediante checklists guiados, fotografías con validación de IA (¿la cadena de frío está en rango?, ¿hay evidencia visible de plagas?, ¿los registros de limpieza están al día?) y esos autorreportes alimenten el modelo de riesgo — reduciendo la necesidad de visita presencial en establecimientos que demuestran cumplimiento continuo?

¿Cómo puede un sistema cruzar en tiempo real los reportes de SIVIGILA (enfermedades transmitidas por alimentos), las consultas de urgencias por sintomatología gastrointestinal georreferenciadas, y las quejas ciudadanas para identificar clusters geográficos que sugieran un establecimiento como fuente probable antes de que el brote escale — y despachar al inspector con la hipótesis ya armada?

ESTA ES LA RUTA DONDE ANDAMOS TRABAJANDO

---

## Estado de la solución (los 4 ejes implementados)

Ruta pública: `/inspeccion-sanitaria` — un solo mapa con toggle de 4 modos.

- **Eje 1 — Puntaje dinámico de riesgo** ✅ score auditable 0–100 con desglose factor por factor.
- **Eje 2 — Agenda diaria del inspector** ✅ ruta por proximidad, intercalado 2+1, alerta de UPZ desatendida.
- **Eje 3 — Autovigilancia asistida + reporte ciudadano** ✅
  - **(a) Autorreporte del establecimiento:** encuesta guiada por tipo (módulos A–G) con fotos validadas por IA. Los hallazgos suman al factor `resultado_anterior` (0–15) y el score se **recalcula en vivo**. *No autorreportado = riesgo no descartado.*
  - **(b) Reporte del ciudadano de a pie:** cualquier persona toca un establecimiento en el mapa y reporta con foto + comentario (ej. una rata). Suma a `quejas_ciudadanas` y se inyecta como caso en el Eje 4.
- **Eje 4 — Detección de clusters de brotes** ✅ cruza SIVIGILA + urgencias + quejas ciudadanas (incluidas las del Eje 3b) y propone fuente probable.
- **Cierre del pitch — Backtest estilo Chicago** ✅ 4º modo: sobre un ground-truth simulado y auditable compara el orden del modelo vs el reactivo/aleatorio y grafica que el modelo detecta ≈69% de las violaciones críticas a mitad de periodo (vs ≈50%), replicando el número de Chicago.

Detalle completo, fórmulas y mapa de archivos: `docs/propuesta-inspeccion-sanitaria.md`.