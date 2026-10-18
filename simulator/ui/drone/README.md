# Dron: apariencia, aire y sonido

Modelo procedural de un multirrotor de inspección, sin marca comercial. El tamaño de las hélices, número de motores y disposición se derivan de la configuración de vuelo. La variante actual usa una jaula geodésica de 0.57m de diámetro con cuatro rotores de 0.105m de radio. La cámara está anclada en ENU [.235,0,-.04], con soporte de giro limitado. Es una propuesta inspirada en drones industriales protegidos, no una réplica calibrada del Elios 3. No incorpora pinza ni pulverizador; inspección aérea y retirada terrestre tienen diseños distintos.

La pose proviene exclusivamente de Webots. FlightDynamics limita el jerk vectorial a 8 m/s³ en la configuración actual, velocidad de guiñada a .7 rad/s, aceleración angular a 1.5 rad/s², torque y respuesta de motor (.06 s). Los valores son configurables por aeronave. Las ráfagas suaves actúan como arrastre real en el cuerpo; no se añade un bamboleo artificial al render.

RotorState estima RPM con T=Ct·rho·n²·D⁴ (Ct=.10 provisional) y velocidad inducida vi=sqrt(T/(2 rho A)). RotorState, audio, polvo y hojas comparten el mismo estado. El difuminado de hélices aproxima la exposición de cámara, evitando barras que giran a velocidad de fotogramas. No hay telemetría de ESC individuales en el backend actual; diferencias entre motores son visuales, derivadas y acotadas.

El aire es una estela reducida: chorro descendente que se ensancha y pierde intensidad, más flujo radial al llegar al suelo. El follaje cercano se dobla y vibra en su orientación real. Partículas limitadas reutilizan buffers: 640 motas de polvo y 72 hojas secas; la emisión decae con altura y empuje. El pad de hormigón no origina polvo. La intensidad por defecto es baja, apropiada para suelo con hojarasca; `flight.visual_dustiness` la configura. Este efecto no equivale a CFD, suelo deformable ni mecánica de cada hoja.

El sonido usa síntesis Web Audio: cuatro motores con armónicos de paso de pala, fluctuación y ruido de aire. Altura tonal y carga siguen RPM; distancia, dirección y movimiento del oyente siguen la cámara activa. Incluye atenuación, filtrado y Doppler acotado. Se activa al pulsar Iniciar o el botón Sonido; se puede silenciar. Al cambiar de vehículo o perder telemetría, se silencia. No es una grabación ni una medición de nivel acústico de un fabricante.

## Integración

Importar `createDroneExperience` desde `/ui/drone/experience.js`. El servidor expone `/ui/` con las mismas comprobaciones de rutas que los recursos existentes.

- Crear con `{scene,cfg,heightAt:(x,z)=>altura,home:Vector3}`.
- Usar `.drone` y `.fingers` en el flujo existente. Posición/orientación pertenecen al consumidor físico.
- Ejecutar `.bindVegetation(scene)` tras generar materiales. Envuelve los callbacks actuales sin modificar el generador del entorno. Admite hojas instanciadas y escalas/orientaciones distintas.
- `.update(dt,stateInterpolado,cameraActiva)` cada fotograma. Estado incluye posición ENU, orientación, velocity, thrust_n, wind_mps y updated_at.
- Selector: `.setActive(tipo==='drone')`. Al desactivar oculta modelo, anula aire y silencia audio; al volver conserva la elección del usuario.
- Para materiales de follaje creados después, repetir bindVegetation (idempotente).

El árbol no se desplaza físicamente ni tiene colisiones de follaje. El detector sí recibe los píxeles con movimiento de hojas y polvo. Las nuevas condiciones visuales pueden modificar sus aciertos: esto no demuestra precisión de diagnóstico en imágenes reales.

Fuentes: [NASA: Propeller thrust](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/propeller-thrust/), [MDN: Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API), [MDN: PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createPanner).

## Cámara y colisiones

La cámara a bordo conserva siempre la transformación de montaje del chasis. El soporte gira hasta ±.65rad lateral, entre -1.05 y .45rad vertical, con velocidad máxima1.5rad/s. Hereda los movimientos del chasis: no es una cámara libre que sigue un objetivo por el mundo. La vista externa se identifica por separado.

La jaula se representa físicamente mediante una esfera conservadora del mismo radio exterior. Troncos y ramas principales comparten cápsulas entre colisión y frenado por proximidad. Antes de ascender, el planificador busca una columna libre y comprueba segmentos completos; si no encuentra, mantiene posición. Usa geometría conocida, no SLAM. Las ramillas finas, telarañas, enredaderas y huecos de la jaula no se simulan. No demuestra inmunidad a enganches ni recuperación propietaria de impactos.

El aterrizaje dirige hacia el contacto y exige contacto físico y baja velocidad antes de apagar motores y entrar en carga.
