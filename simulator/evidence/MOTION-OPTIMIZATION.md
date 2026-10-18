# Continuidad y rendimiento del visor

## Problema medido

Las poses se aplicaban directamente al recibir cada respuesta HTTP, aunque el navegador dibujase 45–50 fotogramas por segundo. Se observaron intervalos de 233–550 ms entre respuestas y saltos de hasta 0.678 m en un fotograma durante una primera comprobación con interpolación insuficiente. La cámara apuntaba inmediatamente al nuevo objetivo de cada fase. El modo acelerado amplificaba el desplazamiento entre muestras.

[Registro previo a la corrección completa](motion-before-optimization.json). No es un benchmark comparativo controlado de GPU.

## Cambios

- Línea de tiempo reutilizable con posiciones interpoladas y rotaciones por slerp. No extrapola más allá de la física recibida. Un paquete tardío ya no provoca adelantar todo el reloj visual en un fotograma. Los reinicios explícitos, desconexiones largas y paquetes fuera de orden se distinguen del vuelo continuo.
- Cámara con límite de giro de 3 rad/s y seguimiento exterior dependiente del tiempo, con histéresis para reducir cambios de lado innecesarios.
- Los metadatos del JPEG usan el tiempo y la fase de la pose presentada. La geometría para asociar detecciones usa los mismos frutos y cámara que se renderizaron.
- HTTP persistente, TCP_NODELAY y `/api/telemetry` compacto. El visor recibe contadores en lugar de todo el historial de observaciones. `/api/status` conserva el contrato completo para inspección y pruebas. Las peticiones del visor tienen límite de espera.
- Vegetación agrupada espacialmente para descarte por cámara; detalle de hojas concentrado en proximidad; mazorcas lejanas con menos polígonos. La geometría de las mazorcas a distancia de inspección se conserva.
- Mapa de sombras calculado una vez por fotograma y reutilizado en la vista secundaria. Se evita repetir el render completo de FPV cuando ya se capturó para inferencia.

## Verificaciones

Pasaron 10 pruebas de física/control y 9 de API, incluyendo conservación de datos y respuestas sucesivas sobre una misma conexión HTTP. `node test_motion.mjs` comprueba interpolación, tiempo acelerado, paquetes duplicados y tardíos, desconexión, reinicio y el límite de avance tras un retraso. La sintaxis de JavaScript y Python pasó.

La primera versión de interpolación completó una retirada con **inferencia real de YOLO**, depósito y carga: [traza](orchard-motion-harvest-flight.json). La versión final también completó su propia prueba en vivo, documentada a continuación.

La comprobación local posterior reprodujo telemetría Webots guardada, con el detector y el control expresamente desactivados: [registro](motion-optimized-replay.json). En 8 segundos se observaron 450 fotogramas, 11 cambios de pose recibida y 365 cambios de pose presentada; máximo desplazamiento entre fotogramas de 0.167 m durante un vuelo grabado con tiempo acelerado. Se observaron aproximadamente 51–60 fps en el navegador de QA. Las pausas de inspección forman parte del vuelo. Este registro no mide inferencia ni rendimiento del sistema remoto completo; tampoco garantiza continuidad durante una pérdida de conexión.

Reproducción del render, en un servicio independiente que no controla el dron:

```sh
python3 benchmark_motion.py evidence/orchard-harvest-flight.json
# http://127.0.0.1:18438 — etiqueta QA, sin inferencia ni control
```

El render de un escenario grabado no demuestra precisión visual en vuelo real. La conexión se recuperó y la validación final en vivo se completó.


## Validación final en vivo

Con la versión final desplegada, Webots/ODE y el checkpoint YOLO11s real conectados, se registraron **601 fotogramas en 10 segundos**, 40 actualizaciones de posición recibidas y 490 cambios de posición presentada. La muestra incluye inspección y tránsito: unas pausas corresponden al dron detenido. El máximo desplazamiento presentado entre fotogramas fue 0.085 m durante tiempo acelerado; los giros de cámara respetaron 3 rad/s. El visor mostró aproximadamente **60 fps**, sin errores de inferencia ni advertencias o errores de consola en esa comprobación.

[Registro de continuidad en vivo](motion-optimized-live.json), [captura](orchard-optimized-live.png). Son mediciones puntuales de este navegador y esta conexión, no una garantía para cualquier equipo o pérdida de red.

La [prueba completa de retirada de la versión final](orchard-optimized-live-harvest.json) confirmó detección de monilia, agarre, liberación del tallo, transporte, depósito dentro del recipiente, aterrizaje y aumento real de carga. No se proporcionaron candidatos falsos al detector.
