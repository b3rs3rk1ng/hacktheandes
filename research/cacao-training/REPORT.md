**Cacao / moniliasis: primer entrenamiento terminado — 18 de octubre de 2026**

Entrené YOLO11n por SSH en `laptop`, con la RTX 4060 de 8 GB. **Es rápido, pero esta versión todavía no es suficientemente fiable para decidir retirar fruta autónomamente.** La limitación principal observada es la generalización: confunde mazorcas sanas y otras enfermedades con monilia. No se ejecutaron vuelos ni retiros físicos.

El [checkpoint](artifacts/monilia-yolo11n.pt) pesa 5.51 MB. Se ajustó un modelo preentrenado durante 50 épocas a 640 píxeles, batch 16, semilla 20261018. El entrenamiento tardó aproximadamente 7 minutos 43 segundos, además de descarga, preparación y evaluación. Se eligió el checkpoint por validación, sin ajustar hiperparámetros sobre los resultados de prueba.

**Resultados sobre imágenes reservadas**

El umbral de alerta es 0.21, elegido exclusivamente en validación para maximizar F1 con precisión de síntomas ≥90% cuando fuera posible. En esa validación alcanzó 92.1% de precisión y 85.3% de recall; esa cifra no se sostuvo en prueba.

| Prueba | Precisión de las alertas | Recall: frutos afectados encontrados | Conteos |
|---|---:|---:|---|
| Interna: síntomas m1/m2/m3, 251 fotos | 73.6% | 79.2% | 145 aciertos, 52 alertas falsas, 38 omisiones |
| Externa: monilia específica, 312 fotos | 25.8% | 53.1% | 77 aciertos, 222 alertas falsas, 68 omisiones |

Precisión es la proporción de alertas que coincide con un objeto anotado de la clase correspondiente; recall es la proporción de objetos afectados anotados que encuentra. El emparejamiento es uno a uno con IoU ≥0.5; cuentan omisiones, detecciones adicionales y confusiones de clase. La prueba externa conserva fitóftora como otra enfermedad, por lo que llamarla monilia cuenta como error de diagnóstico.

En la prueba interna, **40 de 81 mazorcas anotadas sin síntomas recibieron alguna detección sintomática emparejada**. Algunas pueden tener también una detección sana: es un indicador conservador del riesgo de actuar ante cualquier alerta, no una simulación de 40 retiros realizados. [Ejemplo de falsa alarma con confianza alta](evidence/evaluation/clean/7321836bd946.jpg).

Para la etapa inicial `m1`, encontró síntomas en **46/72 mazorcas (63.9%)**; asignó la etapa exacta a 40/72. Para `m3`, la etapa avanzada, la precisión de etapa fue 88.0% y el recall 63.8%, al mismo umbral operativo.

La métrica nativa de las cuatro clases es **mAP50 60.8% / mAP50–95 58.3%** en prueba interna. Son métricas de detección y clasificación de etapa, no porcentajes de exactitud. Los intervalos Wilson disponibles en el JSON tratan mazorcas como independientes; la dependencia entre tomas puede aumentar la incertidumbre.

**Movimiento y velocidad**

Se aplicaron alteraciones sintéticas a las mismas 251 fotos y se mantuvo el umbral congelado. El blur es horizontal y se aplica a imágenes de hasta 1280 píxeles antes del preprocesado a 640.

| Alteración | Precisión de síntomas | Recall de síntomas |
|---|---:|---:|
| Sin alteración | 73.6% | 79.2% |
| Blur 5 píxeles | 74.9% | 76.5% |
| Blur 11 píxeles | 69.4% | 69.4% |
| Blur 21 píxeles | 62.3% | 67.8% |
| Brillo ×0.6 | 73.7% | 78.1% |
| Brillo ×1.4 | 71.1% | 76.5% |
| Reducir resolución a la mitad | 76.5% | 78.1% |

Con blur fuerte, 54/81 sanas recibieron una alerta sintomática. Que aumente algún recall de etapa temprana al difuminar no demuestra una mejora: también aumenta ese error.

En la RTX 4060, FP32, batch 1: **mediana 9.38 ms y percentil 95 de 10.55 ms por foto**, con diez calentamientos y sincronización CUDA. Incluye lectura/decodificación, preprocesado, inferencia, NMS y transferencia de cajas a CPU. Excluye cámara, transmisión, seguimiento, navegación y actuación; no es una medición del dron completo. La instrumentación se corrigió para leer el dispositivo del predictor real de Ultralytics, que mantiene una copia en CUDA aunque el objeto principal permanezca en CPU; se repitió la evaluación sin modificar pesos ni criterio de decisión.

**Datos y controles**

Se usaron las imágenes del [espejo AgML](https://huggingface.co/datasets/Project-AgML/cocoa_monilia_detection) fijado a una revisión y verificado por SHA256, con las **anotaciones originales de [CocoaMoniliaDataSet v2](https://zenodo.org/records/17716661)**. Se corrigió la orientación EXIF; las cajas convertidas del espejo tienen errores geométricos en algunas fotos verticales y no se usaron.

De 1950 archivos se fusionaron 39 filas duplicadas y se excluyeron 39 familias de imagen: 31 con categoría `m4` no documentada y ocho con etapas contradictorias superpuestas. Quedaron **1872 imágenes y 2031 cajas**: 1405/216/251 imágenes en entrenamiento/validación/prueba. Los duplicados exactos combinan sus anotaciones antes de dividir.

Los días inferidos de nombres y vecinos por hash perceptual se mantienen en una misma partición. Predomina febrero 29 en validación y agosto 2 en prueba. **50 fotos de prueba no tienen fecha recuperable** y se agrupan por sus duplicados/vecinos visuales. No hay IDs fiables de finca o árbol: esta separación reduce filtraciones evidentes, pero no garantiza independencia por planta. Tampoco hay un conjunto de video real de dron ni una evaluación específica de escenas sin frutos. Algunas fotos muestran otras mazorcas sin caja, lo que limita la exhaustividad de las etiquetas.

La prueba externa usa el [dataset original de Serrano/Torres, versión 2](https://www.kaggle.com/datasets/serranosebas/enfermedades-cacao-yolov4): **312 fotos y 1591 cajas**, todas reservadas para evaluación. Sus IDs originales se verificaron en tres `classes.txt`; los directorios no determinan las clases. Se registraron 14 ajustes de redondeo dentro de una tolerancia normalizada explícita de 10⁻⁶, sin excluir fotos. No se encontraron duplicados perceptuales con el conjunto interno a distancia ≤4. Contiene escenas más amplias y numerosas mazorcas pequeñas, por lo que no equivale a una prueba exclusiva de primeros planos.

De 227 mazorcas anotadas con fitóftora, **110 recibieron una predicción de monilia**. Si se agrupan ambas enfermedades como «cualquier enfermedad anotada», la precisión externa es 62.5% y el recall 50.3%; eso no valida el diagnóstico específico de monilia. No se entrenó ni se seleccionó el umbral con este conjunto externo.

**Qué usaría para la hack**

Este checkpoint permite construir y medir el prototipo visual. Mantendría las detecciones como alertas revisables en la simulación. El siguiente trabajo con mayor respaldo en estos resultados es recopilar y anotar imágenes de la cámara prevista, incluyendo mazorcas sanas de distintas variedades, otras enfermedades, fondos sin frutos y secuencias en movimiento; conservar una prueba nueva independiente para medir la siguiente versión. Más épocas por sí solas no demuestran que se resuelvan estos errores.

`h0` significa sin síntomas anotados; no certifica ausencia de infección latente. Las etiquetas son de datasets públicos y no constituyen diagnóstico de laboratorio ni validación de control sanitario.

**Archivos y reproducción**

- [Métricas internas y alteraciones](evidence/evaluation/evaluation.json), [mAP por clase](evidence/evaluation/ultralytics_metrics.json) y [selección del umbral](evidence/evaluation/threshold_selection.json).
- [Métricas externas](evidence/external-evaluation/evaluation.json) y [auditoría de sus anotaciones](evidence/external-evaluation/audit.json).
- [Entorno y configuración real](evidence/runs/environment.json), [registro de entrenamiento](evidence/runs/results.csv) y [comandos](README.md).
- Pasaron **21 pruebas**: siete de preparación, ocho de métricas/remapeo y seis de tolerancias del adaptador. Se revisaron visualmente cajas originales, ejemplos de preparación y predicciones.

La laptop conserva el trabajo en `/home/f3mt0/hacktheandes-cacao-training`. El peso original está en `runs/baseline/weights/best.pt`; los resultados finales en `evaluation-v2` y `external-evaluation`. No se integró todavía al simulador.

Fuente de entrenamiento CC BY 4.0: Joan Francisco Alvarado Molina, Juan F. Restrepo-Arias, David Velásquez, John Willian Branch Bedoya y Mikel Maiza, DOI 10.5281/zenodo.17716661. El software/modelo base Ultralytics usa AGPL-3.0 salvo licencia comercial alternativa. La fuente externa declara condiciones de base de datos abierta y contenido © autores originales; no se redistribuye aquí su corpus.
