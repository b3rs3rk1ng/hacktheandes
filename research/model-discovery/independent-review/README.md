# Revisión independiente: fruto afectado y cámara en movimiento

Consulta documental del 17 de octubre de 2026. Alcance: manzana, pera, durazno, nectarina, ciruela, damasco y frambuesa. Se revisaron primero `research/fruit-audit/README.md`, `apple.md` y `shared-findings.md`. No se ejecutó inferencia, no se midió latencia y no se instaló ni modificó simulador alguno. No se investigó cacao.

## Resultado para decidir

**Manzana con podredumbre visible + FruitNet es una pieza inicial viable para probar una demo**, por tener pesos pequeños, licencia MIT y orden de clases e inferencia publicados. Eso permite empezar una evaluación real; todavía no permite calificarla de excelente para un huerto ni de detector de una enfermedad específica. La implementación de webcam toma una foto al hacer clic: no demuestra robustez en video ni vuelo.

No se encontró aquí un modelo descargable con licencia clara que ya demuestre detectar patógeno de estos frutos, localizar cada fruto en el árbol y conservar fiabilidad en cámara móvil. No es una afirmación de inexistencia: la búsqueda tiene el alcance y los límites que se documentan abajo.

## Dos candidatos

| Candidato | Artefacto/licencia comprobados | Tarea y evidencia | Límite que importa |
|---|---|---|---|
| [FruitNet, OleksandrKlanovets](https://github.com/OleksandrKlanovets/fruitnet) | `config/fruit_classifier_v3_transfer_learning.h5`, **9.428.816 bytes**, presente en árbol GitHub; licencia MIT del repositorio. | MobileNetV2, seis categorías fresco/podrido de manzana, banana y naranja; autor declara 99% en su test de Kaggle. Código publica labels y resize RGB a 160×160. | **Clasificador de foto/recorte**, sin cajas, máscaras, tracking, clase desconocida ni patógeno. No hay test de huerto/cámara móvil documentado. El 99% es del autor, no medición nuestra. |
| [RicardoPoleo/custom_cnn_model](https://huggingface.co/RicardoPoleo/custom_cnn_model) | API a revisión `1f5b2756a7591ebb2e48285715c1657b6298d68f`: H5 **23.683.892 bytes**. Card declara CC0-1.0. | Clasificador Keras, 28 clases de productos sanos/podridos, entrada 128×128; autor declara 88,6% en validación. | No hay métricas por manzana ni test externo de huerto/video. No se publica un archivo separado con el orden de las 28 clases y la card no lo documenta; hay que recuperar/verificar ese contrato antes de interpretar índices. No se inspeccionó el interior del H5. |

Las métricas se refieren a datasets y tareas distintas; no constituyen una comparación justa entre ambos. La licencia declarada por cada publicador no es una auditoría de la procedencia completa de todas sus imágenes de entrenamiento.

Evidencia reproducible:

- [Árbol de archivos FruitNet](https://api.github.com/repos/OleksandrKlanovets/fruitnet/git/trees/master?recursive=1), [inferencia](https://github.com/OleksandrKlanovets/fruitnet/blob/master/model/fruitnet.py), [licencia](https://github.com/OleksandrKlanovets/fruitnet/blob/master/LICENSE).
- [Webcam FruitNet](https://github.com/OleksandrKlanovets/fruitnet/blob/master/static/js/capture.js): `webcam-classify-btn` invoca captura al pulsar; la existencia de `getUserMedia` no valida inferencia continua.
- [Metadatos RicardoPoleo](https://huggingface.co/api/models/RicardoPoleo/custom_cnn_model), [archivos a revisión concreta](https://huggingface.co/api/models/RicardoPoleo/custom_cnn_model/tree/1f5b2756a7591ebb2e48285715c1657b6298d68f?recursive=true).

## Hallazgos que no cumplen el filtro

- `cvtechniques/rotttenfruits` ya auditado: sigue sin checkpoint ni licencia publicados en la revisión `5a79fc87c38cf9db90f493c322d063c89819dcc7`. Sus cifras altas en cinta transportadora no son una pieza descargable lista para huerto.
- [gauravkal006/Fruit_freshness_detection](https://github.com/gauravkal006/Fruit_freshness_detection) sí contiene `models/best.onnx` (6.181.675 bytes) y `models/best.pt` (12.539.223 bytes); API GitHub devuelve `license: null` y no hay archivo de licencia en el árbol revisado. No se recomienda como modelo abierto sin aclarar permiso. Además su análisis de manchas incluye reglas de color; no equiparar ese resultado con diagnóstico de patógeno.
- [akyurekkadir/iot-smart-fridge](https://github.com/akyurekkadir/iot-smart-fridge) contiene `model/best.pt` (6.205.866 bytes), pero tampoco publica licencia en árbol/metadatos revisados.
- `Udit62/Fruit-Quality-Detector` y `YashwanthaY/Fruit-Quality-Detection-using-ML`: no checkpoint `.pt`, `.pth`, `.h5`, `.keras`, `.onnx` ni licencia encontrados en los árboles revisados; mencionar un modelo en README no demuestra que se distribuya.
- `sharktide/fruitbot0` incluye categorías de manzana podrida y manzana con gusano, pero usa Fruits-360 y no publica licencia en metadatos. Su sucesor `fruitbot-expanded` **elimina** esas categorías: clasifica 36 tipos de productos, sin condición sanitaria. No asumir mejora aplicable al caso por el nombre de versión.
- [RaspGrade](https://huggingface.co/datasets/FBK-TeV/RaspGrade) es un **dataset** CC BY-NC-4.0 de graduación/calidad en cinta transportadora, no un modelo ya listo para diagnóstico de Botrytis en planta. [Publicación](https://arxiv.org/abs/2505.08537).
- [Disease and Defect Detection System for Raspberries, 2021](https://www.mdpi.com/2076-3417/11/24/11868) trabaja con bandejas industriales y Faster R-CNN/Matlab. No apareció aquí una descarga de pesos con licencia apta. Acceso directo al artículo devolvió HTTP 429 durante esta revisión; sólo se obtuvo el contenido indexado de la fuente primaria, por lo que no se atribuye revisión completa del trabajo.

## Qué justifica retirar un fruto enfermo

Hay fundamento sanitario concreto para algunos patógenos; **no toda manzana que FruitNet llama podrida queda diagnosticada con ellos**.

- **Manzana, podredumbre negra:** [UMN Extension](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/yard-and-garden-problems/black-rot-of-apple) documenta que el hongo sobrevive en cancros y frutos momificados. Su saneamiento incluye recoger los frutos secos que permanecen en el árbol y retirar material infectado fuera de la zona. Recolectar fruta es una parte del manejo; los cancros y otras fuentes permanecen. La recomendación local de Minnesota no prueba por sí misma prevalencia ni impacto económico en Perú.
- **Durazno/nectarina/damasco, Monilinia:** [UC IPM](https://ipm.ucanr.edu/home-and-landscape/brown-rot-blossom-and-twig-blight/) recomienda inspección periódica, retirar frutos afectados antes de producir esporas y continuar retirando frutos que se pudren al madurar. Es un encaje agronómico fuerte para selección y retiro, pero no se encontró aquí un checkpoint listo de esa enfermedad para esos frutos.
- **Frambuesa, moho gris/Botrytis:** [UMN Extension](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-raspberries-in-the-home-garden) recomienda quitar bayas con moho gris para reducir propagación a frutos que maduran. Nuevamente, falta el modelo listo de fruto en planta con cámara normal.
- **Fumigar fruta ya podrida no equivale a curarla:** [UC IPM para durazno](https://ipm.ucanr.edu/agriculture/peach/ripe-fruit-rot/) describe fungicidas preventivos para Monilinia/Botrytis, aplicados antes de la infección; la foto de podredumbre no basta para elegir producto ni momento.

## Prueba mínima antes de elegir el modelo de la hack

1. Localizar manzanas con un detector y clasificar **recortes**, preservando el preprocesamiento del modelo. La localización es otra capacidad y requiere su propia validación.
2. Evaluar videos reales con recorrido cercano: luz variable, oclusión por hojas, movimiento/desenfoque y cambios de distancia. Separar prueba por secuencia/huerto, no por fotogramas casi idénticos.
3. Medir decisiones por **fruto seguido**, con falsos retiros de fruto sano, sensibilidad de afectados, latencia hasta decisión y abstenciones. La velocidad en FPS y la accuracy de fotos no resuelven esos riesgos por sí solas.
4. Antes del retiro, ralentizar o detenerse y confirmar con varias vistas. El consenso temporal debe calibrarse con datos; repetir una predicción equivocada no crea evidencia independiente.

Recomendación de promesa para demo: «prototipo de inspección y retiro de manzanas con podredumbre visible, evaluado en estas condiciones». La enfermedad exacta, eficacia de control, integración física y ahorro en soles sólo se afirman si se validan aparte.
