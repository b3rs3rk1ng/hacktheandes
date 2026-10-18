# Simulación del canal de sonido

Los perfiles de radio mantienen un ambiente continuo de siseo, crujidos y silbido durante la voz, los datos y las pausas. El nivel de siseo y los parámetros de crujidos se conservan al terminar la entrada; no se rebajan para facilitar la recepción de paquetes. Los crujidos son eventos aleatorios del perfil, no un sonido permanente ni dependiente del contenido transmitido.

El silbido tiene fase independiente de la introducción: 850 ± 35 Hz en el perfil estable y 880 ± 55 Hz en señal variable. Es una elección de la escena sonora, no una propiedad necesaria de toda radio. El perfil directo conserva sonido sin efectos. Las pruebas comprueban continuidad y recuperación de campos tras pausas de treinta segundos; los resultados físicos de versiones anteriores no validan automáticamente los parámetros actuales.

La ganancia final se controla entre cero y uno desde la radio 3D o el deslizador, con valor inicial de 0,65. Afecta conjuntamente a voz, datos y efectos; bajar a cero silencia todo el canal. La atenuación de volumen y las condiciones físicas pueden afectar a la recepción.

La estación ofrece sonido directo, radio estable simulada y señal variable simulada. El perfil inicial es radio estable. La misma selección de canal y velocidad se aplica al flujo de rejillas y a los avisos escritos de ejercicio.

La simulación procesa las muestras que salen del altavoz. No modifica los datos ni entrega paquetes al receptor por otra vía. El iPhone sigue reconstruyendo los fragmentos captados por su micrófono, con la misma corrección del módem y las verificaciones CRC del transporte.

## Emisión continua y prueba breve

**«Encender radio»**, en el panel principal y en el botón del modelo 3D, inicia la emisión continua. Prepara la fuente, reproduce la entrada con locutor y transmite boletines hasta pulsar **«Apagar radio»**. Los cinco segundos corresponden a la introducción, no a la duración de la radio. La interfaz muestra la fase, la fecha de la observación y el avance real de los fragmentos.

El control secundario **«Probar sonido · 5 s»**, dentro de **«Fuente y ajustes de la radio»**, permite oír sólo la entrada con locutor y el ambiente del perfil seleccionado. Reproduce sonido mediante `previewChannel({channel, seconds: 5, signal, keepAlive: false})`: no prepara ni consulta la fuente, no codifica rejillas y no llama a `transmit`. La voz no contiene datos del mapa ni una entrega alternativa de paquetes. La recepción del mapa sigue dependiendo de los tonos posteriores.

Cada inicio de emisión continua prepara primero la fuente y reproduce esa entrada una sola vez con `keepAlive: true`, antes de comenzar las rejillas. La selección de canal, contexto y velocidad permanece fija durante toda la emisión. **«Apagar radio»** puede detener también la preparación y esta introducción; la prueba de sonido tiene su propio botón para detenerse y admite la misma cancelación común de la estación.

El boletín recorre todas sus capas antes de repetirlas. Con las dos actuales, el orden es nacional → local → nacional → local; el mecanismo funciona igual con cualquier lista de capas compatible. Conserva dos copias de cada paquete, pero adelanta la primera recepción del detalle local. Tras las dos pasadas espera 2,5 segundos y vuelve a emitir, manteniendo el ambiente durante la pausa. En el histórico avanza a la siguiente observación entre boletines; en vivo conserva la observación disponible y su fecha original hasta que la fuente publique otra.

Ambas acciones comparten la propiedad del audio: no se puede comenzar una mientras la otra está activa. Al terminar, detener o fallar se liberan el módem y los controles. Las pruebas de estación comprueban el orden introducción→paquetes, una sola entrada entre varias rejillas y observaciones, ausencia de consultas y datos durante la prueba, interrupción antes de los paquetes y recuperación de los controles.

`src/audio-channel.js` mantiene un estado común por canal: filtros, generador de ruido y dos componentes lentos de variación de ganancia. Ese estado continúa durante los silencios y entre mensajes. La entrada sólo añade la ecualización de la voz y medio segundo de barrido de sintonía; no tiene parámetros separados de siseo o crujidos. Un grafo Web Audio persistente en `src/audio.js` mantiene el ambiente también durante las pausas de 250 ms y entre vueltas. Al detener, cambiar a sonido directo o comenzar una recepción se libera el grafo.

| Perfil | Banda aproximada de la señal | Siseo RMS antes de su filtro | Crujidos: eventos/s y amplitud | Variación máxima de ganancia |
| --- | --- | --- | --- | --- |
| Directo | Sin filtros añadidos | 0 | 0 | 0 |
| Radio estable | 150–7000 Hz | 0,04 | 3,5/s; 0,13 | 18 % |
| Señal variable | 250–4500 Hz | 0,07 | 5/s; 0,17 | 65 % |

Son valores normalizados de PCM, no mediciones de potencia RF ni una calibración de una emisora, estándar o aparato concreto. La salida simulada usa saturación suave para acotar amplitud. La señal variable puede perder fragmentos; no se fuerzan fallos ni éxitos según el contenido de los datos.

## Verificación de software

Las pruebas comprueban procesamiento continuo e independiente del tamaño de bloque, silencio con siseo, variación suave, respuesta de banda, diferentes semillas, validación antes de modificar estado y frecuencias de muestreo de 16 a 192 kHz. El módem real se comprueba a 44,1 y 48 kHz. La integración verifica que todo el audio emitido atraviese el canal elegido, su conservación entre transmisiones, actividad de pantalla mientras suena el siseo y liberación al detener, interrumpir, abortar o fallar.

Un ensayo anterior con las dos rejillas iniciales y las dos del primer histórico recuperó los cuatro campos completos en las 24 combinaciones de 44,1/48 kHz, FAST/FASTEST, dos semillas y los tres perfiles. Cada combinación decodificó 16 fragmentos de dos repeticiones, sin CRC inválidos, y comparó los valores reconstruidos. Es un resultado de los parámetros que se usaron entonces, no una certificación de los nuevos niveles constantes de siseo y crujidos. Las pruebas actuales deben ejecutarse sobre el DSP actualizado.

Con el ambiente constante actual se reconstruyeron ambas rejillas de la observación real de las 19:50 en 48 de 48 escenarios: FAST/FASTEST, 44,1/48 kHz, tres semillas y cuatro condiciones (directo, radio, señal variable y radio con ruido blanco externo de SNR 10 dB). La ganancia final fue 0,65. Cinco escenarios perdieron una de las ocho copias de fragmentos; las repeticiones permitieron completar ambas capas y comparar sus valores exactos, sin CRC inválidos. Otras cuatro pruebas enlazaron el WAV real del locutor con los datos exactamente a los cinco segundos y recuperaron ambas rejillas en las dos velocidades y frecuencias de muestreo. Estas condiciones sintéticas no representan una tasa de éxito en campo.

Los ensayos de software atraviesan el DSP implementado, pero siguen siendo simulaciones PCM. No prueban una cadena de radiodifusión AM/FM, interferencias de otras estaciones, alcance, todos los micrófonos o altavoces ni ausencia de pérdidas. La validación física del flujo actual exige recibir todas las capas completas durante la sesión, no sólo mantener el micrófono activo ni ver una capa antigua guardada. La recepción física y los límites de cada corrida se documentan por separado en [IPHONE-VALIDATION.md](IPHONE-VALIDATION.md).
