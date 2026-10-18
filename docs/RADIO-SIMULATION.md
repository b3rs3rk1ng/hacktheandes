# Simulación del canal de sonido

La estación ofrece sonido directo, radio estable simulada y señal variable simulada. El perfil inicial es radio estable. La misma selección de canal y velocidad se aplica al flujo de rejillas y a los avisos escritos de ejercicio.

La simulación procesa las muestras que salen del altavoz. No modifica los datos ni entrega paquetes al receptor por otra vía. El iPhone sigue reconstruyendo los fragmentos captados por su micrófono, con la misma corrección del módem y las verificaciones CRC del transporte.

`src/audio-channel.js` mantiene un estado común por canal: filtros, generador de ruido y dos componentes lentos de variación de ganancia. Ese estado continúa durante los silencios y entre mensajes. Un grafo Web Audio persistente en `src/audio.js` mantiene el siseo también durante las pausas de 250 ms y entre vueltas. Al detener, cambiar a sonido directo o comenzar una recepción se libera el grafo.

| Perfil | Banda aproximada de la señal | Siseo RMS antes de su filtro | Variación máxima de ganancia |
| --- | --- | --- | --- |
| Directo | Sin filtros añadidos | 0 | 0 |
| Radio estable | 150–7000 Hz | 0,012 | 18 % |
| Señal variable | 250–4500 Hz | 0,038 | 65 % |

Son valores normalizados de PCM, no mediciones de potencia RF ni una calibración de una emisora, estándar o aparato concreto. La salida simulada usa saturación suave para acotar amplitud. La señal variable puede perder fragmentos; no se fuerzan fallos ni éxitos según el contenido de los datos.

## Verificación de software

Las pruebas comprueban procesamiento continuo e independiente del tamaño de bloque, silencio con siseo, variación suave, respuesta de banda, diferentes semillas, validación antes de modificar estado y frecuencias de muestreo de 16 a 192 kHz. El módem real se comprueba a 44,1 y 48 kHz. La integración verifica que todo el audio emitido atraviese el canal elegido, su conservación entre transmisiones, actividad de pantalla mientras suena el siseo y liberación al detener, interrumpir, abortar o fallar.

El ensayo adicional con las dos rejillas iniciales y las dos del primer histórico recuperó los cuatro campos completos en las 24 combinaciones de 44,1/48 kHz, FAST/FASTEST, dos semillas y los tres perfiles. Cada combinación decodificó 16 fragmentos de dos repeticiones, sin CRC inválidos. También se comprobaron los valores reconstruidos, no sólo la presencia de tonos.

Estos ensayos atraviesan el DSP exacto usado por la reproducción, pero siguen siendo simulaciones PCM. No prueban una cadena de radiodifusión AM/FM, interferencias de otras estaciones, alcance, todos los micrófonos o altavoces ni ausencia de pérdidas. La recepción física se documenta por separado en `IPHONE-VALIDATION.md`.
