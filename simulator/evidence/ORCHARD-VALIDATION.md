# Validación de entrega — 18 octubre 2026

La aplicación ejecuta Webots/ODE, el render de la cámara en el navegador y el checkpoint YOLO11s entrenado en la RTX 4060. Las pruebas consumieron fotogramas RGB efectivos de la cámara virtual, sin reemplazar detecciones ni suministrar candidatos falsos.

| Prueba | Resultado | Tiempo de pared | Árboles completados | Carga final | Evidencia |
|---|---|---:|---:|---:|---|
| Regreso por reserva | Correcto | 9.6 s | 0 | 13.42% | [traza](orchard-reserve-flight.json) |
| Retirada y depósito | Correcto | 59.6 s | 1 | 43.70% | [traza](orchard-harvest-flight.json) |
| Inspección de varios árboles | Correcto | 91.7 s | 3 | 44.60% | [traza](orchard-inspection-flight.json) |

Las tres trazas corresponden a la configuración final: 7.80 ha, 1190 árboles de cacao y cuatro ángulos a dos alturas por árbol. El tiempo acelerado estaba activado. El estado de carga inicial se fija expresamente al preparar cada prueba.

En la retirada, el modelo señaló `cacao-0-18-pod-3` con confianza 0.9064. Su etiqueta de evaluación es monilia. Se confirmó el agarre, se liberó el tallo, se transportó y depositó el fruto dentro del recipiente, se aterrizó y se verificó aumento real de carga. Confianza de una detección no es precisión de la misión.

En la prueba de reserva se inició con 16% de carga, se disparó el regreso por presupuesto energético y se confirmó carga creciente en base, con aproximadamente 13.4% restante. La inspección completó tres árboles y llegó al siguiente sin retirar frutos.

Además pasaron **10 pruebas de control/energía/navegación y 7 de contratos HTTP/observaciones**, y la comprobación de sintaxis de JavaScript. El navegador no registró errores ni advertencias de consola durante la comprobación final. Se observaron aproximadamente 40–56 fps en el navegador de QA y 43–48 ms de inferencia en muestras; son observaciones puntuales, no un benchmark de hardware.

## Capturas

- [Cámara del dron durante inspección](orchard-final-fpv.png)
- [Seguimiento del dron en el huerto](orchard-final-flight.png)
- [Base después de depositar](orchard-final-base.png)

## Alcance y límites

No se ejecutó toda la ruta de 1190 árboles ni una recarga completa hasta 95% seguida de reanudación. Los estados principales sí se ejercitaron. El motor de batería requiere calibración con un vehículo físico; la pinza y el corte son idealizados, el control usa pose conocida y la asociación de cajas a frutos usa geometría del simulador. La apariencia es 3D procedural con materiales fotográficos y hojas generadas, sin equivalencia garantizada a vídeo real.

Las texturas de frutos proceden del conjunto de entrenamiento. Esto valida integración y comportamiento de la demo; **no es una evaluación independiente de visión, ni validación de vuelo real**. Se conserva una falsa alerta observada durante desarrollo en `development-notes.json` y su captura, sin atribuirla como tasa de la configuración final.

Checkpoint SHA256: `4a72c36e6aed0db8c5f39b637a918da28e4386644ceb52c7b9d8446efb9a9d33`.

[Arquitectura, reproducción, materiales y límites](../ORCHARD.md).
