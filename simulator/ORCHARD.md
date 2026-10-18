# Chacra y misión de inspección

Abrir **http://127.0.0.1:18437** con el túnel SSH activo. El selector superior permite elegir **Robot terrestre** o **Dron**. Cada modo tiene cámara de sensor y seguimiento exterior, intercambiables con «Ampliar». «Iniciar recorrido» despega desde la base. «Ampliar» intercambia la cámara del dron y la vista de seguimiento. El mapa muestra parcelas y la posición física del vehículo.

La distribución tiene **7.80 ha**, 1190 árboles de cacao, 200 plantas de plátano, 429 de café y 2176 de maíz. Cada cacao tiene entre 7 y 14 mazorcas: 12484 con la semilla actual. Son cantidades del escenario, sin estimación agronómica de rendimiento. El planificador recorre el cacao configurado; la inspección toma cuatro ángulos a dos alturas por árbol. La autonomía limita cada salida: el vehículo vuelve, aterriza, carga y puede retomar el recorrido cuando alcanza la carga configurada. «Regresar a la base» solicita detener la salida actual y permanecer en la base.

En «Preparar un vuelo» se puede desactivar la retirada para recorrer y observar varios árboles, o elegir una carga inicial y restablecer explícitamente el escenario. Elegir una carga inicial no representa una recarga realizada por el dron.

El modo terrestre usa la ruta de terreno difícil de 56 m y permite regresar en reversa. El brazo viaja plegado. [Integración de vehículos](ui/orchard/VEHICLES.md) y [validación terrestre y de sectores](evidence/FIELD-ROBOT-VALIDATION.md).

## Qué corre realmente

- **Webots R2025a / ODE en laptop:** integra un cuerpo rígido con masa, inercia, empuje, torque, gravedad, arrastre, viento constante y colisiones con suelo/troncos. Durante el vuelo no se escriben posiciones del vehículo; sólo el restablecimiento explícito cambia su pose directamente.
- **Render en el navegador:** Three.js dibuja árboles procedurales, materiales y cámaras usando las poses y la distribución del mundo físico. El navegador usa la GPU del equipo que abre el visor. La cámara principal está estabilizada hacia el punto de inspección.
- **Continuidad visual:** una línea de tiempo interpola posiciones, orientaciones y frutos transportados entre muestras de física. Conserva un pequeño retraso de presentación y no adelanta de golpe el reloj cuando llega un paquete tardío. La cámara limita su velocidad de giro. El JPEG y sus metadatos corresponden a esa misma pose presentada; la batería y el control continúan en el reloj físico.
- **YOLO11s en la RTX 4060 de laptop:** recibe el JPEG de la cámara 3D. El render se copia antes de dibujar la vista secundaria o la interfaz. No recibe etiquetas de salud, colores de anotación, IDs de fruto ni posiciones.
- **Asociación geométrica:** las cajas devueltas por el modelo se asocian a frutos mediante un rayo y geometría conocida. Esta parte utiliza información del simulador; no es SLAM ni profundidad monocular aprendida. El servidor acepta únicamente índices de predicciones de un fotograma que efectivamente infirió: el cliente no puede sustituir sus clases o puntuaciones.
- **Retirada virtual:** una alerta suficiente puede activar la pinza. Webots comprueba un conector compatible; sólo tras confirmar el agarre se libera la unión del tallo. El fruto tiene masa y cae por gravedad al soltarlo. El panel de evaluación registra si cayó dentro del recipiente y conserva su etiqueta real, incluso cuando el modelo se equivocó.

El checkpoint es exactamente el seleccionado en la segunda ronda, SHA256 `4a72c36e6aed0db8c5f39b637a918da28e4386644ceb52c7b9d8446efb9a9d33`. Umbral de alerta 0.74, propuestas desde 0.05, NMS independiente de clase con IoU 0.7, entrada 640 y FP32. Las clases objetivo se declaran en configuración; el motor no decide acciones a partir de las etiquetas del escenario.

## Batería y regreso

El estado de carga integra corriente según potencia y **tiempo simulado**, incluyendo caída de tensión por resistencia interna. La potencia usa empuje, área de discos de rotor, densidad del aire, eficiencia de motor, pérdidas de perfil y electrónica. Transportar una mazorca aumenta masa, consumo e inercia.

El regreso estima ascenso por encima de las copas, trayecto con margen, descenso, aterrizaje y una reserva energética. Al agotarse ese margen se inicia el regreso sin intervención del visor. La recarga aproxima corriente constante y reducción de corriente al acercarse al lleno. No pasa artificialmente de vacío a lleno en unos segundos.

«Tiempo acelerado» cambia el modo de ejecución de Webots: avanza el reloj físico más deprisa que el reloj de pared cuando el equipo puede hacerlo. No modifica capacidad de batería, consumo ni duración física de la recarga. El visor permanece fluido con las últimas poses recibidas. El modo exacto de velocidad depende de CPU y carga del equipo; no promete un multiplicador fijo.

Mantener el visor abierto y activo para producir imágenes. Sin imágenes nuevas, el dron espera durante la inspección, sigue consumiendo energía y conserva el regreso por reserva.

## Árboles y terreno

`vegetation.py` genera una estructura reproducible por semilla: tronco inclinado, altura de bifurcación, tres a cinco ramas principales, ramillas y brotes desiguales. Las mazorcas se sujetan al tronco y las ramas principales, con tamaños y colores variables. La estructura se escribe una sola vez en el contrato del mundo y el render la consume. El número de frutos, alturas, densidad de hojas y distancias de detalle se declaran en configuración.

`terrain.py` produce una superficie ondulada de unos 4.5 metros de desnivel total con la configuración actual, preservando una zona plana alrededor de la base. El navegador y Webots usan los mismos 70200 triángulos, incluidos parches locales más finos para surcos y resaltes; ambos interpolan sobre la misma diagonal de cada celda. Las raíces, alturas de inspección y margen de regreso incorporan esa elevación.

El detalle de árboles se crea por sectores al acercarse y se libera al alejarse. El fondo usa una representación muy ligera de las copas y los troncos; el mapa y el estado de cada árbol permanecen. El suelo usa color y normales fotográficos de hojarasca. Cerca de la cámara se añaden hojas caídas curvadas, orientadas según la pendiente; a distancia queda la textura. La geometría de ramas se agrupa por celdas, las hojas y mazorcas se instancian y el follaje distante usa un atlas de brotes horneado al iniciar. Se limita el detalle cercano y el presupuesto de píxeles del render; la entrada del detector conserva su tamaño configurado. No se simula física individual para cada hoja.

La [validación del entorno](evidence/ENVIRONMENT-VALIDATION.md) conserva mediciones, pruebas y límites. La geometría aproxima un cacao podado; todavía no es un escaneo ni una reproducción fotográfica de un cacaotal real.

## Ejecución y reproducción

Los servicios están aislados en `/home/f3mt0/hacktheandes-orchard`, con física en 18436 y HTTP en 18437. El laboratorio original de una mazorca en 18434/18435 se conserva.

```sh
# En laptop, con el entorno que contiene Torch, OpenCV y Ultralytics:
cd /home/f3mt0/hacktheandes-orchard
/home/f3mt0/hacktheandes-cacao-improvement/.venv/bin/python launch_orchard.py

# En Mac:
ssh -N -L 127.0.0.1:18437:127.0.0.1:18437 laptop
```

`orchard_config.json` declara parcelas, cámara, física, batería, umbrales, pesos y puertos. `generate_orchard.py` escribe un único contrato `runtime/orchard.json` y el mundo físico. `flight_core.py` comparte control, energía y planificación A* alrededor de obstáculos circulares; las trayectorias mantienen el margen declarado alrededor de los troncos. Las órdenes se encolan y reconocen por ID, evitando perder órdenes consecutivas.

```sh
python3 test_flight_core.py -v
python3 test_orchard_server.py -v
python3 test_environment.py -v
node test_motion.mjs
node test_tree_geometry.mjs
node test_instanced_cells.mjs
node test_sector_stream.mjs
node test_ground_orchard.mjs

# Con el visor activo: prueba autónoma de reserva y carga.
python3 validate_orchard.py --initial-soc .16 --accelerated \
  --output evidence/orchard-reserve-flight.json

# Repetición con retirada activada; requiere depósito y carga reales del simulador.
python3 validate_orchard.py --initial-soc .6 --harvest --accelerated \
  --output evidence/orchard-harvest-flight.json
```

## Límites y materiales

La [optimización del visor](evidence/MOTION-OPTIMIZATION.md) documenta el transporte compacto, la interpolación y los cambios gráficos. Su prueba local con telemetría grabada está separada de las pruebas del detector conectado.

La [validación de entrega](evidence/ORCHARD-VALIDATION.md) resume las pruebas ejecutadas y enlaza sus trazas y capturas. No se ha ejecutado una vuelta completa por los 1190 árboles ni un ciclo completo de recarga hasta el 95% seguido de reanudación; la cobertura de entrega es representativa de las fases principales.

El modelo de energía todavía no está calibrado para un dron comercial. El control usa la pose conocida del Supervisor, sin ruido ni estimación de GPS/IMU. Aplica empuje y torque agregados: no simula la aerodinámica detallada de cada hélice. Las hojas son visuales y no tienen colisiones; los troncos tienen geometría de colisión simplificada. El agarre y el corte son idealizados, sin resistencia de corte ni deformación. La asignación espacial de enfermedades es sintética; no modela epidemiología ni propagación.

Los cultivos secundarios son representaciones visuales y el detector actual está entrenado para cacao. Las texturas de mazorca proceden de fotos de **entrenamiento**: este escenario no constituye un nuevo benchmark independiente. No se atribuyen sus cifras a vuelo real ni se demuestra ahorro económico. La apariencia es una escena 3D optimizada, sin equivalencia garantizada a una cámara física o fotorealismo de referencia.

[Materiales y licencias](assets/CREDITS.md). La [hoja con transparencia](assets/cacao-leaf.png) se creó con la herramienta integrada de generación de imágenes; [prompt y procedencia](assets/leaf-generation.md). Corteza y suelo usan materiales fotográficos CC0. Las mazorcas conservan su [procedencia por recorte](assets/pods/provenance.json). Los hallazgos del detector, las comprobaciones de depósito y las trazas de prueba se conservan como evidencia, incluyendo fallos y falsas alertas.

## Dron protegido de inspección

El dron actual usa jaula, cámara anclada al chasis con soporte limitado, hélices y sonido vinculados al empuje y efectos locales de aire sobre polvo/hojas. Conserva el visor y selector de vehículo. La variante actual es de inspección y no lleva pulverizador ni pinza saliente. La [validación del dron](evidence/DRONE-VALIDATION.md) detalla geometría física, navegación, pruebas, rendimiento y límites. El mapa está precargado; el reparto automático de alertas al terrestre todavía no está integrado.


### Revisión del agricultor (18 de octubre)

El botón Buzón de sospechas y la página /review comparten review-inbox.js: foto del fotograma inferido, recorte, posición ENU, filtros por estado/sectores de 20m y nota. Los sectores son celdas de presentación, no una división agronómica medida. No se agregan sospechas ficticias para completar una cantidad de demo.

Cada fruto genera una tarea por escenario. Su foto queda guardada antes de solicitar una decisión; cuadros nuevos no sobrescriben la evidencia original. La revisión persistente exige versión y época del escenario, rechaza decisiones contradictorias y tolera el reintento de la misma petición. Las tareas antiguas sin foto esperan nueva evidencia. Sólo aprobar habilita claim; además se conservan las dos observaciones de cámara terrestre antes del agarre. Rechazar conserva el fruto. La aprobación humana no demuestra enfermedad ni corrige las métricas del detector.

Pasaron 26 pruebas de revisión, evidencias JPEG, API, asignación, transiciones y contratos del servidor en Mac y laptop (el último ajuste de estados se volvió a comprobar en Mac). La prueba visual aprobó cacao-2-19-pod-5 con una nota explícita de prueba: Terrestre 2 salió desde su estación; la navegación reportó ruta bloqueada y volvió sin retirar el fruto. Evidencia en review-live-approved.json y review-live-outcome.json. No se declara una retirada completa aprobada como verificada en esta prueba.

Kevin eligió primero el buzón de la demo: no se conectó ni simuló un envío de WhatsApp. El servidor permanece local y sin autenticación de agricultores; no está preparado para publicar decisiones a internet. El movimiento terrestre actual requiere el visor de simulación activo.


### Corrección de asociaciones a través del tronco

La foto reportada de cacao-4-18 correspondía a una caja YOLO [246,0,369,323] sobre el tronco. El visor anterior lanzaba un rayo contra esferas de frutos sin comprobar obstáculos, por lo que podía asignar un fruto oculto. Se conserva visibility-before-frame.jpg; no se corrigió el modelo ni se cambió esa imagen.

vision_geometry.py ahora recibe la pose óptica exacta del fotograma e intrínsecos desde X-Camera-Pose. La asociación vive en el servidor y exige IoU >=0.25 con la proyección de la geometría del fruto, además de 3/5 rayos interiores que lleguen a su superficie antes de cápsulas de madera, terreno u otros frutos. Usa dimensiones y giro del objeto, no etiquetas de enfermedad. Parámetros configurables en inspection.association; geometría local cacheada según ruta/mtime del mundo. La inferencia sigue recibiendo sólo RGB. Es una localización con geometría conocida del simulador, no segmentación visual ni profundidad aprendida. No cubre hojas alfa, deformaciones ni enredaderas finas.

Las asociaciones indicadas por el navegador ya no pueden crear tareas: /api/observe usa las asociaciones del servidor para ese frame. Las evidencias sin comprobación versionada se archivan y requieren recaptura; las aprobaciones antiguas sobre esas fotos se invalidan con cambio de revisión. No se borran los JPEG anteriores.

39 pruebas pasaron en la laptop: objeto visible, tronco delante/detrás, caja grande sobre objeto pequeño, objeto ocultando otro, pose incorrecta, giro/aspecto inválido, nombres/clases/traslación distintos, deduplicación, rechazo de IDs propuestos por el cliente, migración de aprobación sin visibilidad y flujos de revisión existentes.

En el visor real se obtuvo una nueva captura de cacao-4-18-pod-6: IoU 0.6833, 5/5 rayos libres y distancia 0.858m. Se revisaron visualmente el frame y el recorte; ambos muestran la mazorca y la ficha permanece sin aprobar. Evidencia: visibility-corrected-task.json, visibility-corrected-frame.jpg y visibility-corrected-crop.jpg. No es una nueva medición de precisión de YOLO ni una confirmación fitopatológica. Una muestra de telemetría reportó localización en ~3ms; no se ofrece como benchmark de latencia sostenida.
