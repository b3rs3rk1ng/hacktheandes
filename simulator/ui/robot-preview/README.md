# Vista previa para aprobación

Abrir **http://127.0.0.1:18440/ui/robot-preview/**. Corre en el navegador del Mac; no requiere SSH, Webots ni el detector.

```sh
python3 -m http.server 18440 --bind 127.0.0.1 --directory simulator
```

Propuesta propia de una base compacta con cuatro ruedas todoterreno de 45 cm de diámetro, brazo de seis ejes, dos cámaras, pinza con corte y recipiente. No representa un producto comercial concreto.

## Dos pruebas

**Terreno difícil** inicia un circuito autónomo de 14 m: surcos de unos 4.5 cm, piedras de 6.5–8 cm, subida y bajada de 8°, sección transversal de 6° y raíz de 4.5 cm. El chasis se mueve por gravedad, fuerzas de tracción, frenado y suspensión de cuatro ruedas por rayos, usando Rapier 0.21.0. No sigue poses de desplazamiento programadas. El render y las colisiones usan exactamente los mismos vértices del suelo. Se muestra velocidad longitudinal, inclinación y contacto/compresión de cada rueda. El brazo permanece plegado durante la marcha.

**Brazo y recolección** conserva la secuencia cinemática de 28 s: desplazarse, aproximar, sujetar, cortar, transportar, soltar, plegar y retroceder. Se puede pausar, recorrer el tiempo, repetir y mover las seis articulaciones. Este modo no simula las fuerzas de agarre o corte ni la estabilidad con el brazo extendido.

Las vistas **Cámara frontal** y **Cámara de pinza** se renderizan desde anclajes reales de la jerarquía del modelo. La frontal está en el chasis; la de precisión va por encima y a un lado de la pinza, apuntando al punto de agarre. Su posición, orientación y campo visual están en `rover-spec.json`. Al seleccionar una cámara queda una vista exterior simultánea; en las vistas exteriores el recuadro muestra la cámara frontal. La cámara refleja la inclinación del chasis y el movimiento del brazo. No se ejecuta YOLO en esta revisión.

«Descargar esta pose» exporta geometría, materiales y jerarquía actuales como GLB estático; no exporta el circuito ni animaciones. [GLB guardado](../robotics/field-rover-review.glb).

## Implementación compartida

- `rover-spec.json`: dimensiones, cámaras, límites de articulaciones, masas aproximadas, suspensión y control de velocidad.
- `field-rover.js`: geometría paramétrica, ruedas, suspensión visible y anclajes de cámaras.
- `rover-dynamics.mjs`: cuerpo rígido, cuatro ruedas, autopiloto rectilíneo, frenado, parada por inclinación y reinicio explícito. No depende de Three.js ni de cultivos concretos.
- `terrain-course.mjs`: configuración declarativa y generación de malla compartida para render y colisiones. `terrain-scene.js` añade materiales y señalización.
- `arm-kinematics.mjs`, `review-motion.mjs`: alcance orientado y secuencia de revisión.

Física a 120 Hz con acumulador e interpolación entre estados; render con `requestAnimationFrame`. Ambas cámaras comparten el mapa de sombras calculado una vez por cuadro. Las piezas rígidas se agrupan por material dentro de cada articulación para reducir llamadas de dibujo; se conservan las articulaciones y la suspensión móviles. Pausar congela la simulación; reiniciar restablece explícitamente la pose.

## Validación y límites

```sh
node simulator/test_rover_review.mjs
node simulator/test_rover_dynamics.mjs
```

La prueba física verifica circuito completo, frenado, plano, ausencia de avance sin motor, otro radio de rueda, parada por inclinación y reinicio. Guarda la traza en [evidence/terrain-physics.json](evidence/terrain-physics.json). Con los parámetros actuales recorrió 14 m en aproximadamente 27.6 s; inclinaciones máximas de chasis de 9.15° longitudinal y 6.08° lateral. Algunas ruedas pierden contacto brevemente sobre irregularidades; esto se conserva en la telemetría. Los 8°/6° describen el circuito ensayado, no una capacidad máxima del robot.

Modelo aproximado de 105.5 kg con masas e inercia calculadas por colisionadores compuestos. Neumáticos por rayos, suelo rígido y fricción estimada: no hay neumático deformable, barro, hundimiento, lluvia, choques de la vegetación, actuadores reales ni calibración contra hardware. El controlador sigue un corredor recto; no es navegación general ni SLAM. La integración al huerto sigue pendiente de aprobación del diseño.

Texturas reutilizadas del proyecto: [créditos](../../assets/CREDITS.md). Three.js conserva la [licencia MIT](../vendor/THREE-LICENSE); Rapier conserva [Apache-2.0](../robotics/physics-vendor/LICENSE) y su [procedencia](../robotics/physics-vendor/README.md).

Revisión visual realizada en Chrome en el Mac: recorrido completo y frenado, vistas frontal y de pinza, modo brazo a los 11 s, cambio de modo, vista del circuito y exportación. El GLB actualizado tiene 2 351 284 bytes, seis nodos de articulación y ambos anclajes ópticos. El contador observado varió con la carga del navegador (aproximadamente 41–60 fps); no se garantiza una tasa fija.
