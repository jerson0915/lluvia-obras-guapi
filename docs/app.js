// Dashboard de lluvia y obras en Guapi.
// Lee datos.json (generado por scripts/procesar_datos.py) y dibuja todo con SVG, sin librerías.

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORES = ["verde", "amarillo", "rojo"];
const NOMBRE_COLOR = { verde: "Apto", amarillo: "Con precaución", rojo: "No recomendado" };
const ICONOS = {
  verde: '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--verde)"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  amarillo: '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L23 21H1z" fill="var(--amarillo)" stroke-linejoin="round"/><rect x="11" y="9" width="2.2" height="6.5" rx="1" fill="#0b0b0b"/><circle cx="12.1" cy="18" r="1.3" fill="#0b0b0b"/></svg>',
  rojo: '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--rojo)"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

let DATOS = null;

// ---------- Utilidades ----------

const $ = (selector) => document.querySelector(selector);
const num = (valor, decimales = 1) =>
  valor == null ? "—" : Number(valor).toLocaleString("es-CO", { maximumFractionDigits: decimales });
const fechaCorta = (iso) =>
  new Date(iso + "T12:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
const hora = (h) => `${String(h).padStart(2, "0")}:00`;

// Se dibuja con el ancho real del contenedor para que el texto conserve su tamaño en el celular.
// Si la pestaña está oculta (ancho 0) se usa 640 y se vuelve a dibujar al abrirla.
const anchoDe = (contenedor) => Math.max(300, Math.round(contenedor.clientWidth || 640));

function svg(ancho, alto) {
  const elemento = document.createElementNS(SVG_NS, "svg");
  elemento.setAttribute("viewBox", `0 0 ${ancho} ${alto}`);
  elemento.setAttribute("role", "img");
  // Degradado de las barras de lluvia: cian arriba, azul abajo.
  elemento.innerHTML = '<defs><linearGradient id="degradado-lluvia" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" style="stop-color:var(--lluvia-alta)"/><stop offset="1" style="stop-color:var(--lluvia-baja)"/>' +
    "</linearGradient></defs>";
  return elemento;
}

function agregar(padre, etiqueta, atributos = {}, texto) {
  const elemento = document.createElementNS(SVG_NS, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) elemento.setAttribute(clave, valor);
  if (texto != null) elemento.textContent = texto;
  padre.appendChild(elemento);
  return elemento;
}

// Barra con las esquinas superiores redondeadas (4 px) y la base plana sobre el eje.
function rutaBarra(x, y, ancho, alto, radio = 4) {
  const r = Math.max(0, Math.min(radio, ancho / 2, alto));
  return `M${x},${y + alto}V${y + r}Q${x},${y} ${x + r},${y}H${x + ancho - r}Q${x + ancho},${y} ${x + ancho},${y + r}V${y + alto}Z`;
}

function escalaBonita(maximo) {
  const pasos = [1, 2, 2.5, 5, 10];
  const bruto = maximo / 4;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const paso = pasos.find((p) => p * potencia >= bruto) * potencia;
  return { paso, tope: Math.max(paso, Math.ceil(maximo / paso) * paso) };
}

// ---------- Información emergente (tooltip) ----------

function activarInfo() {
  const info = $("#info");
  const mostrar = (evento) => {
    const objetivo = evento.target.closest("[data-info]");
    if (!objetivo) { info.style.display = "none"; return; }
    info.innerHTML = objetivo.dataset.info;
    info.style.display = "block";
    const x = Math.min(evento.clientX + 14, window.innerWidth - info.offsetWidth - 8);
    const y = evento.clientY + 14 + info.offsetHeight > window.innerHeight
      ? evento.clientY - info.offsetHeight - 10 : evento.clientY + 14;
    info.style.left = `${Math.max(8, x)}px`;
    info.style.top = `${y}px`;
  };
  document.addEventListener("mousemove", mostrar);
  document.addEventListener("click", mostrar);
  document.addEventListener("scroll", () => (info.style.display = "none"), { passive: true });
}

// ---------- Gráfica de barras genérica ----------

function graficaBarras(contenedor, items, { unidad = "mm", alto = 220, sufijoEje = "" } = {}) {
  const ancho = anchoDe(contenedor);
  const margen = { arriba: 12, derecha: 8, abajo: 34, izquierda: 40 };
  const valores = items.map((i) => i.valor ?? 0).concat(items.map((i) => i.ref ?? 0));
  const { paso, tope } = escalaBonita(Math.max(...valores, 1));
  const lienzo = svg(ancho, alto);
  const areaAncho = ancho - margen.izquierda - margen.derecha;
  const areaAlto = alto - margen.arriba - margen.abajo;
  const y = (v) => margen.arriba + areaAlto - (v / tope) * areaAlto;

  for (let v = 0; v <= tope; v += paso) {
    agregar(lienzo, "line", { class: v === 0 ? "eje" : "rejilla", x1: margen.izquierda, x2: ancho - margen.derecha, y1: y(v), y2: y(v) });
    agregar(lienzo, "text", { x: margen.izquierda - 6, y: y(v) + 4, "text-anchor": "end" }, num(v, 1) + sufijoEje);
  }
  const banda = areaAncho / items.length;
  const anchoBarra = Math.min(48, banda - 2);
  items.forEach((item, i) => {
    const x = margen.izquierda + i * banda + (banda - anchoBarra) / 2;
    const valor = item.valor ?? 0;
    agregar(lienzo, "path", { class: "barra", d: rutaBarra(x, y(valor), anchoBarra, y(0) - y(valor)) });
    if (item.ref != null) {
      agregar(lienzo, "line", { class: "referencia", x1: x - 3, x2: x + anchoBarra + 3, y1: y(item.ref), y2: y(item.ref) });
    }
    // Si la etiqueta no cabe (por ejemplo, años en el celular), se usa la versión corta.
    const etiqueta = item.etiquetaCorta && banda < item.etiqueta.length * 7.5 ? item.etiquetaCorta : item.etiqueta;
    agregar(lienzo, "text", { x: x + anchoBarra / 2, y: alto - margen.abajo + 16, "text-anchor": "middle" }, etiqueta);
    if (item.etiqueta2) {
      agregar(lienzo, "text", { x: x + anchoBarra / 2, y: alto - margen.abajo + 29, "text-anchor": "middle" }, item.etiqueta2);
    }
    // Zona de interacción más grande que la barra.
    agregar(lienzo, "rect", {
      class: "objetivo", x: margen.izquierda + i * banda, y: margen.arriba, width: banda, height: areaAlto,
      "data-info": item.info ?? `${item.etiqueta}: ${num(valor)} ${unidad}`,
    });
  });
  contenedor.replaceChildren(lienzo);
}

// ---------- Pestaña: Esta semana ----------

function pintarSemana() {
  const dias = DATOS.pronostico;
  const actividades = DATOS.actividades;
  const tabla = $("#tabla-semaforo");

  let html = "<thead><tr><th></th>";
  for (const dia of dias) {
    const confianza = dia.dias_adelante <= 2 ? "Más confiable" : "Orientativo";
    html += `<th><span class="dia-cab">${fechaCorta(dia.fecha)}<small>${num(dia.lluvia_dia)} mm · ${dia.prob_max ?? "—"} %</small></span><span class="confianza">${confianza}</span></th>`;
  }
  html += "</tr></thead><tbody>";
  for (const actividad of actividades) {
    html += `<tr><th class="act" scope="row">${actividad.nombre}</th>`;
    for (const dia of dias) {
      const { color, motivos } = dia.semaforo[actividad.id];
      const ventana = dia.ventana_seca > 0
        ? `Mejor ventana seca: ${hora(dia.ventana_inicio)}–${hora(dia.ventana_fin)} (${dia.ventana_seca} h)`
        : "Sin horas secas en la jornada";
      const info = `<strong>${actividad.nombre} · ${fechaCorta(dia.fecha)}</strong><br>${NOMBRE_COLOR[color]}<br>` +
        `Lluvia en la jornada: ${num(dia.lluvia_jornada)} mm<br>${ventana}<br>Lluvia en 3 días: ${num(dia.lluvia_3d)} mm` +
        (motivos.length ? `<br><em>${motivos.join("<br>")}</em>` : "");
      html += `<td><div class="celda ${color}" data-info="${info.replace(/"/g, "&quot;")}">${ICONOS[color]}${NOMBRE_COLOR[color]}</div></td>`;
    }
    html += "</tr>";
  }
  tabla.innerHTML = html + "</tbody>";

  $("#leyenda-semaforo").innerHTML = COLORES
    .map((c) => `<span>${ICONOS[c]}${NOMBRE_COLOR[c]}</span>`).join("") +
    "<span>Bajo cada fecha: lluvia del día · probabilidad máxima</span>";

  graficaBarras($("#grafica-dias"), dias.map((d) => ({
    etiqueta: fechaCorta(d.fecha).split(" ")[0].replace(/[,.]/g, ""),
    etiqueta2: d.fecha.slice(8, 10),
    valor: d.lluvia_dia,
    ref: d.lluvia_normal_dia,
    info: `<strong>${fechaCorta(d.fecha)}</strong><br>Pronóstico: ${num(d.lluvia_dia)} mm<br>Normal del mes: ${num(d.lluvia_normal_dia)} mm/día<br>Probabilidad máxima: ${d.prob_max ?? "—"} %`,
  })));

  pintarHoras(dias);
}

function pintarHoras(dias) {
  const ancho = anchoDe($("#grafica-horas")), alto = 200, margen = { arriba: 12, derecha: 8, abajo: 30, izquierda: 40 };
  const horas = dias.flatMap((d) => d.horas.map((h) => ({ ...h, fecha: d.fecha })));
  const { paso, tope } = escalaBonita(Math.max(...horas.map((h) => h.mm), 1));
  const lienzo = svg(ancho, alto);
  const areaAncho = ancho - margen.izquierda - margen.derecha;
  const areaAlto = alto - margen.arriba - margen.abajo;
  const banda = areaAncho / horas.length;
  const y = (v) => margen.arriba + areaAlto - (v / tope) * areaAlto;
  const { hora_inicio, hora_fin } = DATOS.jornada;

  dias.forEach((d, i) => {
    const desplazamiento = horas.findIndex((h) => h.fecha === d.fecha);
    agregar(lienzo, "rect", {
      class: "jornada", x: margen.izquierda + (desplazamiento + hora_inicio) * banda, y: margen.arriba,
      width: (hora_fin - hora_inicio) * banda, height: areaAlto,
    });
    agregar(lienzo, "text", { x: margen.izquierda + (desplazamiento + 12) * banda, y: alto - 10, "text-anchor": "middle" },
      banda * 24 < 80 ? d.fecha.slice(8, 10) : fechaCorta(d.fecha).replace(/\./g, ""));
    if (i > 0) agregar(lienzo, "line", { class: "rejilla", x1: margen.izquierda + desplazamiento * banda, x2: margen.izquierda + desplazamiento * banda, y1: margen.arriba, y2: y(0) });
  });
  for (let v = 0; v <= tope; v += paso) {
    agregar(lienzo, "line", { class: v === 0 ? "eje" : "rejilla", x1: margen.izquierda, x2: ancho - margen.derecha, y1: y(v), y2: y(v) });
    agregar(lienzo, "text", { x: margen.izquierda - 6, y: y(v) + 4, "text-anchor": "end" }, num(v));
  }
  horas.forEach((h, i) => {
    const x = margen.izquierda + i * banda;
    if (h.mm > 0) agregar(lienzo, "path", { class: "barra", d: rutaBarra(x + 0.3, y(h.mm), Math.max(banda - 0.6, 1), y(0) - y(h.mm), 1.5) });
    agregar(lienzo, "rect", {
      class: "objetivo", x, y: margen.arriba, width: banda, height: areaAlto,
      "data-info": `<strong>${fechaCorta(h.fecha)} · ${hora(h.h)}</strong><br>${num(h.mm)} mm · probabilidad ${h.prob} %`,
    });
  });
  $("#grafica-horas").replaceChildren(lienzo);
}

// ---------- Pestaña: Planear mi obra ----------

function prepararPlanear() {
  const selActividad = $("#sel-actividad");
  const selMes = $("#sel-mes");
  selActividad.innerHTML = DATOS.actividades.map((a) => `<option value="${a.id}">${a.nombre}</option>`).join("");
  selMes.innerHTML = MESES_LARGOS.map((m, i) => `<option value="${i + 1}">${m[0].toUpperCase() + m.slice(1)}</option>`).join("");
  selMes.value = new Date().getMonth() + 1;
  selActividad.addEventListener("change", pintarPlanear);
  selMes.addEventListener("change", pintarPlanear);
}

function pintarPlanear() {
  const actividad = DATOS.actividades.find((a) => a.id === $("#sel-actividad").value);
  const mes = DATOS.clima_mensual[Number($("#sel-mes").value) - 1];
  const s = mes.semaforo[actividad.id];
  const diasMes = new Date(2025, mes.mes, 0).getDate();
  const aprovechables = Math.round((s.verde / 100) * diasMes);

  const segmentos = COLORES.filter((c) => s[c] > 0).map((c) =>
    `<div class="${c}" style="flex:${s[c]}" data-info="${NOMBRE_COLOR[c]}: ${s[c]} % de los días">${s[c] >= 8 ? s[c] + " %" : ""}</div>`).join("");

  $("#resumen-planear").innerHTML = `
    <p class="sub">${actividad.descripcion}</p>
    <div class="kpis">
      <div class="kpi"><div class="valor">≈ ${aprovechables} <small>de ${diasMes}</small></div><div class="etiqueta">días aptos en ${MESES_LARGOS[mes.mes - 1]}</div></div>
      <div class="kpi"><div class="valor">${num(mes.lluvia_tipica_mes, 0)} <small>mm</small></div><div class="etiqueta">lluvia típica del mes</div></div>
      <div class="kpi"><div class="valor">${mes.pct_dias_lluvia} <small>%</small></div><div class="etiqueta">días con lluvia (≥ 1 mm)</div></div>
      <div class="kpi"><div class="valor">${mes.pct_dias_fuertes} <small>%</small></div><div class="etiqueta">días de lluvia fuerte (≥ 20 mm)</div></div>
    </div>
    <div class="barra-apilada" role="img" aria-label="Apto ${s.verde} %, precaución ${s.amarillo} %, no recomendado ${s.rojo} %">${segmentos}</div>
    <div class="leyenda">${COLORES.map((c) => `<span>${ICONOS[c]}${NOMBRE_COLOR[c]} ${s[c]} %</span>`).join("")}</div>
    <p class="sub" style="margin-top:12px">Basado en ${s.dias} días registrados de ${MESES_LARGOS[mes.mes - 1]} (${mes.anios.join(", ")}).
      Confiabilidad del histórico: <strong>${mes.confiabilidad}</strong>.</p>`;

  $("#sub-meses").textContent = `Porcentaje de días aptos, con precaución y no recomendados para «${actividad.nombre.toLowerCase()}» en cada mes.`;
  pintarMesesApilados(actividad);
}

function pintarMesesApilados(actividad) {
  const ancho = anchoDe($("#grafica-verde-mes")), alto = 230, margen = { arriba: 10, derecha: 8, abajo: 28, izquierda: 40 };
  const lienzo = svg(ancho, alto);
  const areaAncho = ancho - margen.izquierda - margen.derecha;
  const areaAlto = alto - margen.arriba - margen.abajo;
  const banda = areaAncho / 12;
  const anchoBarra = Math.min(36, banda - 6);
  const y = (v) => margen.arriba + areaAlto - (v / 100) * areaAlto;
  const mesElegido = Number($("#sel-mes").value);

  for (let v = 0; v <= 100; v += 25) {
    agregar(lienzo, "line", { class: v === 0 ? "eje" : "rejilla", x1: margen.izquierda, x2: ancho - margen.derecha, y1: y(v), y2: y(v) });
    agregar(lienzo, "text", { x: margen.izquierda - 6, y: y(v) + 4, "text-anchor": "end" }, `${v} %`);
  }
  DATOS.clima_mensual.forEach((mes, i) => {
    const s = mes.semaforo[actividad.id];
    const x = margen.izquierda + i * banda + (banda - anchoBarra) / 2;
    let acumulado = 0;
    COLORES.forEach((c, k) => {
      if (!s[c]) return;
      const y0 = y(acumulado), y1 = y(acumulado + s[c]);
      const esUltimo = COLORES.slice(k + 1).every((otro) => !s[otro]);
      // 2 px de separación entre segmentos.
      const altoSeg = Math.max(0, y0 - y1 - (acumulado > 0 ? 2 : 0));
      agregar(lienzo, "path", {
        d: esUltimo ? rutaBarra(x, y1, anchoBarra, altoSeg) : `M${x},${y1}h${anchoBarra}v${altoSeg}h${-anchoBarra}Z`,
        fill: `var(--${c})`,
      });
      acumulado += s[c];
    });
    agregar(lienzo, "text", {
      x: x + anchoBarra / 2, y: alto - 10, "text-anchor": "middle",
      style: mes.mes === mesElegido ? "font-weight:700;fill:var(--texto)" : "",
    }, mes.nombre);
    agregar(lienzo, "rect", {
      class: "objetivo", x: margen.izquierda + i * banda, y: margen.arriba, width: banda, height: areaAlto,
      "data-info": `<strong>${MESES_LARGOS[i]}</strong><br>Apto: ${s.verde} %<br>Con precaución: ${s.amarillo} %<br>No recomendado: ${s.rojo} %<br>${s.dias} días de datos`,
    });
  });
  $("#grafica-verde-mes").replaceChildren(lienzo);
}

function pintarMapaHoras() {
  const ancho = anchoDe($("#mapa-horas")), celdaAlto = 22, margen = { arriba: 6, derecha: 4, abajo: 22, izquierda: 40 };
  const alto = margen.arriba + 12 * celdaAlto + margen.abajo;
  const lienzo = svg(ancho, alto);
  const celdaAncho = (ancho - margen.izquierda - margen.derecha) / 24;
  const pasos = 8;
  const maximo = Math.max(...DATOS.clima_mensual.flatMap((m) => m.prob_lluvia_hora.filter((v) => v != null)));
  const { hora_inicio, hora_fin } = DATOS.jornada;

  DATOS.clima_mensual.forEach((mes, fila) => {
    agregar(lienzo, "text", { x: margen.izquierda - 6, y: margen.arriba + fila * celdaAlto + 15, "text-anchor": "end" }, mes.nombre);
    mes.prob_lluvia_hora.forEach((p, h) => {
      const paso = p == null ? 0 : Math.min(pasos - 1, Math.round((p / maximo) * (pasos - 1)));
      agregar(lienzo, "rect", {
        class: "celda-mapa", x: margen.izquierda + h * celdaAncho, y: margen.arriba + fila * celdaAlto,
        width: celdaAncho, height: celdaAlto, rx: 3, fill: `var(--seq-${paso})`,
        "data-info": `<strong>${MESES_LARGOS[fila]} · ${hora(h)}</strong><br>Llueve en el ${p ?? "—"} % de los días a esta hora`,
      });
    });
  });
  for (let h = 0; h < 24; h += 3) {
    agregar(lienzo, "text", { x: margen.izquierda + (h + 0.5) * celdaAncho, y: alto - 6, "text-anchor": "middle" }, `${h}h`);
  }
  // Marco de la jornada laboral.
  agregar(lienzo, "rect", {
    x: margen.izquierda + hora_inicio * celdaAncho, y: margen.arriba - 2, width: (hora_fin - hora_inicio) * celdaAncho,
    height: 12 * celdaAlto + 4, fill: "none", stroke: "var(--texto-2)", "stroke-width": 1.5, "stroke-dasharray": "4 3", rx: 4,
  });
  $("#mapa-horas").replaceChildren(lienzo);
  const etiquetas = Array.from({ length: pasos }, (_, i) => `<span class="paso" style="background:var(--seq-${i})"></span>`).join("");
  $("#escala-mapa").innerHTML = `<span>0 %</span>${etiquetas}<span>${maximo} %</span><span style="margin-left:12px">Recuadro punteado: jornada ${hora(hora_inicio)}–${hora(hora_fin)}</span>`;
}

// ---------- Pestaña: Histórico ----------

function pintarHistorico() {
  const meses = DATOS.clima_mensual;
  graficaBarras($("#grafica-mensual"), meses.map((m) => ({
    etiqueta: m.nombre, valor: m.lluvia_tipica_mes,
    info: `<strong>${MESES_LARGOS[m.mes - 1]}</strong><br>${num(m.lluvia_tipica_mes, 0)} mm típicos<br>${m.dias_validos} días de datos · confiabilidad ${m.confiabilidad}`,
  })));
  graficaBarras($("#grafica-fuertes"), meses.map((m) => ({
    etiqueta: m.nombre, valor: m.pct_dias_fuertes,
    info: `<strong>${MESES_LARGOS[m.mes - 1]}</strong><br>${m.pct_dias_fuertes} % de días ≥ 20 mm<br>${m.pct_dias_muy_fuertes} % de días ≥ 50 mm`,
  })), { unidad: "%", sufijoEje: " %" });
  graficaBarras($("#grafica-anios"), DATOS.anios.map((a) => ({
    etiqueta: String(a.anio), etiquetaCorta: `'${String(a.anio).slice(2)}`, valor: a.dias_validos,
    info: `<strong>${a.anio}</strong><br>${a.dias_validos} días completos<br>Lluvia media: ${num(a.lluvia_media_dia)} mm/día`,
  })), { unidad: "días" });

  $("#tabla-mensual").innerHTML = "<tr><th>Mes</th><th>Lluvia típica (mm)</th><th>Días con lluvia</th><th>Días ≥ 20 mm</th><th>Días de datos</th><th>Confiabilidad</th></tr>" +
    meses.map((m) => `<tr><td>${MESES_LARGOS[m.mes - 1]}</td><td>${num(m.lluvia_tipica_mes, 0)}</td><td>${m.pct_dias_lluvia} %</td><td>${m.pct_dias_fuertes} %</td><td>${m.dias_validos}</td><td>${m.confiabilidad}</td></tr>`).join("");

  $("#tabla-record").innerHTML = "<tr><th>Fecha</th><th>Lluvia (mm)</th></tr>" +
    DATOS.dias_mas_lluviosos.map((d) => `<tr><td>${new Date(d.fecha + "T12:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}</td><td>${num(d.lluvia)}</td></tr>`).join("");
}

// ---------- Pestaña: Cómo leer esto ----------

function pintarLeer() {
  const e = DATOS.estacion;
  const v = DATOS.variables;
  const filasUmbrales = DATOS.actividades.map((a) => {
    const simbolo = { "<=": "≤", ">=": "≥", "<": "<", ">": ">" };
    const lista = (conds) => conds.map((c) => `${v[c.variable].nombre} ${simbolo[c.op]} ${num(c.valor)} ${v[c.variable].unidad}`).join("<br>");
    return `<tr><td>${a.nombre}</td><td>${lista(a.verde)}</td><td>${lista(a.rojo)}</td></tr>`;
  }).join("");

  $("#texto-leer").innerHTML = `
    <h2>Cómo leer este tablero</h2>

    <h3>Qué significa cada color</h3>
    <p>${ICONOS.verde} <strong>Apto:</strong> se cumplen <em>todas</em> las condiciones favorables.<br>
       ${ICONOS.rojo} <strong>No recomendado:</strong> se cumple <em>al menos una</em> condición desfavorable.<br>
       ${ICONOS.amarillo} <strong>Con precaución:</strong> ninguna de las dos anteriores; revisa el detalle y decide en obra.</p>
    <div class="desplazable"><table class="datos texto-izq">
      <tr><th>Actividad</th><th>Apto si…</th><th>No recomendado si…</th></tr>${filasUmbrales}
    </table></div>
    <p>La jornada considerada va de ${hora(DATOS.jornada.hora_inicio)} a ${hora(DATOS.jornada.hora_fin)}.
       Una hora cuenta como <strong>seca</strong> si llueve menos de ${num(DATOS.hora_seca.lluvia_max_mm)} mm
       y, en el pronóstico, la probabilidad de lluvia es menor al ${DATOS.hora_seca.probabilidad_max} %.
       <strong>Estos umbrales son provisionales</strong> y se ajustarán con constructores y maestros de obra de Guapi.</p>

    <h3>De dónde salen los datos</h3>
    <ul>
      <li><strong>Pronóstico (Esta semana):</strong> <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>,
        que combina modelos meteorológicos globales. Se actualiza cada día.</li>
      <li><strong>Histórico (Planear e Histórico):</strong> estación automática del IDEAM <em>${e.nombre}</em> (código ${e.codigo}),
        publicada en datos.gov.co. Se usan ${e.dias_validos} días completos entre ${e.primer_dia} y ${e.ultimo_dia}.</li>
    </ul>

    <h3>¿Qué tan confiable es?</h3>
    <ul>
      <li><strong>El histórico es una referencia, no una certeza.</strong> La estación tiene huecos grandes (2020–2021, 2024 y gran parte
        de 2023 y 2025 casi sin datos), así que cada mes se basa en solo ~80 a 130 días de 3 a 6 años distintos.
        Lo normal sería contar con 30 años. Por eso cada mes muestra su nivel de confiabilidad.</li>
      <li>Se descartaron los días con menos del 90 % de registros y ${e.dias_excluidos_sensor} días en rachas de 5 o más días
        seguidos con 0 mm, que en Guapi indican un sensor dañado más que un verano real.</li>
      <li><strong>El pronóstico acierta en el total, pero exagera los días lluviosos.</strong> Al compararlo con lo medido en 2026,
        el total pronosticado fue solo ~11 % mayor, pero anunció lluvia en más días de los que de verdad llovió
        (179 frente a 136). Es decir, un día en <em>amarillo</em> o <em>rojo</em> a veces termina siendo trabajable;
        uno en <em>verde</em> suele serlo.</li>
      <li>Los primeros 3 días del pronóstico son los más confiables; del 4.º al 7.º son solo orientativos.</li>
      <li>Los modelos de reanálisis global (ERA5) <strong>no se usan</strong> para el histórico: en Guapi calculan más del doble
        de la lluvia que mide la estación.</li>
    </ul>

    <h3>Lo que este tablero no hace</h3>
    <ul>
      <li>No predice inundaciones ni crecientes de los ríos.</li>
      <li>No emite alertas de emergencia: para eso están las <a href="http://www.pronosticosyalertas.gov.co/" target="_blank" rel="noopener">alertas del IDEAM</a>.</li>
      <li>No da recomendaciones técnicas para una obra específica ni decide por el constructor.</li>
    </ul>`;
}

// ---------- Pestañas ----------

function dibujar() {
  if (!DATOS) return;
  pintarSemana();
  pintarPlanear();
  pintarMapaHoras();
  pintarHistorico();
}

function activarPestanas() {
  const botones = document.querySelectorAll("nav.pestanas button");
  const abrir = (id) => {
    botones.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pestana === id)));
    document.querySelectorAll("main section, body section").forEach((s) => (s.hidden = s.id !== id));
    try { localStorage.setItem("pestana", id); } catch (_) { /* almacenamiento no disponible */ }
    dibujar();
  };
  botones.forEach((b) => b.addEventListener("click", () => abrir(b.dataset.pestana)));
  let guardada = null;
  try { guardada = localStorage.getItem("pestana"); } catch (_) { /* almacenamiento no disponible */ }
  if (guardada && document.getElementById(guardada)) abrir(guardada);
}

// ---------- Inicio ----------

async function iniciar() {
  activarPestanas();
  activarInfo();
  try {
    const respuesta = await fetch("datos.json", { cache: "no-store" });
    DATOS = await respuesta.json();
  } catch (error) {
    $("#actualizado").textContent = "No se pudieron cargar los datos. Intenta recargar la página.";
    return;
  }
  const fecha = new Date(DATOS.actualizado);
  const horasAtras = (Date.now() - fecha) / 36e5;
  $("#actualizado").textContent = `Última actualización: ${fecha.toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}` +
    (horasAtras > 36 ? " · ⚠ Los datos tienen más de un día; el pronóstico puede estar desactualizado." : "");
  prepararPlanear();
  pintarLeer();
  dibujar();
  let espera;
  window.addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(dibujar, 150); });
}

iniciar();
