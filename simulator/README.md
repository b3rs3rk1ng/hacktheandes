# Simuladores de cacao

La **chacra con cámara del dron, detección YOLO, batería, regreso y recarga** está documentada en [ORCHARD.md](ORCHARD.md). Visor local: http://127.0.0.1:18437.

## Ensayo de manipulación aérea original

Escena pequeña de Webots R2025a, ejecutada en `laptop` y accesible desde la Mac mediante túneles SSH. Independiente de la aplicación Onda.

El controlador aplica empuje y torque a un cuerpo rígido. Webots integra su movimiento, la gravedad, el transporte del fruto y su caída al recipiente. La posición del objetivo y la masa de la carga son conocidas por el controlador. El agarre utiliza un conector idealizado; el corte libera la unión del tallo. Solo el reinicio restablece posiciones directamente.

No incluye diagnóstico visual de enfermedades, navegación en un cultivo, aerodinámica de hélices, fuerza de corte calibrada, deformación del árbol ni dispersión de esporas. Completar una maniobra aquí no demuestra que un dron real pueda realizarla.

Compatibilidad: el paquete oficial R2025a contiene un error en `Node.addTorque` de Python: llama a `wb_supervisor_node_add_force`. El controlador aplica todos los torques mediante la función C documentada `wb_supervisor_node_add_torque`, sin modificar la instalación del simulador.

`config.json` define la geometría, posiciones, masas y control. `generate_world.py` genera el mundo desde esa configuración. El controlador implementa la secuencia común de aproximar, alinear, sujetar, liberar la unión, transportar y comprobar el depósito.

Servicios remotos: Webots en 18434; controles y telemetría en 127.0.0.1:18435. El navegador carga el visor oficial de Webots R2025a desde Cyberbotics; necesita internet para ese recurso. El servicio de controles no tiene autenticación: mantenerlo en loopback y acceder por SSH.

```sh
python3 generate_world.py
xvfb-run -a ~/.local/opt/onda-webots/webots/webots --batch --mode=realtime --no-rendering --stdout --stderr --port=18434 --stream=w3d worlds/cacao.wbt
python3 serve.py
```

Desde la Mac:

```sh
ssh -N -L 127.0.0.1:18434:127.0.0.1:18434 -L 127.0.0.1:18435:127.0.0.1:18435 laptop
```

Abrir http://127.0.0.1:18435 y pulsar «Iniciar ensayo».

## Verificación realizada

Dos ensayos consecutivos de la misma configuración completaron la secuencia de diez estados y terminaron con el fruto dentro del recipiente, la pinza abierta y la unión del tallo liberada. El segundo ensayo se inició con el botón «Repetir ensayo» desde el estado final del primero. Las telemetrías se conservan en `evidence/trial-01.json` y `evidence/trial-02.json`.

El primer ensayo completó la maniobra en 21.888 segundos de tiempo simulado. Esto no equivale al tiempo de una cosecha real. Solo se verificó este escenario con una mazorca de 0.45 kg y objetivo conocido, sin obstáculos en la trayectoria de aproximación. No se comprobó generalización a otras masas, posiciones ni árboles densos.
