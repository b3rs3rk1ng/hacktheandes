**Cacao / moniliasis: segunda ronda terminada — 18 de octubre de 2026**

El nuevo YOLO11s encuentra muchos más casos que los pesos anteriores bajo la misma política de selección. **Es prometedor para el prototipo, pero todavía no justifica retirar fruta de forma autónoma.** La prueba nueva por imagen es favorable; la regresión por mazorca sigue mostrando un riesgo importante de actuar sobre fruta sana.

Entrené por SSH en `laptop`, RTX 4060 de 8 GB: detector de tres clases, **sano / Monilia / Phytophthora**, 40 épocas a 640 píxeles, batch 8. El entrenamiento tardó unos **22 minutos**, además de preparación y evaluación. También entrené EfficientNet-B0 como revisión de cada recorte: terminó en 2 minutos 12 segundos, con parada temprana en la época 9 y mejor checkpoint en la 3. El detector sin ese clasificador ganó la comparación de validación.

El [modelo elegido](artifacts/detector-yolo11s.pt) pesa **19.16 MB**; su [ficha y política de inferencia](artifacts/model-card.json) conserva los hashes y límites de uso. No se integró todavía al simulador ni se ejecutaron vuelos o retiros físicos.

**Prueba nueva: alertas por imagen**

Se reservaron antes de inferir 400 fotografías de una fuente nueva: 200 sanas y 200 con Monilia. Una sana se excluyó por similitud con otra de la propia muestra; quedaron **399 imágenes: 200 positivas y 199 negativas**. Ninguna entró en entrenamiento ni selección de umbral o arquitectura.

| Modelo | Precisión de alertas | Recall de imágenes con Monilia | Aciertos / falsas alarmas / omisiones |
|---|---:|---:|---|
| Pesos anteriores, recalibrados | 94.7% | 36.0% | 72 / 4 / 128 |
| **YOLO11s elegido** | **96.0%** | **95.5%** | **191 / 8 / 9** |

El nuevo modelo activó alertas en **8/199 fotos etiquetadas sanas (4.0%)**. Los intervalos Wilson del 95% son 92.3–97.9% para precisión y 91.7–97.6% para recall, tratando imágenes como independientes; la dependencia entre tomas puede ampliar la incertidumbre.

Esta fuente sólo tiene etiquetas por imagen. Una alerta correcta **no verifica que la caja localice la mazorca enferma**, y no permite calcular mAP de detección. Además, las fotos enfermas incluyen frutos recogidos sobre tela negra y las sanas frutos en árboles: el fondo está asociado a la clase y puede facilitar el resultado. No se midió cuánto depende el modelo de ese fondo. El balance 200/199 tampoco representa la prevalencia real de una chacra.

[Resultados completos](evidence/benchmark-v1/benchmarks/new_image_test/detector_v2/evaluation.json), [comparación emparejada](evidence/benchmark-v1/comparisons/new_image_test.json) y [seis pares de ejemplos elegidos por ID](evidence/prediction-pairs.png). Los ejemplos se eligieron sin mirar aciertos y sus cajas son predicciones, no anotaciones reales.

**Regresión: detección por mazorca**

El antiguo test ya influyó en decisiones de desarrollo; por eso ahora se llama regresión. De sus 251 fotos quedaron **247** tras conservar un representante por familia visual: **180 mazorcas con síntomas y 80 sanas anotadas**. Ambos modelos usan exactamente las mismas imágenes, cajas y política de emparejamiento uno a uno, IoU ≥0.5.

| Modelo | Precisión | Recall | Aciertos / falsas detecciones / omisiones | Sanas con alerta de Monilia |
|---|---:|---:|---|---:|
| Pesos anteriores, recalibrados | 83.3% | 50.0% | 90 / 18 / 90 | 18/80 |
| **YOLO11s elegido** | **82.7%** | **82.2%** | **148 / 31 / 32** | **29/80** |

**Encontrar más afectados no resolvió las falsas alarmas.** En esta comparación el nuevo modelo también alerta sobre más mazorcas sanas. Los conteos son un indicador de riesgo de actuación, no retiradas realizadas. El objetivo de precisión ≥95% alcanzado en validación no se mantuvo aquí.

Para síntomas iniciales `m1`, el recall subió de **24/70 (34.3%) a 44/70 (62.9%)**. En el nuevo modelo es 40/42 (95.2%) para `m2` y 64/68 (94.1%) para `m3`. Sigue siendo más débil al inicio de la enfermedad; estas etiquetas no certifican infección latente ni diagnóstico de laboratorio.

[Comparación por objeto](evidence/benchmark-v1/comparisons/regression.json) y [resultados con procedencia de etapa](evidence/benchmark-v1/benchmarks/regression/detector_v2/evaluation.json).

**Desenfoque y velocidad**

Se mantuvieron modelo y umbral congelados. El blur horizontal de 11/21 píxeles es una alteración sintética sobre fotos de hasta 1280 píxeles; no representa una velocidad de vuelo concreta.

| Cohorte / alteración | Precisión nueva | Recall nuevo | Recall anterior recalibrado |
|---|---:|---:|---:|
| Nuevas imágenes / sin alteración | 96.0% | 95.5% | 36.0% |
| Nuevas imágenes / blur 11 | 97.4% | 95.5% | 11.0% |
| Nuevas imágenes / blur 21 | 93.2% | 96.0% | 11.0% |
| Regresión por objeto / sin alteración | 82.7% | 82.2% | 50.0% |
| Regresión por objeto / blur 11 | 85.6% | 72.8% | 27.2% |
| Regresión por objeto / blur 21 | 79.5% | 66.7% | 17.8% |

La resistencia al blur mejora respecto a la referencia bajo estas políticas. Que alguna métrica aumente al difuminar no demuestra una mejora en vuelo. En regresión, blur 21 todavía genera alertas sobre 27/80 sanas.

En la RTX 4060, FP32 y batch 1, el modelo nuevo tarda **10.16 ms de mediana / 11.41 ms p95** por foto nueva sin alteración; en regresión, 10.87 / 12.29 ms. Incluye decodificación, preprocesamiento, inferencia, NMS y salida a CPU con sincronización CUDA. Excluye captura, transmisión, navegación y actuación; no es una medición en el hardware del dron. La latencia de los escenarios con blur incluye el coste de generar esa alteración.

**Selección y trazabilidad**

Se usaron 1655 fotos originales de entrenamiento más una variante de luz/blur por foto, y 278 de validación. Las clases se remapean mediante configuración; se conservan grupos, identidades visuales y etapas de origen. Serrano/Torres, antes inspeccionado como test externo, pasó explícitamente a desarrollo y conserva sanas y Phytophthora.

El criterio predeclarado busca precisión de Monilia ≥95%, recall ≥50% y al menos 20 alertas; entre candidatos factibles elige mayor F1. En validación, el detector solo alcanzó **95.45% de precisión y 72.10% de recall**, frente a 95.36% / 61.80% con el clasificador. Se eligió el primero y se congeló su umbral **0.74** antes de ejecutar ambas pruebas. El baseline conserva sus pesos originales, pero recalibra su umbral a **0.89** sobre la misma validación. Estos resultados no son una comparación con su antiguo umbral 0.21.

Ambos usan propuestas desde 0.05, NMS independiente de clase con IoU 0.7 y entrada 640. Las referencias y pruebas se agrupan globalmente por componentes transitivos de identidad RGB/pHash; toda familia conectada a referencias se excluye y las familias propias de prueba conservan un representante. No hay IDs fiables de finca o árbol. Los hashes son controles de similitud, no prueba de independencia por planta.

La [decisión congelada](evidence/benchmark-v1/frozen_selection.json), [configuración real](evidence/benchmark-v1/run_config.json), [auditoría de preparación](mixed-audit.json) y [registro completo](evidence/benchmark-v1/progress.jsonl) permiten revisar la secuencia. Antes de cada evaluación se verifican hashes de selección, pesos, configuraciones y metadatos. Las pruebas funcionales comprobaron contratos de ROI, métricas, familias transitivas, separación de fuentes, selección sólo en validación, integridad de la decisión y conservación del intérprete virtual.

Fuentes y reproducción en [README.md](README.md). Mendeley y CocoaMonilia publican CC BY 4.0; los términos de Serrano y los de Ultralytics se conservan por separado. El muestreo verifica CRC32 de cada imagen, pero no SHA256 de los archivos RAR completos.

Para la hack, esta versión aporta un detector medido que puede alimentar alertas y decisiones revisables en el espacio virtual. Falta comprobar escenas y secuencias de la cámara prevista en vuelo, fondos sin frutos y la actuación sobre mazorcas antes de habilitar retirada real. Las cifras actuales no demuestran uso industrial cotidiano, intervención agronómica óptima ni ahorro económico.
