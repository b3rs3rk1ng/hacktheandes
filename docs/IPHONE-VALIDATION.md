# Verificación en iPhone — 17 de octubre de 2026

Dispositivo: iPhone 13 con iOS 27.0.1. Instalación de desarrollo firmada con Xcode y autorizada por el usuario. Emisor: Chrome en la laptop, altavoz; receptor: app Onda instalada, micrófono. El usuario indicó estar en una sala con gente conversando. No se midieron distancia, potencia, SNR ni tasa de pérdidas.

## Recepción física

Se leyeron los datos de `onda:fields-v1` del contenedor de la propia app por USB, sin abrir Duplicación del iPhone ni interrumpir el micrófono. Los valores coinciden exactamente con las observaciones históricas transmitidas.

| Campo | Observaciones verificadas, hora Lima | Cambio de valores |
| --- | --- | --- |
| 26 × 38 | 16:10 y 16:50 | 22 de 988 celdas |
| 9 × 9 | 16:10 y 16:40 | 8 de 81 celdas |

El primer campo quedó registrado a las 18:45:45 y el segundo a las 18:46:17. Los registros posteriores indican recepción a las 18:50:14 y 18:49:53, respectivamente. Todos mantienen `context: replay`; son históricos reales, no observaciones actuales.

Las lecturas del SQLite/WAL de WebKit durante ejecución no reflejaron inmediatamente todos los cambios. Después de reiniciar la app aparecieron observaciones posteriores con sus horas originales. Una copia sin cambios del almacenamiento no basta para concluir que el receptor dejó de funcionar. Se eliminaron las copias temporales del contenedor tras extraer las métricas; no se publicaron ubicaciones del usuario.

## Control por USB

XCUITest ejecutó en el dispositivo: carga del mapa empaquetado, selección de vista local, inicio de escucha, permanencia de 120 segundos en primer plano y parada de escucha. La prueba pasó, con capturas y árbol accesible de la propia app. La primera corrida necesitó corregir el selector del control de vista local: WebKit no lo expone como botón ordinario.

El proyecto incluye la prueba en `ios/OndaUITests/`. No requiere Duplicación del iPhone para pulsar los controles. El receptor contiene sus recursos y excluye los snapshots del emisor; la información del mapa entra mediante el ensamblador de paquetes acústicos.

## Radio simulada, 19:15–19:17 Lima

La laptop emitió la observación LIVE de las 18:50 mediante el perfil `radio`, velocidad `fast`, dos repeticiones por rejilla. El altavoz reprodujo el DSP de `src/audio-channel.js`: filtros de banda, siseo continuo y variación lenta de señal. El iPhone mantuvo el receptor acústico ya instalado; no se modificó su contenido para introducir esta observación.

El resumen global «Más reciente» avanzó de 18:40 en la captura inicial a 18:50 en la final, conservando dos capas. Esto confirma recepción física de una observación nueva mediante el canal simulado. La capa nacional se actualizó; el detalle de 9 × 9 del punto seleccionado permaneció en 18:40, con uno de dos fragmentos pendientes al final. No se verificó actualización completa de todas las capas durante esta prueba.

La prueba de interfaz terminó con cero fallos en 144,336 segundos, incluida la ventana de escucha de 120 segundos y su parada. Pasar el test de interfaz comprueba los controles y la permanencia; el cambio de fecha del mapa es la evidencia específica de recepción.

Los resultados de Xcode quedaron en `/tmp/onda-usb-ui-radio.xcresult`, el registro en `/tmp/onda-ios-ui-test-radio.log` y los informes filtrados en `/tmp/onda-usb-ui-radio-evidence.txt` y `.json`. No se incorporaron capturas originales que pudieran mostrar una ubicación seleccionada. Los parámetros y límites del ensayo de software se describen en [RADIO-SIMULATION.md](RADIO-SIMULATION.md).

## Límites de la evidencia

Se verificaron recepción y cambios reales en la sala descrita por el usuario. No demuestra inmunidad a cualquier voz, ruido, distancia, radio AM/FM o modelo de teléfono. No se completó una prueba física en modo avión ni de obtención GPS sin red. La firma de desarrollo actual vence el 24 de octubre de 2026; debe renovarse para seguir ejecutándose después.

La app ahora solicita mantener encendida la pantalla mientras el audio está activo y libera esa solicitud al detenerse o salir de primer plano. Esto evita depender de tocar la pantalla repetidamente; no habilita recepción en segundo plano.
