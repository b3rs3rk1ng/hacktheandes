# Pera: auditoría de modelos y pertinencia peruana

Fecha: 2026-10-17. Alcance: investigación; no se descargaron pesos completos ni se ejecutó inferencia. Las métricas siguientes son declaradas por sus autores, no mediciones nuestras.

## Dictamen

**Ningún candidato verificado cumple simultáneamente pesos utilizables, licencia, métricas altas externas, diagnóstico de fruto desde dron, validación peruana y problema grande específicamente en pera.** Hay clasificadores ejecutables de hojas; eso no demuestra qué pera debe retirar el dron. No es posible garantizar ausencia de objeciones del jurado.

## Candidatos

| Candidato | Qué detecta | Métricas y evaluación | Disponibilidad | Límite para este proyecto |
|---|---|---|---|---|
| [ixrbhii/pear-disease-convnext](https://huggingface.co/ixrbhii/pear-disease-convnext) | Clasifica foto de **hoja**: Black Spot, Fire Blight, Healthy, Leaf Spot, Slug | Accuracy 96.8%, macro-F1 0.972; 631 fotos de test procedentes de los mismos datasets. Recall Slug 90.7%, Leaf Spot 95.7%. | CC-BY-4.0. API lista `config.json` y `model.safetensors`; HEAD del peso devolvió HTTP 200, 98,950,890 bytes. ConvNeXt-Small, 224×224, 49.5 M parámetros, PyTorch/timm. Inferencia individual razonablemente compatible con RTX4060 8GB, pero no medida. | Hoja dominante y enfocada; no localiza fruto ni tallo. Card advierte menor desempeño en fotos reales de campo. Sin test peruano ni aéreo. |
| [Wb-az/yolov8-disease-detection-agriculture](https://github.com/Wb-az/yolov8-disease-detection-agriculture) | Enfermedad en hojas de pera, DiaMOS Plant | `detect/grid-opt/results.csv`, última época 15: precision 0.91573; recall 0.80435; mAP50 0.90757; mAP50-95 0.7497. Son métricas de validación, no test externo. | LICENSE MIT en repo; árbol API contiene `detect/grid-opt/weights/last.pt`, 22,504,281 bytes. Archivo no cargado ni verificado como checkpoint. | No confundir mAP50 con exactitud clínica. Hojas, recall moderado, nada sobre seleccionar peras enfermas ni Perú. |
| [Pear-pests-dataset / LoRA VFM](https://huggingface.co/datasets/salahkhenfer/pear-pests-dataset) | Seis categorías de hojas: beetle, black block, dry blight, health, rust, scab | Card declara mejor configuración DaViT-base LoRA32: F1 0.8769; mAP50 0.9171. 2,210 fotos; split 1,542 entrenamiento / 668 validación, sin test peruano. | Dataset CC-BY-4.0; no se verificaron pesos del detector publicados. | Es principalmente un dataset/benchmark, no un modelo listo. Etiquetas no identifican todas las especies causales. |
| [KFP-YOLO, Agriculture 2026](https://www.mdpi.com/2077-0472/16/15/1631) | Varias partes de peral Korla: hojas, flores y frutos; incluye Grapholita molesta en fruto y fire blight de fruto | Test externo 1,052 imágenes/3,377 instancias: mAP50 0.9325; mAP50-95 0.7322; precision 0.8814; recall 0.9077. 1.93M parámetros. | Publicación y métricas explícitas. No se encontró repositorio autoral con pesos/licencia de modelo verificables. Acceso directo MDPI limitado por HTTP429; búsqueda indexada permitió leer resultados. | Candidato científico más cercano al órgano correcto, pero no listo para conectar. No datos Perú, no validación de cámara del dron. El paper reconoce fallos de oclusión y blancos distantes. |

No se deben traducir los 278.97 FPS publicados por KFP-YOLO a nuestra laptop ni a un sistema robótico completo.

Otros descartes: [detección de daño por carpocapsa con rayos X](https://www.sciencedirect.com/science/article/pii/S0956713525007923) reporta hasta 97% accuracy pero usa radiografía poscosecha, no RGB aéreo. [Defectos de superficie Yuluxiang](https://doi.org/10.3390/agronomy12092076) reporta 95.28% test accuracy y F1 0.928–0.965, pero clasificación de calidad poscosecha no prueba identificación de una plaga importante en Perú ni pesos disponibles.

## ¿La plaga existe y es grande en Perú?

**Sí hay evidencia primaria de mosca de la fruta en sistemas que incluyen peras. No se verificó pérdida grande cuantificada específicamente en pera.**

- [SENASA, Valle Sagrado, 2021](https://www.senasa.gob.pe/senasacontigo/senasa-mantiene-vigilancia-fitosanitaria-de-moscas-de-la-fruta-en-12790-hectareas-del-valle-sagrado/): vigilancia de 12,790 ha y 481 trampas; lista pera entre varios cultivos hospedantes. Esas hectáreas son multicultivo, **no superficie de pera ni incidencia en pera**.
- [Informe original SENASA de no hospedante palta, 2010](https://repositorio.senasa.gob.pe/bitstream/SENASA/149/1/2010_SENSA_Informe-No-hospedante-palta-peru.pdf): su tabla49 de hospedantes naturales en fundo Santa Patricia, Lima, 2009, incluye pera: marzo 10 frutos/4 infestados/11 adultos C. capitata; abril 24/4/17. Prueba de infestación local histórica, no prevalencia nacional actual.
- [INACAL, 2024](https://www.gob.pe/institucion/inacal/noticias/1014173-inacal-promueve-especificaciones-tecnicas-para-la-comercializacion-de-la-pera-en-estado-fresco): citando MIDAGRI, alrededor de 936 ha de pera en Perú; destaca Caravelí. No sustenta afirmar magnitud nacional comparable a cacao/cítricos/palta.
- [SENASA, labores culturales, 2021](https://www.senasa.gob.pe/senasacontigo/senasa-prepara-a-productores-en-labores-culturales-para-erradicar-las-moscas-de-la-fruta/): retirar y enterrar frutos remanentes, infestados y sin valor comercial es parte del control cultural de moscas. Esto **no prueba** que los modelos de hojas anteriores detecten larvas dentro de una pera.

No se usaron normas de importación para inferir presencia peruana de Erwinia amylovora, roya o carpocapsa. Que un modelo tenga esas clases tampoco prueba pertinencia local.

## Conexión con dron

Tevel enumera pera como fruta objetivo; la auditoría del fabricante la realiza el agente principal. Eso acredita alcance de cosecha del fabricante, no disponibilidad abierta de su robot/controlador, ni control fitosanitario de pera, ni transferencia automática de un detector foliar.

Para pasar a integración faltaría un detector de **frutos infestados** con pesos y licencia, sensibilidad/especificidad en fotografías peruanas externas, evidencia de síntomas visibles desde el punto de vista del dron, y validación de retiro/confinamiento sanitario. Hoy pera no es recomendación sólida para este objetivo.
