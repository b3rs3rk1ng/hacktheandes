# Entorno de cacao: validación

Escenario de 7.80 ha, con 1190 cacaos diferentes por semilla y 12484 mazorcas. La estructura declarada se comparte entre generación y render; no depende de las etiquetas de enfermedad. La superficie de suelo tiene 46008 triángulos, con elevaciones aproximadamente entre −1.03 y +1.02 m y base plana.

## Comprobaciones ejecutadas

- 27 pruebas Python: contrato de alturas entre Python y JavaScript, interpolación triangular y límites, plantas apoyadas en suelo, variación reproducible de estructuras y frutos, compatibilidad de otro cultivo inspeccionable, superficie física compartida, control/energía y API.
- Prueba JavaScript de continuidad de movimiento.
- Agrupamiento espacial genérico de instancias: conserva transformaciones y colores al cambiar de detalle y pasa la transición cerca/lejos/cerca.
- Prueba de la geometría real de troncos y ramas: 32 combinaciones de dirección, detalle y nivel de simplificación, normales hacia fuera y rayos que alcanzan primero la corteza exterior. Corrige las caras laterales invertidas que hacían visible el interior del tronco. También verifica el cierre de ambos extremos. Los remates cercanos se redondean y solapan en las uniones; el nivel distante mantiene tapas simples. Conserva el descarte normal de caras traseras.
- [Inspección virtual](terrain-inspection-flight.json): salida desde la base y ocho vistas de un árbol, seguida de inspección del siguiente; detector conectado al RGB del navegador. Esta traza antecede a la corrección de orientación de la corteza.
- [Regreso sobre el nuevo terreno](terrain-return-flight.json): después de corregir la corteza, carga inicial explícita del 18%, despegue, tránsito, inspección, regreso por reserva, aterrizaje y aumento de carga confirmado. Ejecución física acelerada. No se activó retirada de frutos.
- [Medición de render](terrain-render-performance.json): 600 fotogramas en unos 10 segundos durante tránsito con inferencia real conectada; media 60.0 fps, percentil 95 de intervalo 17.7 ms, ningún intervalo mayor de 33.5 ms. Canvas de 1800 × 908 píxeles. Esa medición precede al cierre redondeado de las ramas. La revisión final, con extremos cerrados y vegetación agrupada espacialmente, dio **59.6 fps en FPV y 52.5 fps en seguimiento**, durante dos muestras de ocho segundos en posición sostenida con inferencia conectada. Es una medición local corta, con otra pestaña de revisión del robot abierta; no es una garantía para todo dispositivo o recorrido.

El follaje distante usa 80641 grupos instanciados de seis triángulos. La medición inicial tenía 7965 hojas individuales cercanas y 8606 hojas caídas; la final, 12825 y 8824 respectivamente. Esos dos últimos valores cambian con la posición. Los contadores del render guardados describen el último pase, no la suma de cámara principal, secundaria y sombras.

## Límites

La forma aproxima árboles podados, con frutos en tronco y ramas gruesas. Las hojas cercanas son mallas; el follaje distante usa planos cruzados con transparencia. Las uniones son segmentos cerrados y solapados, todavía no una única malla orgánica continua. La textura fotográfica del suelo no representa exclusivamente hojas de cacao. Los cultivos secundarios conservan representaciones aproximadas.

La física usa suelo ondulado y cápsulas simplificadas del tronco; ramas, raíces y hojas son visuales. No hay deformación, barro ni interacción rueda/suelo validada. La escena mantiene el vehículo de inspección existente; no integra ni modifica el robot terrestre que se está revisando por separado.

No se ejecutó el recorrido de todos los árboles, una evaluación independiente de precisión visual ni una prueba en vuelo real. Cambiar el aspecto del huerto cambia las imágenes del detector: los resultados anteriores del modelo no demuestran igual precisión en esta escena.

Capturas: [seguimiento](terrain-final-follow.png) y [corteza y extremos cerrados](terrain-closed-branches.png).
