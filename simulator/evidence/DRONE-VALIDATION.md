# Dron protegido: validación virtual, 18 octubre 2026

Entrega en el visor existente: http://127.0.0.1:18437. El selector conserva el robot terrestre del otro chat. El dron es de **inspección**, sin pinza saliente ni pulverizador. Modelo procedural inspirado en drones industriales con jaula; no es una réplica calibrada de Elios 3.

## Geometría y cámara

Jaula geodésica de114 aristas, diámetro exterior0.57m. Cuatro rotores de radio0.105m y centros a0.16m del eje central: los discos y las protecciones quedan dentro de la jaula. La esfera de colisión representa de forma conservadora el volumen exterior completo; no reproduce huecos, flexión ni rotura de barras.

Cámara ENU [.235,0,-.04] fijada al chasis. El soporte tiene giro lateral limitado±.65rad y vertical[-1.05,.45]rad, con velocidad1.5rad/s. La orientación del chasis llega a la imagen. Vista externa y cámara a bordo están rotuladas por separado y se intercambian con Ampliar.

Comprobación en navegador durante vuelo: error entre centro óptico y transformación de montaje **0m**; cero programas de shader fallidos. Se verificó el campo de visión libre del antiguo tren/gripper del dron, el modelo exterior y el cambio entre vehículos.

## Movimiento y colisiones

Webots/ODE integra empuje y torque; el render interpola sus poses, no inventa trayectorias. Control con jerk acotado, respuesta de motor, guiñada limitada y viento con ráfagas suaves. Cápsulas compartidas para troncos y ramas principales alimentan colisiones y frenado por proximidad. La salida vertical busca primero una columna libre; si no encuentra camino, se mantiene en posición.

La primera prueba quedó bloqueada bajo una rama al ascender. Se conserva en `drone-guarded-ascent-before.json`; llevó a añadir la búsqueda de ascenso libre. Otra prueba reveló el apagado temprano al aterrizar (`drone-guarded-before-touchdown.json`); el controlador ahora exige contacto físico y baja velocidad antes de cargar.

Prueba final `drone-guarded-flight.json`: Webots aislado con la misma geometría/control, sin depender de inferencias para ordenar el regreso. Completó takeoff→transit→inspect→return_climb→return_transit→landing→charging en51.72s de pared, con reloj físico acelerado.104 muestras. Velocidad máxima medida1.108m/s; guiñada máxima0.703rad/s. Final con1 contacto y velocidad0.000120m/s. No hubo errores HTTP. Esa duración no equivale a tiempo de vuelo real ni de misión en tiempo normal.

Además se observó el visor18437 en tiempo real: llegada al primer árbol, RGB procesado por YOLO, avance por cuatro árboles y cinco frutos con alerta del modelo. Estado real conservado en `drone-inspection-live-status.json`. No es un nuevo benchmark independiente del detector.

## Aire, polvo y audio

RPM estimadas por empuje y área del rotor; mismas RPM para giro visual, difuminado de hélices y audio. El aire descendente/flujo radial afecta materiales de hojas en coordenadas del mundo, incluidas nuevas celdas cargadas. Partículas reutilizables limitadas a640 motas y72 hojas. Emisión disminuye con altura; la plataforma no origina polvo. La intensidad por defecto es moderada.

Durante vuelo se observaron51 motas y16 hojas activas en una muestra, cuatro materiales de vegetación enlazados. Son efectos visuales de estela reducida: no CFD ni colisiones físicas del follaje. El audio Web Audio se verificó con contexto running y reproducción indicada por Chrome; tono y aire siguen carga, posición y cámara. Es sonido sintetizado, no grabación o nivel acústico calibrado de un fabricante. El selector terrestre silencia el dron.

## Rendimiento y comprobaciones

Agrupación de58 piezas rígidas en14 grupos de dibujo, conservando hélices y cámara articuladas. La utilidad común ahora admite mezclas de geometría indexada y no indexada. Se evita releer layout del recuadro en cada fotograma. Durante inspección se observaron53–58 llamadas en la segunda pasada y alrededor de60fps en varias muestras; hubo bajadas transitorias previas al cargar vegetación/cambiar de vehículo. La muestra de300 intervalos rAF dio mediana16.7ms, p9516.9ms y máximo17.7ms. Fuera de esa ventana se observó una caída a32fps al cargar otro sector; no se garantiza60fps en todos los equipos o sectores. Datos en `drone-render-check.json`.

Pasaron37 pruebas Python (control, geometría, energía, servidor y entorno), pruebas de interpolación y rotores, y la regresión del brazo terrestre. `test_drone_scene.mjs` verifica anclaje de cámara, límites, alineación óptica del soporte, geometría finita, agrupación y ciclo de rotores. Reproducción: `node --experimental-loader ./test_three_loader.mjs test_drone_scene.mjs` desde simulator.

## Límites pendientes

El mapa de la chacra está precargado; no se ha implementado SLAM ni reconstrucción aérea del terreno. La localización de frutos usa geometría conocida del simulador. La asignación automática de alertas al terrestre, su ruta a cada objetivo y la retirada física completa siguen pendientes de integración. No hay pulverizador. No se modelan telarañas, enredaderas finas, deformación de plantas ni todos los huecos de la jaula. No se ha demostrado navegación entre cualquier vegetación densa ni funcionamiento en hardware real.

Último ajuste del visor: cada fuente de cámara puede declarar `visionEnabled`; el dron deja de solicitar inferencias innecesarias durante reposo/carga/fallo. El render y la cámara siguen activos. Al estacionar, el soporte mira al frente del chasis; durante inspección se orienta hacia el objetivo dentro de sus límites. La fuente terrestre conserva su comportamiento.
