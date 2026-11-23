# Demo pública actual

URL actual: https://bathroom-head-existed-mile.trycloudflare.com/

Desde el 21 de octubre de 2026, la vista pública usa `simulation.presentation_mode: scripted`, por petición del usuario. Es una coreografía local del navegador con detecciones simuladas; no corresponde a inferencias YOLO, telemetría física ni evidencia de rendimiento del modelo. Cada visitante inicia su propia secuencia al abrir la página.

`scripted-demo.mjs` deriva rutas y objetivos alcanzables de los árboles, mazorcas, vehículos y plan de cobertura de la escena. Emite el contrato de poses existente, con interpolación y manipulación del brazo. Los tiempos son configurables: vuelo limitado a 1 m/s, previsualización de 1,4 s por objetivo y recogida de 6 s. Los traslados duran según longitud de ruta, con frenado suave; los terrestres no superan 0,85 m/s. El dron inspecciona todas las mazorcas de cada árbol antes de avanzar, muestra el contador por árbol y emite una orden animada al terrestre correspondiente. El terrestre permanece esperando hasta terminar esa inspección; los desplazamientos siguen las rutas comprobadas. La planificación posterior corre en un worker del navegador. La vista móvil conserva selector, cambio de cámara y una etiqueta discreta de demo.

El servicio HTTP y el túnel público siguen activos. Se detuvieron Webots y `cacao-live-host`; el servidor no carga YOLO en este modo y los lanzadores omiten la física y el render de servidor. El navegador sigue usando WebGL para dibujar la escena 3D. Para volver al modo físico hay que cambiar `presentation_mode` a `physical`, reiniciar el servidor y reactivar física y host. No se eliminaron modelos, evidencia ni estados físicos anteriores.

Validación: cuatro pruebas de coreografía/visibilidad/rutas con escenas trasladadas y giradas, uno y tres vehículos durante 300 s simulados cada una, incluyendo límites de ciclo y primer timestamp; 16 contratos HTTP/Python; revisión de la demo pública en escritorio y a 342 px. Se observaron 49–56 fps en la revisión de escritorio; no es una garantía para todos los móviles. La coreografía planifica la separación frente a cápsulas conservadoras de troncos/ramas, envolventes aproximadas de follaje y el terreno; no integra fuerzas de colisión, hojas finas, diagnóstico ni resultados de campo. La validación final de 1200 s cubrió las 178 mazorcas de los 18 árboles del recorrido configurado, todas con vista libre; velocidad máxima 1 m/s y distancia mínima entre centros dron/robot de 1,408 m. El recorrido de demo es limitado por configuración, no abarca los 1190 árboles de cacao de la escena. El escaneo requiere visibilidad geométrica de la mazorca desde la cámara; no se muestra a través de la madera.

## Salida tras la recogida

La coreografía terrestre ahora se divide en giro en espacio libre, recorrido, alineación en la posición de espera, aproximación, recogida y marcha atrás al mismo punto libre. La espera siguiente mantiene esa posición. El ángulo de las ruedas se integra desde el desplazamiento y giro reales de la pose, incluyendo el signo de la marcha atrás; no avanza con el reloj durante una espera. La cámara conserva el mismo anclaje durante toda la secuencia de demo.

Ocho pruebas JavaScript verifican continuidad, recogida/salida y ruedas detenidas en espera para distintas orientaciones. La reproducción generada durante 1200 s verificó espera estable y retirada para los tres robots. Es una coreografía con comprobaciones geométricas, no una prueba física de control de ruedas.

## Separación entre terrestres

La demo usa `traffic-coordinator.mjs`, un contrato común de trayectorias futuras y radios de ocupación. Comprueba el barrido continuo entre muestras, con anticipación de 3 s y margen de 0,12 m. El adaptador deriva la ocupación del chasis, ruedas y alcance horizontal del brazo. Un vehículo que cede congela su progreso, pose, brazo y ruedas, muestra «Cediendo el paso» y reanuda cuando existe separación. Las reservas conservan la prioridad durante el cruce. Si ninguno puede pasar con el otro detenido, ambos frenan; este control no crea un desvío lateral en un paso sin espacio.

Los terrestres parten de sus estaciones y vuelven a ellas al terminar para no aparcar en una ruta compartida. La asignación de recogida elige una mazorca alcanzable entre las realmente inspeccionadas por la secuencia; una primera candidata sin vista no bloquea la cola si existe otra compatible.

Validación: 15 pruebas JavaScript cubren cruces de dos y tres actores, distinto orden de entrada, seguimiento de uno lento, encuentro frontal, intercambio entre muestras, extensión del brazo, maniobras y regreso a estación. Una reproducción generada de 1800 s sobre la escena verificó ausencia de solapamiento de las envolventes en todos los barridos y finalización de los tres terrestres, incluyendo esperas y reanudación. Es coordinación geométrica para la animación; no sustituye sensores ni control de seguridad de robots reales.

# Historial del despliegue físico (anterior)


URL temporal actual: https://reads-puzzle-song-assets.trycloudflare.com/

Todo el backend está en `/home/f3mt0/hacktheandes-orchard`. La Mac sólo es un cliente de visualización; sus procesos de autoridad, túnel y reenvío se cerraron antes de comprobar la nueva URL. El navegador de cada visitante dibuja la escena y sintetiza audio; no crea misiones ni ejecuta YOLO.

Servicios de usuario: `systemctl --user status cacao-live-host cacao-public-tunnel`. El host usa Chrome/ANGLE/Vulkan sobre RTX 4060. `loginctl show-user "$USER" -p Linger` debe indicar `yes`. El servidor y Webots mantienen sus procesos aislados iniciados por `launch_orchard.py`. La laptop debe permanecer encendida y sin suspensión; la sesión SSH no es necesaria. No se pudo adquirir el inhibidor de suspensión desde la cuenta remota: el sistema devolvió acceso denegado.

El túnel tiene configuración propia en `runtime/public-tunnel.yml` para evitar heredar rutas de otros proyectos. `runtime/public-url.txt` contiene la URL vigente; reiniciar el túnel puede cambiarla. `runtime/operator-token.txt` es privado; no se sirve como recurso web. La observación pública no permite emitir órdenes. La política actual de retirada virtual es automática y ya no pide aprobación humana.

## Verificación

- 98 contratos Python aprobados; pruebas JavaScript de seguimiento físico, manipulación, extremos de navegación, ayuda entre filas, coordinación durante carga y cámara secundaria.
- La prueba física de aproximación, restauración de pose, estacionamiento, regreso y carga pasó. Deriva estacionada en 20 s: 0 m en el escenario probado.
- La recuperación de navegación pasó para los tres estados capturados junto a troncos: se abre espacio hacia delante o atrás según orientación real, sin desplazamiento lateral ficticio. El tercer caso superó transitoriamente el límite de inclinación; se detuvo y recuperó al quedar estable, una vez. No es evidencia de seguridad para hardware.
- Se observó a los tres terrestres avanzar más allá de los cinco árboles iniciales, analizar imágenes nuevas y coordinar su distancia mientras el dron cargaba. Ver `laptop-live-coordination.json` y `navigation-recovery.json`.
- Audio con contexto ejecutándose y señal medida durante marcha real: `laptop-audio-signal.json`. Se añadió recuperación de contexto y aviso de gesto inicial. La rodadura desaparece en reposo y el brazo suena al moverse; no se rellena con audio ficticio durante la espera.

Se observaron dos retiradas automáticas completas originadas en detecciones reales del dron, ambas depositadas por Terrestre 3. La prueba continua de vuelo completó 1800,31 segundos de reloj real, sin aterrizar, cargar ni acelerar el simulador; quedó 49,26% de batería. Ver `drone-wall-clock-endurance.json`. El paquete virtual usa 6S / 16 Ah; la masa y la energía siguen siendo aproximaciones de simulación, sin calibración para un dron comercial. El progreso de inspección no implica que todas las mazorcas visibles hayan sido reconocidas, ni acredita precisión independiente o transferencia a hardware. Siguen los límites del terreno rígido, mapa conocido y manipulación cinemática.

## Perfil dinámico de la demo

El dron realiza pasadas de inspección sin esperar al frente terrestre. Los tres terrestres usan el mismo modelo detallado, batería virtual de 2048 Wh, crucero de 0,9 m/s y manipulación a 2,2 veces la cadencia anterior; el reloj físico permanece en tiempo real. La escena declara un brote simulado mediante mayor proporción de texturas afectadas. Las tareas siguen exigiendo detecciones de YOLO sobre los píxeles de cámara; la etiqueta del fruto no decide la retirada.

Un robot libre puede ayudar en una fila vecina dentro del radio configurado, después de inspeccionar su árbol y con reconocimiento del dron. El servidor mantiene exclusión por árbol y por robot. La ventana secundaria del visor sigue las recogidas reales y permite ampliarlas sin cambiar automáticamente la cámara principal.

Se corrigió el agotamiento de descriptores del navegador: el lienzo de lectura usa almacenamiento CPU, los JPEG se envían como bytes y se consume la respuesta de observación. Antes se detuvo con 1024 descriptores; después se observaron 83–84 descriptores en el renderer tras más de 1400 imágenes de una misma sesión. La evaluación física de marcha y de todas las etapas de agarre, corte, transporte y depósito volvió a pasar. `dynamic-live-audit.json` registra casi cinco minutos, con un reinicio administrativo del host durante el intervalo; `dynamic-demo-verification.json` registra el estado final y una retirada completada en una fila vecina. La prueba de 30 minutos corresponde al perfil anterior; este perfil más rápido conserva la prueba energética, pero no se repitió otra observación completa de media hora.

Los cambios se transfirieron directamente a la laptop. No se crearon commits ni se hicieron pushes.

Se detectó también que una pose físicamente válida podía redondearse a una celda de navegación bloqueada y perder la ruta de regreso. Ahora ambos extremos exactos conectan con celdas cercanas libres. Pasaron cuatro casos de extremos ajustados, los tres recorridos físicos capturados y el regreso del carrito bloqueado: llegó a cargar en 74,89 s simulados, desviación máxima de 0,143 m (`captured-home-route.json`). Un fallo de ruta de regreso conserva la intención y se reintenta con espera; una sesión restaurada con recipiente lleno vuelve a su estación.

Los viajes de regreso/carga no frenan el frente de los robots que siguen en campo. Al volver un robot al cultivo, se restaura su coordinación por filas. La ventana secundaria también sigue los regresos cuando no hay una recogida activa.
