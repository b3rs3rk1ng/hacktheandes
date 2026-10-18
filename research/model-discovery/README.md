# Búsqueda reproducible de modelos y evidencia

Herramientas instaladas y consultas ejecutadas el 17 de octubre de 2026 (Lima; las ejecuciones se guardan en UTC). El objetivo es elegir un fruto y un modelo gratuito para investigar inspección desde un dron; esta etapa no modifica la app ni el simulador.

## Instalación y uso

Entorno local aislado con `uv`, Python 3.11.15, `huggingface-hub` 2.2.0 y `httpx` 0.28.1. Las dependencias exactas están en `uv.lock`. No se configuraron cuentas, pagos ni claves. Se instaló el cliente oficial del Hub y un cliente HTTP para las APIs de artículos; no se instaló un servidor RAG ni un MCP global.

Desde la raíz de este espacio de trabajo:

```sh
uv sync --project research/model-discovery --locked
uv run --project research/model-discovery python research/model-discovery/discover.py
```

Para consultar solamente modelos/datasets o artículos:

```sh
uv run --project research/model-discovery python research/model-discovery/discover.py --sources hub
uv run --project research/model-discovery python research/model-discovery/discover.py --sources papers
```

Las búsquedas y límites se cambian en [queries.json](queries.json), sin modificar el motor. `--config` acepta otra configuración y `--output` elige la carpeta de resultados. Se guarda cada consulta, fecha, revisión de los modelos, archivos publicados, licencia y métricas declaradas cuando existen. No se deduce la calidad de descargas o popularidad. El programa no descarga pesos ni ejecuta código de repositorios.

La serialización usa el contrato `CardData.to_dict()` del SDK para conservar licencias y evaluaciones. Una ficha inválida puede provocar que el SDK omita evaluaciones; los candidatos se contrastan con los README y archivos originales.

## Resultado de la consulta instalada

La [ejecución corregida](runs/20261018T044508Z/results.json) contiene **36 modelos y 12 datasets únicos** recuperados de 11 búsquedas acotadas en Hugging Face. Son resultados brutos, no 36 modelos aptos: incluyen hojas, recursos fuera del alcance y repositorios sin pesos. La búsqueda del Hub trabaja sobre los campos indexados por el catálogo; no es una revisión exhaustiva de todos los archivos del mundo.

Semantic Scholar devolvió **HTTP 429** en la primera consulta; se conservó el error y se omitieron las siguientes de ese servicio. OpenAlex funcionó sin clave y devolvió 20 registros de artículos en cuatro consultas. Los registros pueden repetirse entre consultas. La revisión complementaria también utilizó APIs de GitHub, arXiv y DataCite, además de fuentes primarias por web. Las claves opcionales se leen de `SEMANTIC_SCHOLAR_API_KEY` y `OPENALEX_API_KEY`; no son necesarias para reproducir las consultas públicas que funcionaron.

La primera ejecución, `20261018T044341Z`, queda como historial de diagnóstico: su serialización inicial perdió metadatos dinámicos de las fichas. Para licencias y métricas usar la ejecución corregida enlazada arriba y la evidencia individual de cada candidato.

## Candidatos encontrados

Las métricas siguientes pertenecen a poblaciones y tareas diferentes y no constituyen un ranking comparable. No se ejecutó inferencia ni se midió velocidad propia.

| Candidato | Pieza disponible | Evidencia publicada y límite |
|---|---|---|
| [AKASH-ALAM / Fruit Quality Detection](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning) | Detector YOLOv8n con clases `good apple` / `bad apple`, pesos PT de aproximadamente 6.2 MB y ONNX de 12.1 MB. | Autores declaran mAP50 98.97%, precisión 98.17% y recall 97.79% agregados en su validación. Las imágenes revisadas muestran frutas fuera del árbol y vistas similares; independencia por fruto no documentada. El autor comunica 3–4 s en CPU cloud. No hay prueba de huerto o video móvil. MIT en repositorio; la cadena Ultralytics utiliza AGPL-3.0 y no debe presentarse toda como MIT. |
| [FruitNet](https://github.com/OleksandrKlanovets/fruitnet) | Clasificador MobileNetV2, H5 9.4 MB, seis clases que incluyen manzana fresca/podrida, inferencia y orden de clases públicos; repositorio MIT. | Autor declara 99% en su test de Kaggle. Requiere recorte de fruta: no localiza ni identifica un patógeno. La webcam captura una foto al pulsar; no acredita robustez en movimiento. |
| [ausjahk / fruits-fresh-rotten-from-scratch](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch) | ResNet18, safetensors, configuración de seis clases que incluye manzana fresca/podrida; ficha Apache-2.0. | Accuracy declarada 96.10%; la ficha conserva limitaciones de procedencia y split. Clasificador sin localización ni evaluación móvil. |
| [amaniqbal-ai / apricot-disease-classification](https://github.com/amaniqbal-ai/apricot-disease-classification) | Clasificación de damasco/albaricoque: incluye `brown_rot`, código MIT y checkpoints descargables en releases. | Agregados de siete clases que mezclan órganos/enfermedades: MobileNetV3 79.9%, Swin 88.46% de test según autores. No son sensibilidad específica de podredumbre del fruto. Los ZIP existen; no se descargaron ni ejecutaron. No se encontró validación en vuelo. |

El detector nuevo aporta localización y estado visual en una sola pieza; FruitNet permite una comparación sencilla con un clasificador conocido. **La primera opción para evaluar en la hack es manzana con deterioro visible.** Esta elección es provisional: llamar a un fruto `bad` o `rotten` no identifica la enfermedad que causó el daño ni demuestra contagio.

La alternativa de damasco sí ofrece una etiqueta de enfermedad concreta, pero mezcla órganos y no presenta aún desempeño suficiente documentado para llamarlo excelente en el escenario pedido. Ninguno de estos candidatos reúne evidencia verificable de todos los requisitos: pesos disponibles, calidad sanitaria por fruto en árbol y cámara móvil.

## Evidencia sanitaria y siguiente decisión

El retiro sanitario tiene fundamento para enfermedades concretas: [podredumbre negra de manzana](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/yard-and-garden-problems/black-rot-of-apple), [podredumbre parda de frutales de carozo](https://ipm.ucanr.edu/home-and-landscape/brown-rot-blossom-and-twig-blight/) y [moho gris de frambuesa](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-raspberries-in-the-home-garden). Estas fuentes no validan que los clasificadores de frescura diagnostiquen esos patógenos ni que produzcan un ahorro medido en Perú.

Antes de fijar el modelo, evaluar los candidatos sobre videos con frutos en árbol, luz variable, hojas que ocultan el fruto, distancia y desenfoque de movimiento. Separar prueba por fruto/secuencia/huerto, medir afectados detectados, falsos retiros de frutos sanos, abstenciones y latencia por fruto seguido. El dron puede ralentizarse y confirmar desde varias vistas antes de actuar; ese mecanismo requiere calibración y no convierte cuadros repetidos en evidencia independiente.

La simulación podrá representar esos escenarios; demostrar rendimiento allí no reemplaza comprobar transferencia a un huerto real. Esta etapa deja candidatos y evidencia, no una certificación de rendimiento ni de integración con Tevel.

## Auditorías y fuentes

Ampliación de opciones gratuitas: [pesos descargados y recursos UAV](free-options/README.md). Esta revisión inspecciona los binarios sin ejecutarlos, añade APPLEDRONE y confirma que el ONNX de AKASH declara AGPL-3.0 dentro del propio modelo.

Aclaración tras exigir uso real en dron: [DCTNet](https://link.springer.com/article/10.1007/s40747-024-01749-w) usa imágenes de duraznos capturadas por UAV y los autores reportan despliegue con AX650N y 22.17 FPS; no se encontraron pesos/código públicos ni evaluación temporal de vuelo. [Otro estudio de damasco](https://doi.org/10.1016/j.eswa.2025.128946) recoge fotos y videos con DJI Mavic Mini, pero evalúa inferencia en PC; tampoco se verificaron pesos públicos. Son antecedentes de vuelo real, separados de los candidatos descargables. El detector de manzana recomendado para ensayos continúa sin uso documentado en dron real.

- [Revisión por APIs: modelos, archivos, licencias y métricas](api-review/README.md), con [candidatos estructurados](api-review/curated-candidates.json).
- [Revisión independiente y fundamento sanitario](independent-review/README.md).
- [Artículos y datasets mediante APIs](papers-review/README.md), incluido un dataset de **fruto en huerto** y un trabajo UAV/manzana cuyos vuelos y evaluación temporal siguen pendientes.
- [SDK oficial de Hugging Face](https://huggingface.co/docs/huggingface_hub/en/guides/search), [fichas de modelos](https://huggingface.co/docs/hub/model-cards), [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/), [OpenAlex API](https://help.openalex.org/api/).
