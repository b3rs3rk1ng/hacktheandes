# Búsqueda de artículos mediante APIs

Consulta: 18 de octubre de 2026 UTC. Investigación documental: no se ejecutaron modelos, código externo, simuladores ni descargas de pesos. Se leyó primero `research/fruit-audit/README.md` para ampliar la auditoría existente.

## Resultado para la hack

La API de arXiv encontró un trabajo reciente cuyo título coincide casi exactamente con el proyecto: [A Low-Cost UAV Deep Learning Pipeline for Integrated Apple Disease Diagnosis, Freshness Assessment, and Fruit Detection](https://arxiv.org/abs/2512.22990). Es una referencia de arquitectura para **manzana**, pero no una pieza descargable que podamos afirmar buena desde una cámara volando. Combina un clasificador de hojas, otro de frescura de fruto y YOLOv8 para localizar manzanas; comunica 97.49% de accuracy de test de frescura y F1 de validación 85.7% para detección. No se localizaron enlaces a pesos/código/datasets identificables en el HTML completo. Las pruebas de vuelo a gran escala y consistencia temporal figuran como trabajo futuro. No hay benchmark de motion blur, FPS o latencia publicada en el texto revisado.

Para el prototipo, **manzana con deterioro visible** continúa siendo una opción razonable para experimentar con el FruitNet ya documentado en la auditoría previa y un localizador separado. Este nuevo artículo respalda que la separación en componentes es una arquitectura investigada; no valida las métricas de FruitNet ni garantiza detección sanitaria. La aprobación del modelo debe depender de video propio representativo.

## APIs consultadas y límites

| Servicio | Resultado real | Evidencia guardada |
|---|---|---|
| Semantic Scholar Graph API | Primer intento de búsqueda devolvió HTTP 429. No se insistió ni se usó clave. | `semantic_apple.error.json` |
| OpenAlex Works API | Funcionó sin clave: seis consultas, con títulos, DOI, abstract, OA/PDF y metadatos de los candidatos. | `openalex_*.json` con URL de consulta |
| arXiv Atom API | Funcionó sin clave: ocho resultados sobre manzana + enfermedad/sarna/pudrición + detección. | `arxiv_apple.xml`; consulta reconstruible desde la nota al final |
| DataCite REST API | Funcionó sin clave: metadatos y licencia de un dataset de fruto de manzana en huerto. | `apple_dataset_datacite.json` |
| GitHub REST API y raw | Solo lectura del repositorio enlazado por un artículo, sus archivos y licencias parciales. | `robot_repo.json`, `robot_tree.json`, `robot_*.txt` |

## Candidatos acotados

| Recurso primario | Qué aporta | Límite decisivo |
|---|---|---|
| [UAV apple pipeline, arXiv 2512.22990](https://arxiv.org/abs/2512.22990) | Arquitectura RGB con clasificación de frescura y localización, inferencia offline planteada en Raspberry Pi. | Pesos/código no enlazados; no evidencia publicada de cámara en vuelo con el clasificador de deterioro. Métricas separadas no equivalen a un detector conjunto con esa fiabilidad. |
| [Manalagi Apple Disease Dataset](https://data.mendeley.com/datasets/9zgkwwv9j8) | Ficha DataCite: CC BY 4.0, fruto en huertos de Poncokusumo, Indonesia; Healthy, Anthracnose, Black Pox, Powdery Mildew. Variaciones naturales de iluminación y ángulo. | 482 imágenes originales y 4,718 aumentadas según ficha. Antes de entrenar se debe comprobar separación por original para evitar fuga. Es dataset, no pesos; no validación Perú/video. |
| [Rotten Apple Detection Using YOLOv12 for Postharvest Quality Sorting](https://jurnal.ubhinus.ac.id/index.php/J-INTECH/article/view/2290) | 2,312 imágenes anotadas; autores comunican precision .91, recall .89 y F1 .90. Publicación de junio de 2026. | Poscosecha. Página completa sin enlace de pesos/código detectado; no se revisó PDF. No acreditar disponibilidad de pesos ni diagnóstico de patógeno con ese resultado. |
| [Disease and Defect Detection System for Raspberries](https://doi.org/10.3390/app112411868) | Detector Faster R-CNN de defectos en frambuesas, evaluación industrial. | Abstract explícito: fruta ya en bandeja y promedio 30 s/imagen; no vuelo/huerto. XML editorial bloqueado con 403; disponibilidad de pesos/datos sin verificar. |
| [Real-Time Grading of Defect Apples](https://pmc.ncbi.nlm.nih.gov/articles/PMC9563605/) | Segmentación y detección de defectos en transportador con bandejas separadas. | Poscosecha, no cámara de huerto; declaración completa dice datos bajo solicitud y no públicos. No pesos públicos verificados. |

## Hallazgo útil para el futuro espacio virtual

[Active Robotic Perception for Disease Detection and Mapping in Apple Trees](https://arxiv.org/abs/2603.23112) enlaza [husky_xarm6_mcr](https://github.com/Feddockh/husky_xarm6_mcr). Su árbol público incluye mundos Gazebo de huerto de manzanos, URDF del robot, planificador de nuevas vistas y mapa de ocupación. README indica ROS2 Humble, Ubuntu 22.04 y Gazebo Ignition Fortress. Algunos directorios contienen texto de permiso tipo MIT; GitHub no detecta una licencia global, por lo que hay que comprobar cobertura por paquete y recursos antes de reutilizar. No se instaló ni ejecutó.

Es útil como referencia del mecanismo general: registrar posición y confianza, observar de nuevo desde otro ángulo y resolver oclusiones antes de actuar. Su tarea es fuego bacteriano en **ramas de árboles dormantes**, con árbol de laboratorio y cinco árboles simulados; no clasifica manzanas podridas ni prueba vuelo. No hay checkpoints `.pt`, `.pth`, `.onnx`, `.h5` o `.safetensors` en el árbol revisado.

## Cómo leer los resultados

La evidencia separa tres niveles: fruta visible/localizada, síntoma o deterioro identificado y decisión de retirar/tratar. Ninguno de los trabajos nuevos verificados acredita juntos modelo descargable licenciado, alta sensibilidad en fruto dentro de huerto y robustez de video desde dron. Esto deja una brecha comprobable y abordable en un prototipo; no demuestra inexistencia universal.

Consulta arXiv: `https://export.arxiv.org/api/query?search_query=all%3Aapple+AND+%28all%3Arot+OR+all%3Adisease+OR+all%3Ascab%29+AND+all%3Adetection&start=0&max_results=8&sortBy=relevance`.
