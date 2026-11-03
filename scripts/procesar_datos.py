"""Convierte los datos crudos en lo que muestra el dashboard.

Lee data/raw/, aplica los umbrales de config/umbrales.json y escribe:
    data/processed/diario_estacion.csv   lluvia diaria observada (días válidos)
    data/processed/datos.json            todo lo que necesita la página
    docs/datos.json                      copia que publica GitHub Pages

Uso:
    python scripts/procesar_datos.py
"""

import csv
import json
import shutil
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = json.loads((RAIZ / "config" / "umbrales.json").read_text(encoding="utf-8"))
CARPETA_RAW = RAIZ / "data" / "raw"
CARPETA_PROCESADOS = RAIZ / "data" / "processed"

JORNADA = range(CONFIG["jornada"]["hora_inicio"], CONFIG["jornada"]["hora_fin"])
SECA_MM = CONFIG["hora_seca"]["lluvia_max_mm"]
SECA_PROB = CONFIG["hora_seca"]["probabilidad_max"]

# Un día de la estación es válido si tiene al menos 130 de los 144 registros de 10 minutos (90 %).
REGISTROS_DIA_MIN = 130
# En Guapi casi nunca pasan 5 días seguidos sin una gota (no ocurre en los años con buenos datos).
# Rachas así se toman como sensor dañado que reporta ceros y se excluyen.
RACHA_CEROS_SOSPECHOSA = 5
EXCLUIDOS = {"n": 0}
MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

OPERADORES = {
    "<=": lambda a, b: a <= b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    ">": lambda a, b: a > b,
}


# ---------- Reglas del semáforo ----------

def describir(condicion):
    variable = CONFIG["variables"][condicion["variable"]]
    return f"{variable['nombre']} {condicion['op']} {condicion['valor']} {variable['unidad']}"


def evaluar(actividad, medidas):
    """Devuelve (color, motivos). Rojo si se cumple alguna condición roja;
    verde si se cumplen todas las verdes; amarillo en cualquier otro caso.
    Si falta un dato necesario, devuelve (None, ...)."""
    for condicion in actividad["verde"] + actividad["rojo"]:
        if medidas.get(condicion["variable"]) is None:
            return None, ["Faltan datos"]
    rojas = [c for c in actividad["rojo"] if OPERADORES[c["op"]](medidas[c["variable"]], c["valor"])]
    if rojas:
        return "rojo", [describir(c) for c in rojas]
    no_verdes = [c for c in actividad["verde"] if not OPERADORES[c["op"]](medidas[c["variable"]], c["valor"])]
    if not no_verdes:
        return "verde", []
    return "amarillo", ["No cumple: " + describir(c) for c in no_verdes]


def mayor_ventana_seca(horas_secas):
    """horas_secas: lista de (hora, es_seca) de la jornada. Devuelve (duración, inicio, fin)."""
    mejor = (0, None, None)
    inicio = None
    for hora, es_seca in horas_secas + [(None, False)]:
        if es_seca and inicio is None:
            inicio = hora
        elif not es_seca and inicio is not None:
            fin = horas_secas[-1][0] + 1 if hora is None else hora
            if fin - inicio > mejor[0]:
                mejor = (fin - inicio, inicio, fin)
            inicio = None
    return mejor


# ---------- Estación del IDEAM ----------

def leer_estacion():
    """Devuelve {fecha: {hora: mm}} solo con los días válidos."""
    horas = defaultdict(dict)
    registros = defaultdict(int)
    for archivo in sorted((CARPETA_RAW / "ideam").glob("*.csv")):
        with archivo.open(encoding="utf-8") as f:
            for fila in csv.DictReader(f):
                dia = fila["hora"][:10]
                hora = int(fila["hora"][11:13])
                mm = float(fila["mm"])
                n = int(fila["n"])
                # Una hora tiene como máximo 6 registros de 10 minutos.
                # Si hay más, son registros duplicados: se reescala la suma.
                if n > 6:
                    mm = mm * 6 / n
                    n = 6
                horas[dia][hora] = mm
                registros[dia] += n
    validos = {dia: horas[dia] for dia in sorted(horas) if registros[dia] >= REGISTROS_DIA_MIN}
    sospechosos = dias_con_sensor_en_cero(validos)
    EXCLUIDOS["n"] = len(sospechosos)
    print(f"Días excluidos por posible sensor en cero: {len(sospechosos)}")
    return {dia: h for dia, h in validos.items() if dia not in sospechosos}


def dias_con_sensor_en_cero(estacion):
    """Busca rachas de días consecutivos con 0 mm de al menos RACHA_CEROS_SOSPECHOSA días."""
    sospechosos = set()
    racha = []
    for dia in list(estacion) + [None]:
        seco = dia is not None and sum(estacion[dia].values()) < 0.1
        seguido = racha and dia is not None and date.fromisoformat(dia) - date.fromisoformat(racha[-1]) == timedelta(days=1)
        if seco and (not racha or seguido):
            racha.append(dia)
            continue
        if len(racha) >= RACHA_CEROS_SOSPECHOSA:
            sospechosos.update(racha)
        racha = [dia] if seco else []
    return sospechosos


def medidas_observadas(estacion):
    """Calcula para cada día válido las mismas medidas que usa el semáforo."""
    resultado = {}
    for dia, horas in estacion.items():
        jornada = [(h, horas.get(h, 0.0) < SECA_MM) for h in JORNADA]
        anteriores = [(date.fromisoformat(dia) - timedelta(days=k)).isoformat() for k in (1, 2)]
        lluvia_3d = None
        if all(a in estacion for a in anteriores):
            lluvia_3d = sum(horas.values()) + sum(sum(estacion[a].values()) for a in anteriores)
        resultado[dia] = {
            "lluvia_dia": sum(horas.values()),
            "lluvia_jornada": sum(horas.get(h, 0.0) for h in JORNADA),
            "ventana_seca": mayor_ventana_seca(jornada)[0],
            "lluvia_3d": lluvia_3d,
        }
    return resultado


def confiabilidad(dias):
    if dias >= 150:
        return "media"
    if dias >= 90:
        return "media-baja"
    return "baja"


def climatologia(estacion, medidas):
    por_mes = defaultdict(list)
    for dia in medidas:
        por_mes[int(dia[5:7])].append(dia)

    meses = []
    for mes in range(1, 13):
        dias = por_mes.get(mes, [])
        lluvias = [medidas[d]["lluvia_dia"] for d in dias]
        anios = sorted({d[:4] for d in dias})
        dias_del_mes = 31 if mes in (1, 3, 5, 7, 8, 10, 12) else 30 if mes != 2 else 28
        semaforo = {}
        for actividad in CONFIG["actividades"]:
            colores = [evaluar(actividad, medidas[d])[0] for d in dias]
            colores = [c for c in colores if c]
            total = len(colores) or 1
            verde = round(100 * colores.count("verde") / total)
            amarillo = round(100 * colores.count("amarillo") / total)
            # El rojo se calcula por diferencia para que los tres sumen exactamente 100.
            semaforo[actividad["id"]] = {"verde": verde, "amarillo": amarillo, "rojo": 100 - verde - amarillo if colores else 0}
            semaforo[actividad["id"]]["dias"] = len(colores)
        # Probabilidad de que llueva (>= 0.5 mm) en cada hora del día.
        prob_hora = []
        for h in range(24):
            valores = [estacion[d].get(h) for d in dias if estacion[d].get(h) is not None]
            prob_hora.append(round(100 * sum(v >= 0.5 for v in valores) / len(valores)) if valores else None)
        meses.append({
            "mes": mes,
            "nombre": MESES[mes - 1],
            "dias_validos": len(dias),
            "anios": anios,
            "confiabilidad": confiabilidad(len(dias)),
            "lluvia_media_dia": round(statistics.mean(lluvias), 1) if lluvias else None,
            "lluvia_tipica_mes": round(statistics.mean(lluvias) * dias_del_mes) if lluvias else None,
            "pct_dias_lluvia": round(100 * sum(v >= 1 for v in lluvias) / len(lluvias)) if lluvias else None,
            "pct_dias_fuertes": round(100 * sum(v >= 20 for v in lluvias) / len(lluvias)) if lluvias else None,
            "pct_dias_muy_fuertes": round(100 * sum(v >= 50 for v in lluvias) / len(lluvias)) if lluvias else None,
            "ventana_seca_mediana": statistics.median(medidas[d]["ventana_seca"] for d in dias) if dias else None,
            "prob_lluvia_hora": prob_hora,
            "semaforo": semaforo,
        })
    return meses


def resumen_por_anio(medidas):
    por_anio = defaultdict(list)
    for dia, m in medidas.items():
        por_anio[dia[:4]].append(m["lluvia_dia"])
    # Se incluyen también los años sin datos, para que los huecos se vean.
    anios = range(CONFIG["estacion_ideam"]["anio_inicio"], date.today().year + 1)
    return [
        {"anio": a, "dias_validos": len(por_anio[str(a)]), "lluvia_total": round(sum(por_anio[str(a)])),
         "lluvia_media_dia": round(statistics.mean(por_anio[str(a)]), 1) if por_anio[str(a)] else None}
        for a in anios
    ]


# ---------- Pronóstico ----------

def procesar_pronostico(clima_mensual):
    crudo = json.loads((CARPETA_RAW / "pronostico_openmeteo.json").read_text(encoding="utf-8"))
    horario = crudo["hourly"]
    horas = defaultdict(dict)
    for momento, mm, prob in zip(horario["time"], horario["precipitation"], horario["precipitation_probability"]):
        horas[momento[:10]][int(momento[11:13])] = {"mm": mm or 0.0, "prob": prob if prob is not None else 0}

    lluvia_por_dia = {d: sum(v["mm"] for v in hs.values()) for d, hs in horas.items()}
    hoy = datetime.now(ZoneInfo(CONFIG["ubicacion"]["zona_horaria"])).date()
    dias = []
    for dia in sorted(horas):
        fecha = date.fromisoformat(dia)
        if fecha < hoy:
            continue
        hs = horas[dia]
        jornada = [(h, hs[h]["mm"] < SECA_MM and hs[h]["prob"] < SECA_PROB) for h in JORNADA if h in hs]
        ventana, v_ini, v_fin = mayor_ventana_seca(jornada)
        anteriores = [(fecha - timedelta(days=k)).isoformat() for k in (1, 2)]
        medidas = {
            "lluvia_dia": lluvia_por_dia[dia],
            "lluvia_jornada": sum(hs[h]["mm"] for h in JORNADA if h in hs),
            "ventana_seca": ventana,
            "lluvia_3d": lluvia_por_dia[dia] + sum(lluvia_por_dia.get(a, 0.0) for a in anteriores),
        }
        semaforo = {}
        for actividad in CONFIG["actividades"]:
            color, motivos = evaluar(actividad, medidas)
            semaforo[actividad["id"]] = {"color": color, "motivos": motivos}
        normal = clima_mensual[fecha.month - 1]["lluvia_media_dia"]
        dias.append({
            "fecha": dia,
            "dias_adelante": (fecha - hoy).days,
            "lluvia_dia": round(medidas["lluvia_dia"], 1),
            "lluvia_jornada": round(medidas["lluvia_jornada"], 1),
            "lluvia_3d": round(medidas["lluvia_3d"], 1),
            "prob_max": max((v["prob"] for v in hs.values()), default=None),
            "ventana_seca": ventana,
            "ventana_inicio": v_ini,
            "ventana_fin": v_fin,
            "lluvia_normal_dia": normal,
            "horas": [{"h": h, "mm": round(hs[h]["mm"], 1), "prob": hs[h]["prob"]} for h in sorted(hs)],
            "semaforo": semaforo,
        })
    return dias


def main():
    estacion = leer_estacion()
    medidas = medidas_observadas(estacion)
    CARPETA_PROCESADOS.mkdir(parents=True, exist_ok=True)

    with (CARPETA_PROCESADOS / "diario_estacion.csv").open("w", newline="", encoding="utf-8") as f:
        escritor = csv.writer(f)
        escritor.writerow(["fecha", "lluvia_dia_mm", "lluvia_jornada_mm", "ventana_seca_h", "lluvia_3d_mm"])
        for dia, m in medidas.items():
            lluvia_3d = round(m["lluvia_3d"], 1) if m["lluvia_3d"] is not None else ""
            escritor.writerow([dia, round(m["lluvia_dia"], 1), round(m["lluvia_jornada"], 1), m["ventana_seca"], lluvia_3d])

    clima = climatologia(estacion, medidas)
    zona = ZoneInfo(CONFIG["ubicacion"]["zona_horaria"])
    dias_ordenados = sorted(medidas)
    salida = {
        "actualizado": datetime.now(zona).isoformat(timespec="minutes"),
        "ubicacion": CONFIG["ubicacion"],
        "estacion": {
            **CONFIG["estacion_ideam"],
            "dias_validos": len(medidas),
            "dias_excluidos_sensor": EXCLUIDOS["n"],
            "primer_dia": dias_ordenados[0],
            "ultimo_dia": dias_ordenados[-1],
        },
        "jornada": CONFIG["jornada"],
        "hora_seca": CONFIG["hora_seca"],
        "variables": CONFIG["variables"],
        "actividades": CONFIG["actividades"],
        "pronostico": procesar_pronostico(clima),
        "clima_mensual": clima,
        "anios": resumen_por_anio(medidas),
        "dias_mas_lluviosos": [
            {"fecha": d, "lluvia": round(medidas[d]["lluvia_dia"], 1)}
            for d in sorted(medidas, key=lambda d: medidas[d]["lluvia_dia"], reverse=True)[:10]
        ],
    }
    texto = json.dumps(salida, ensure_ascii=False, indent=1)
    (CARPETA_PROCESADOS / "datos.json").write_text(texto, encoding="utf-8")
    shutil.copy(CARPETA_PROCESADOS / "datos.json", RAIZ / "docs" / "datos.json")
    print(f"Listo: {len(medidas)} días válidos de la estación, {len(salida['pronostico'])} días de pronóstico.")


if __name__ == "__main__":
    main()
