# Huerto por sectores y robot terrestre

## Cambios

El selector «Robot terrestre / Dron» comparte huerto y permite intercambiar cámara del sensor y seguimiento exterior. El robot terrestre reutiliza el modelo, articulaciones, óptica, chasis y suspensión existentes. Los módulos del dron y sonido se conservaron del trabajo paralelo.

El suelo tiene 70200 triángulos: una cuadrícula gruesa de 2 m y un parche de 12 × 64 m con separación de 25 cm, para representar obstáculos sin refinar todo el campo. Alturas del escenario aproximadamente entre −2.31 y +2.23 m. Sus bordes coinciden con la cuadrícula gruesa; no se superponen superficies físicas. Se añadieron resaltes de 9–12 cm, surcos de 10 cm y una loma localizada. El suelo renderizado y las colisiones de Webots/Rapier consumen la misma topología del contrato.

Los árboles completos se crean al acercarse a sus sectores y sus geometrías se liberan al alejarse, con histéresis de 24/34 m. Las hojas individuales se concentran en 9 m alrededor del vehículo. Un tronco y pocos grupos de follaje por árbol mantienen profundidad a distancia. Los IDs, posiciones, frutos y estados lógicos no se reciclan ni se inventan al cargar sectores.

## Evidencia

- 30 pruebas Python aprobadas: alturas compartidas, plantas apoyadas, borde de parches, área de suelo sin huecos/solapamiento, misma malla entre Python/JavaScript, rechazo de parches inválidos y contratos existentes de vuelo/API.
- Pruebas JavaScript aprobadas de interpolación, normales y cierre de ramas, agrupamiento espacial y cambios de detalle, residencia acotada, dos puntos de vista, descarga y retorno a sectores anteriores.
- [Prueba física terrestre](ground-orchard-physics.json): sin avance sin motor en base plana; 56 m de ida, regreso en reversa, parada por inclinación con fuerza de motor cero y restablecimiento explícito. También pasó una ruta de varios segmentos con origen desplazado y su regreso. Tiempo simulado de ida aproximado 111 s. Se midieron máximos de chasis de 18.48° longitudinal y 12.47° lateral considerando ida y vuelta; algunas ruedas perdieron contacto brevemente. Son resultados de ese escenario, no capacidades máximas de hardware.
- [Comprobación en navegador](ground-browser-smoke.json): mandos de inicio, cambio de velocidad de ida y vuelta, regreso, restablecimiento y propagación normal del evento de clic, además de controles terrestres, cámara frontal y seguimiento, selección terrestre/dron/terrestre, visibilidad del actor y procesamiento real de imágenes en el YOLO11s remoto.
- La revisión en movimiento observó entre 8 y 14 árboles con hojas detalladas y descarga efectiva de un sector. En base, con los radios finales, había 4 sectores residentes y 81 árboles de ramas cercanas/medias, frente a los 1819 árboles leñosos lógicos. El fondo usa 6676 grupos muy ligeros; no se confunde ese fondo con árboles de detalle completo.
- La agrupación del modelo terrestre redujo sus 443 piezas rígidas a 75 lotes conservando articulaciones, suspensión y cámaras. La prueba en navegador dejó de producir errores de geometrías incompatibles.
- Capturas: [sensor del robot](ground-selector-base.png) y [seguimiento exterior](ground-selector-follow.png).

La prueba visual adicional se abrió en un contexto de navegador aislado mientras el otro visor seguía activo. Se observó competencia por GPU y respuestas 429 del único detector con dos visores simultáneos; se cerró ese contexto al terminar. La huella SHA-256 del terreno cargado en el navegador coincidió con la de la prueba física. No se ofrece una tasa fija de fotogramas para esta revisión ni se atribuyen las mediciones anteriores de 60 fps al nuevo recorrido completo.

## Alcance

El terreno es rígido, las ruedas usan rayos y la fricción es estimada. No se validan barro deformable, neumáticos reales, contacto del brazo, cosecha física ni autonomía de campo. El recorrido usa una ruta declarada de un corredor, no navegación general. El consumo terrestre integra una estimación de potencia; no representa una batería comercial calibrada ni implementa recarga terrestre automática.

El brazo permanece plegado durante esta marcha. La secuencia separada de revisión de agarre/corte/depósito sigue disponible en el visor del robot; no se presenta como recolección autónoma dentro del huerto. Las predicciones terrestres no mandan recoger al dron.

El estado físico terrestre se recrea al recargar el visor. La prueba física automatizada se ejecutó en Node/WASM y la visual en Chrome; sus trazas se mantienen separadas. El cambio visual no constituye una evaluación independiente de precisión de detección ni validación de un robot real.

## Actualización: flota y observación pública — 2026-10-18

La sección de alcance anterior corresponde al corredor inicial. Ahora hay navegación por filas para tres terrestres y un dron, cámara de inspección orientable, revisión humana obligatoria, nueva confirmación visual, secuencia cinemática de retirada y carga terrestre. El detalle y los límites actuales están en [VEHICLES.md](../ui/orchard/VEHICLES.md).

- Pasaron 50 pruebas Python de cobertura, autoridad, revisión, flota, entorno, vuelo y API. Pasó la interpolación JavaScript, incluida una cadencia pública de 1 segundo.
- La prueba física de aproximación/regreso volvió a pasar: estacionamiento con 3.4 cm de deriva en 20 segundos y aumento gradual de SOC conectado a estación.
- Se observó en vivo a los tres terrestres completar cinco árboles cada uno en filas contiguas; cada árbol contó con fotogramas de reconocimiento y cámara terrestre. El dron completó 14 árboles, regresó por reserva energética y aterrizó para cargar.
- El detector ejecutó más de 400 inferencias reales durante esa sesión. No se certifica precisión independiente con estas texturas.
- El visitante público ejecutó cero llamadas a inferencia. Los únicos botones visibles fueron selección de vehículo, intercambio de cámara y detalles del modelo. Las órdenes públicas devolvieron 403.
- [Carga pública](public-live-load.json): 36 solicitudes, 12 concurrentes, todas 200; mediana 926 ms, máximo 2028 ms. Esto no prueba una capacidad de audiencia ilimitada.
- El visor público mostró entre 29 y 60 fps según detalle, carga del Mac y sector. Se mantienen algunos tirones al crear vegetación.

No se verificó una retirada completa exitosa con aprobación y visión nuevas en esta sesión. La retirada previamente autorizada conservó el fruto al fallar la confirmación visual. Las pruebas de contrato cubren las transiciones positivas; no sustituyen una demostración física de corte.

El fallo de silencio tras varios minutos se reprodujo con una pose visual retrasada 10.7 s mientras la telemetría más reciente tenía 1.9 s. Se separó esa vigencia, se conservó el bus terrestre aunque el dron esté inactivo y se recuperó un contexto suspendido al volver a la pestaña. Pasaron las tres comprobaciones en navegador: [regresión de audio](public-audio-regression.json). No se ha medido una sesión prolongada posterior a este último ajuste.
