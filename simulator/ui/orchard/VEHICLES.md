# Flota compartida del huerto

La URL pública observa una única sesión: un dron en Webots/ODE y tres terrestres en Rapier a 120 Hz. El selector cambia de cámara; no detiene ni dirige actores. Los visitantes no ejecutan física ni inferencias. El operador privado conserva la revisión de frutos. Las llamadas POST anónimas se rechazan con 403.

`coverage_plan.py` genera filas contiguas a partir de la geometría y configuración. El dron reconoce delante, espera al equipo cuando supera su ventaja permitida y transmite imágenes al detector. Los terrestres avanzan por filas vecinas. Completar un árbol exige imágenes del dron y de su propia cámara, sin consultar la etiqueta de enfermedad del escenario. Mientras una retirada espera aprobación, continúa la inspección. Una aprobación tardía de un árbol ya superado queda pendiente de una futura visita; no se ha implementado todavía un segundo recorrido de recogida.

La retirada exige aprobación humana y dos confirmaciones nuevas del YOLO11s desde el robot asignado. El brazo se articula, sujeta, corta y deposita mediante cinemática idealizada. La falta de confirmación conserva el fruto. Las ruedas se desplazan con fuerzas, dirección, suspensión y frenos; cada terrestre regresa a su estación por batería o recipiente lleno, carga gradualmente y retoma la inspección.

`session.js`, `remote-fleet.js` y `remote-driver.mjs` separan autoridad de observación. `run_live_host.py` mantiene una sesión de Chrome dedicada con GPU. La credencial privada vive exclusivamente en `runtime/operator-token.txt` y el almacenamiento local del host. La concesión de autoridad impide dos hosts activos. Reiniciar el host recrea la física terrestre desde su estación; no restaura un agarre intermedio.

`publish_live.py` abre un túnel temporal de Cloudflare y guarda la URL en `runtime/public-url.txt`. Mac, conexión SSH y laptop deben seguir encendidos. No es alojamiento permanente. El visor usa JSON por sondeo e interpolación adaptada a la cadencia recibida. No se extrapolan poses a través de obstáculos.

Los tres terrestres reutilizan el mismo modelo completo. El detalle simplificado aparece a 24 m, detrás de la niebla. La vegetación se carga por sectores, libera geometría distante y agrupa instancias por celdas para el descarte por cámara. Se mantienen los IDs y estados lógicos de toda la parcela.

El audio espacial sintetiza rodadura, hojas, servos y rotores a partir de movimiento real del simulador. Está habilitado por defecto; el navegador puede exigir una primera interacción. La vigencia del audio usa el paquete más reciente, separada de la pose visual interpolada. El bus compartido no se silencia cuando sólo el dron deja de emitir sonido. Volver a la pestaña o interactuar intenta recuperar un contexto suspendido.

Límites: batería y suelo sin calibración de hardware; ruedas por rayos; mundos físicos terrestres separados con cesión de paso; sin contacto de brazo ni resistencia de corte; mapa geométrico conocido, sin SLAM; texturas derivadas de entrenamiento, sin validación independiente de visión en campo. El flujo simulado no acredita autonomía agrícola real.
