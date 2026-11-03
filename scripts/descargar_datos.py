"""Descarga los datos crudos del proyecto.

1. Pronóstico de 7 días de Open-Meteo (por hora y por día).
2. Lluvia observada en la estación del IDEAM, sumada por hora, desde datos.gov.co.

Uso:
    python scripts/descargar_datos.py             # pronóstico + años recientes del IDEAM
    python scripts/descargar_datos.py --completo  # vuelve a bajar todos los años del IDEAM

Solo usa la biblioteca estándar de Python, así que no hay que instalar nada.
"""

import argparse
import csv
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = json.loads((RAIZ / "config" / "umbrales.json").read_text(encoding="utf-8"))
CARPETA_RAW = RAIZ / "data" / "raw"
CARPETA_IDEAM = CARPETA_RAW / "ideam"

URL_OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
URL_IDEAM = "https://www.datos.gov.co/resource/s54a-sgyg.json"


def pedir_json(url, parametros, intentos=4):
    """Hace una petición GET y devuelve el JSON. Reintenta si el servidor falla."""
    direccion = url + "?" + urllib.parse.urlencode(parametros)
    encabezados = {"User-Agent": "lluvia-obras-guapi"}
    # Token opcional de datos.gov.co, guardado como secreto en GitHub (nunca en el código).
    token = os.environ.get("SOCRATA_APP_TOKEN")
    if token and "datos.gov.co" in url:
        encabezados["X-App-Token"] = token
    for intento in range(1, intentos + 1):
        try:
            peticion = urllib.request.Request(direccion, headers=encabezados)
            with urllib.request.urlopen(peticion, timeout=150) as respuesta:
                return json.load(respuesta)
        except Exception as error:
            if intento == intentos:
                raise
            espera = 10 * intento
            print(f"  Falló el intento {intento} ({error}). Reintento en {espera} s...")
            time.sleep(espera)


def descargar_pronostico():
    ubicacion = CONFIG["ubicacion"]
    parametros = {
        "latitude": ubicacion["latitud"],
        "longitude": ubicacion["longitud"],
        "timezone": ubicacion["zona_horaria"],
        "hourly": "precipitation,precipitation_probability",
        "daily": "precipitation_sum,precipitation_probability_max",
        "forecast_days": 7,
        # Dos días pasados para poder calcular la lluvia acumulada de 3 días.
        "past_days": 2,
    }
    datos = pedir_json(URL_OPEN_METEO, parametros)
    destino = CARPETA_RAW / "pronostico_openmeteo.json"
    destino.write_text(json.dumps(datos, indent=1), encoding="utf-8")
    print(f"Pronóstico guardado en {destino.relative_to(RAIZ)}")


def descargar_anio_ideam(anio):
    """Baja la lluvia de un año sumada por hora. n = número de registros de 10 minutos."""
    estacion = CONFIG["estacion_ideam"]
    filas = []
    desplazamiento = 0
    while True:
        parametros = {
            "$select": "date_trunc_ymd(fechaobservacion) as dia, "
            "date_extract_hh(fechaobservacion) as h, "
            "sum(valorobservado) as mm, count(*) as n",
            "$where": f"codigoestacion='{estacion['codigo']}' "
            f"and codigosensor='{estacion['codigo_sensor']}' "
            f"and fechaobservacion between '{anio}-01-01T00:00:00' "
            f"and '{anio}-12-31T23:59:59'",
            "$group": "dia, h",
            "$order": "dia, h",
            "$limit": 5000,
            "$offset": desplazamiento,
        }
        pagina = pedir_json(URL_IDEAM, parametros)
        filas.extend(pagina)
        if len(pagina) < 5000:
            break
        desplazamiento += 5000

    destino = CARPETA_IDEAM / f"{estacion['codigo']}_{anio}.csv"
    with destino.open("w", newline="", encoding="utf-8") as archivo:
        escritor = csv.writer(archivo)
        escritor.writerow(["hora", "mm", "n"])
        for fila in filas:
            hora = f"{fila['dia'][:10]}T{int(fila['h']):02d}"
            escritor.writerow([hora, round(float(fila["mm"]), 2), fila["n"]])
    print(f"IDEAM {anio}: {len(filas)} horas con datos -> {destino.relative_to(RAIZ)}")


def descargar_ideam(completo):
    CARPETA_IDEAM.mkdir(parents=True, exist_ok=True)
    estacion = CONFIG["estacion_ideam"]
    anio_actual = date.today().year
    for anio in range(estacion["anio_inicio"], anio_actual + 1):
        archivo = CARPETA_IDEAM / f"{estacion['codigo']}_{anio}.csv"
        # Los años viejos no cambian: solo se bajan si faltan.
        # El año actual y el anterior se refrescan siempre, porque el IDEAM los sigue completando.
        if completo or not archivo.exists() or anio >= anio_actual - 1:
            descargar_anio_ideam(anio)


def main():
    analizador = argparse.ArgumentParser(description=__doc__)
    analizador.add_argument("--completo", action="store_true", help="rebajar todos los años del IDEAM")
    argumentos = analizador.parse_args()

    CARPETA_RAW.mkdir(parents=True, exist_ok=True)
    descargar_pronostico()
    try:
        descargar_ideam(argumentos.completo)
    except Exception as error:
        # Si datos.gov.co falla, seguimos con los archivos que ya teníamos.
        print(f"AVISO: no se pudo actualizar el IDEAM ({error}). Se usan los datos guardados.")


if __name__ == "__main__":
    main()
