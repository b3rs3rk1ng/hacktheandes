# Seis frutos compatibles según Tevel: auditoría de integración

Se asignó un agente por fruto. Investigación documental, sin ejecutar inferencia ni medir latencia. Métricas publicadas por autores en tareas y poblaciones diferentes: no se comparan como un ranking único. No encontramos una opción que cumpla la combinación solicitada: pesos abiertos con licencia clara, alta fiabilidad demostrada para seleccionar frutos afectados y plaga de gran impacto verificado en Perú. Esto no prueba inexistencia universal ni impide experimentar.

| Fruto | Evidencia pertinente | Bloqueo principal | Auditoría |
|---|---|---|---|
| Manzana | Agroscope, lesiones sarna en fruto: mAP50 .75, precision .64, recall .75 | No pesos encontrados; sin validación Perú | [apple.md](apple.md) |
| Durazno | DurAPP, clasificación fruto: CNN accuracy82.8%; baselineMobileNetV2 94.8% | No pesos/licencia de pesos encontrados; no localiza fruto | [peach.md](peach.md) |
| Nectarina | DCTNet, mezcla que incluye nectarinas: AP50 95.57%, F1 .91 | No métricas separadas nectarina, pesos ni código encontrados | [nectarine.md](nectarine.md) |
| Ciruela Prunus | YOLO-CMA, daño insectos: AP50 63.9%, recall54.5% | Rendimiento sanitario insuficiente para promesa altafiabilidad; pesos no verificados | [plum.md](plum.md) |
| Pera | KFP-YOLO, distintas partes del árbol: testexterno mAP50 93.25%, mAP50–95 73.22% | Sin pesos/licencia verificables; agregado no es fiabilidad por fruto | [pear.md](pear.md) |
| Damasco/albaricoque | APNet, distintos órganos/insectos: precision87.1%, recall75.6%, mAP50–95 43.6% | Sin pesos/licencia; múltiples clases no son frutos retirables | [apricot.md](apricot.md) |

Hay pesos públicos de clasificadores de HOJAS (manzana, durazno, pera) y localizadores de fruta para cosecha (ciruela ACFR). No equivalen a identificar una fruta con plaga y decidir retirarla. Los modelos de hojas pueden tener utilidad en otra tarea explícitamente foliar.

El problema peruano mejor respaldado transversalmente es mosca de la fruta, con evidencia concreta de intervención en manzano/durazno y presencia en pera. No encontramos modelo de esos frutos que demuestre detectar infestación interna de forma fiable con cámara exterior. Presencia de hospedero, programa nacional multicultivo y daño atribuible a un cultivo son afirmaciones distintas.

Fuentes de fabricante, escala de programa peruano y límites de integración en [shared-findings.md](shared-findings.md). Ninguna auditoría acredita integración física con Tevel. No se publicaron artefactos ni se alteraron app o simulador.


## Corrección de alcance: sí hay piezas gratuitas para prototipar

La ampliación encontró [FruitNet](https://github.com/OleksandrKlanovets/fruitnet), MIT, pesos H5 reales9.4MB y código para clasificar fruta fresca/podrida, incluida manzana. Autor declara99% en su test; no prueba de campo ni ejecución propia. Sirve como candidato a probar sobre recortes de fruto, combinado con un localizador y el controlador de recogida. No equivale a identificar una plaga concreta ni demostrar eficacia sanitaria en Perú. Ver ampliación de [apple.md](apple.md). La ausencia de una solución completa validada no demuestra inexistencia de modelos reutilizables.
