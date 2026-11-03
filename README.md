# Lluvia y obras en Guapi

Dashboard público que combina el **pronóstico de lluvia** y el **histórico local** para ayudar a programar actividades de construcción en el casco urbano de Guapi (Cauca).

**Pregunta problema:** ¿Cómo puede el análisis histórico y el pronóstico de la lluvia apoyar la programación de actividades de construcción en Guapi?

👉 **Ver el dashboard:** https://jerson0915.github.io/lluvia-obras-guapi/

> Herramienta de apoyo para planear. No reemplaza el criterio técnico de la obra ni las [alertas oficiales del IDEAM](http://www.pronosticosyalertas.gov.co/).

## Qué muestra

| Pantalla | Contenido |
|---|---|
| Esta semana | Semáforo por actividad para los próximos 7 días, lluvia diaria frente a lo normal y lluvia hora por hora |
| Planear mi obra | Eliges actividad y mes y ves cuántos días suelen ser aptos y a qué horas suele llover |
| Histórico | Lluvia típica por mes, días de lluvia fuerte, datos disponibles por año y días récord |
| Cómo leer esto | Fuentes, umbrales, confiabilidad y límites |

Actividades de la fase 1: **fundir concreto**, **excavaciones y rellenos**, **pañete y pintura exterior**.

## Cómo funciona

```
GitHub Actions (todos los días, 5:30 a. m.)
  └─ scripts/descargar_datos.py  → data/raw/        (Open-Meteo + IDEAM)
  └─ scripts/procesar_datos.py   → data/processed/  + docs/datos.json
GitHub Pages publica docs/ → index.html lee datos.json
```

```
lluvia-obras-guapi/
├── .github/workflows/actualizar.yml  # Tarea diaria automática
├── scripts/
│   ├── descargar_datos.py            # Trae el pronóstico y la estación del IDEAM
│   └── procesar_datos.py             # Calcula promedios y semáforo
├── config/umbrales.json              # Reglas por actividad (edítalas aquí)
├── data/
│   ├── raw/                          # Datos originales descargados
│   └── processed/                    # Resultados calculados
├── docs/                             # Página pública (GitHub Pages)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── datos.json
└── requirements.txt
```

## Fuentes de datos

- **Pronóstico:** [Open-Meteo](https://open-meteo.com/) (gratis para uso no comercial, licencia CC BY 4.0).
- **Histórico:** estación automática del IDEAM *Aeropuerto Guapi* (código 0053045040), dataset [Precipitación](https://www.datos.gov.co/resource/s54a-sgyg) en datos.gov.co, con registros cada 10 minutos desde 2017.

### Decisiones sobre los datos (verificadas el 2 de noviembre de 2026)

- **La estación tiene huecos grandes.** Solo hay unos 1.240 días completos entre 2017 y 2026, y casi nada en 2020–2021 y 2024. Cada mes se apoya en ~80–130 días, así que el histórico es una referencia de confiabilidad media-baja, no una normal climatológica de 30 años.
- **Control de calidad.**
  - Un día cuenta como válido si tiene ≥ 130 de 144 registros.
  - Las horas con registros duplicados se reescalan.
  - Se excluyen las rachas de ≥ 5 días seguidos en 0 mm (sensor dañado). Eso descartó 164 días; por ejemplo, de noviembre de 2019 a marzo de 2020 hubo 75 días seguidos en cero.
- **No se usa reanálisis (ERA5) para el histórico.** Comparado con la estación en 2019, ERA5 calculó 8.747 mm frente a 3.650 mm medidos, y lluvia en 312 días frente a 196.
- **El pronóstico tiene sesgo de "día lluvioso".** En 2026, el pronóstico archivado (`best_match`) calculó 3.204 mm frente a 2.878 mm medidos (+11 %), pero anunció lluvia en 179 días frente a 136 reales. Por eso el semáforo tiende a ser conservador.
- **La estación Bonanza** (53045010, con datos desde 1966) no está en el dataset abierto. Pedirla al IDEAM (DHIME) mejoraría mucho el histórico.

## Ejecutarlo en tu computador

```bash
python3 scripts/descargar_datos.py             # baja pronóstico y años recientes del IDEAM
python3 scripts/descargar_datos.py --completo  # baja de nuevo todos los años
python3 scripts/procesar_datos.py              # recalcula todo
python3 -m http.server 8000 --directory docs   # abre http://localhost:8000
```

Para cambiar las reglas del semáforo, edita `config/umbrales.json` y vuelve a correr `procesar_datos.py`.

## Mantenimiento

- GitHub puede **desactivar las tareas programadas** de un repositorio público tras 60 días sin actividad. Si la página muestra "⚠ Los datos tienen más de un día", entra a **Actions → Actualizar datos → Enable workflow / Run workflow**.
- Si datos.gov.co falla, la actualización sigue con el pronóstico y con los datos del IDEAM que ya estaban guardados.
- Token opcional de datos.gov.co: guárdalo como secreto `SOCRATA_APP_TOKEN` en **Settings → Secrets and variables → Actions**, nunca en el código.

## Fases

1. **Versión mínima** (esta): pronóstico de 7 días, lluvia típica por mes y semáforo para 3 actividades.
2. **Validación:** prueba con al menos 5 constructores y ajuste de umbrales.
3. **Ampliación:** más actividades, alertas del IDEAM y cruce con retrasos de obras públicas.
4. **Expansión:** Timbiquí, López de Micay y módulo de inundaciones.

**Criterios de éxito:**
- Se actualiza solo durante 30 días seguidos.
- Al menos 5 constructores entienden el semáforo sin explicación.
- Al menos 3 de ellos lo usarían para programar actividades.
