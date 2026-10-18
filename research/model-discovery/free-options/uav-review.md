# Opciones gratuitas con evidencia de cámara UAV

Consulta: 2026-10-18 UTC. Fuentes primarias, APIs GitHub/Hugging Face/S3 y artículos. No se instaló software ni se ejecutó código externo, inferencia o deserialización de pesos. Se inspeccionó en memoria un ZIP de 4.9 MB; no se guardaron sus pesos. Las consultas y textos de evidencia están en [uav/](uav/).

## Hallazgo nuevo verificado: AgML / Apple Detection Drone Brazil

**Hay modelos gratuitos descargables entrenados para localizar manzanas usando imágenes tomadas durante un vuelo real. No diagnostican enfermedad y no acreditan operación industrial ni inferencia a bordo.**

| Modelo | Archivo verificable | Resultado publicado | Licencia / limitación |
|---|---|---|---|
| AgML YOLO11n `apple_detection_drone_brazil+yolo11n` | [ZIP público](https://agdata-data.s3.us-west-1.amazonaws.com/models/detector/apple_detection_drone_brazil%2Byolo11n.zip), HTTP 200, 4,914,890 bytes; contiene `apple_detection_drone_brazil-yolo11n/best.pt`, 5,490,067 bytes. | `results.json` dentro del ZIP: precisión 85.08%, recall 82.26%, mAP50 89.57%, mAP50–95 50.22%. Clase única `apple`. | [Código AgML Apache-2.0](https://github.com/Project-AgML/AgML/blob/main/LICENSE). El ZIP no incluye licencia separada para los pesos. Su base Ultralytics implica revisar [AGPL-3.0 / licencia comercial](https://github.com/ultralytics/ultralytics). No presentar toda la cadena como Apache-2.0. |
| AgML EfficientDetD4 `apple_detection_drone_brazil` | [PTH público](https://agdata-data.s3.us-west-1.amazonaws.com/models/apple_detection_drone_brazil.pth), HEAD HTTP 200, 84,195,286 bytes. No descargado por superar 50 MB. | [Benchmark AgML](https://github.com/Project-AgML/AgML/blob/main/agml/_assets/model_benchmarks.json) 79.62 mAP; [artículo de AgML](https://pmc.ncbi.nlm.nih.gov/articles/PMC10482164/) identifica mAP@0.5. | Código Apache-2.0; no se encontró aviso separado de pesos. Existencia comprobada, contenido e inferencia no verificados. |

El [código oficial de descarga](https://github.com/Project-AgML/AgML/blob/main/agml/utils/downloads.py) define esas rutas S3. El signo `+` en la URL del detector debe codificarse `%2B`: la URL sin codificar respondió 403; la codificada respondió 200. [Benchmark actualizado de detectores](https://github.com/Project-AgML/AgML/blob/main/agml/_assets/detector_benchmarks.json).

### Qué demuestra el vuelo

El [estudio original Embrapa (Santos y Gebler, 2021)](https://arxiv.org/html/2110.12331v1) documenta DJI Phantom 4 Pro a 12 m sobre huerto Fuji/Gala, video 4K, captura el 13 de diciembre de 2018. Entrena Faster R-CNN para localizar manzanas y analiza asociación entre fotogramas y posición 3D. [Código original MIT](https://github.com/thsant/add256-fastercnn), sólo notebook y muestras en el árbol: no se verificaron pesos publicados de esa implementación.

Los modelos de AgML son reentrenamientos posteriores sobre esa familia de datos; **no son los modelos exactos que el estudio ejecutó ni una prueba de que YOLO11n se haya ejecutado durante ese vuelo**. Es evidencia de evaluación con imagen aérea real. El CSV/JSON del ZIP no especifica independencia temporal/por fruto ni validación en nuevo huerto. No convertir el mAP de cuadros en exactitud de decisiones de retirar frutos.

Hay una inconsistencia del catálogo: `public_datasources.json` de AgML llama `platform: ground` a `apple_detection_drone_brazil`, mientras el paper original y nombre del dataset documentan captura UAV. Se prioriza el método publicado; se deja explícita la discrepancia. El dataset HF declara 689 imágenes y 2,471 cajas. El artículo original describe 1,139 recortes divididos 1,025/114; no se verificó la transformación exacta entre ambas versiones.

## Lo que no se confirmó

- No se encontró en esta búsqueda acotada un checkpoint gratuito descargable para enfermedad del fruto de manzana, pera, durazno, nectarina, ciruela, albaricoque o frambuesa, con prueba suficiente de despliegue en dron real y uso industrial habitual.
- El [pipeline UAV/manzana de 2025](https://arxiv.org/html/2512.22990v1) cita 97.49% en frescura, pero separa el entrenamiento en tres colecciones de fotos y deja validación de vuelos a gran escala y coherencia temporal como trabajo futuro. No publica un enlace de pesos o código en el artículo. No sirve para acreditar producto UAV gratuito listo.
- Proyectos GitHub con título «drone disease» revisados mediante árbol (`parnika099/Apple-Drone-Disease-Classification`, `IshanJawale/automated-drone-system-for-apple-disease-detection`) no mostraron checkpoints en sus árboles; no se suman a la lista de modelos instalables.
- Las búsquedas de los demás frutos devolvieron sobre todo modelos de hojas o propuestas de integración futura; no equivalen a enfermedad del fruto captada en vuelo.

Para la hack, este hallazgo puede resolver la pieza «ver/localizar manzanas desde dron». La pieza sanitaria debe evaluarse por separado y no hereda validación UAV al conectarla a este detector.
