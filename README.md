# Onda

Prototipo de avisos por audio para Hack the Andes. Una computadora emite tonos y un navegador receptor recupera el mensaje mediante su micrófono. La recepción y consulta funcionan sin internet después de preparar la web con conexión.

## Ejecutar

Requiere Node.js 22 o posterior. No necesita instalar dependencias: ggwave 0.4.0 y fflate 0.8.3 están incluidos con sus licencias.

```sh
npm test
npm run build
npm run dev
```

Abre `http://localhost:4173`. Para probar el micrófono de otro dispositivo, sirve el contenido de `dist` por HTTPS; una dirección HTTP de la red local no es suficiente en Safari.

## Primera prueba física

1. Abre la web en Safari en el iPhone con conexión y espera «Lista sin internet».
2. Elige una localidad. Activa modo avión y apaga Wi-Fi y Bluetooth.
3. Pulsa «Escuchar boletín», permite el micrófono y mantén la pantalla abierta.
4. En la computadora abre «Emitir», selecciona la misma localidad y escribe un mensaje nuevo.
5. Emite a volumen medio con el iPhone cerca del altavoz. Dos vueltas permiten recuperar fragmentos omitidos en la primera.
6. Comprueba texto, localidad y vigencia. Repite el mismo aviso y verifica que se conserve una copia. Una localidad distinta debe guardarse fuera del filtro actual.

## Componentes

- `src/protocol.js`: contrato común de avisos, representación compacta, DEFLATE, fragmentación, CRC32 y reensamblado acotado. No depende de nombres de fuentes ni localidades concretas.
- `src/audio.js`: módem ggwave, captura por micrófono y reproducción de tonos. La corrección Reed–Solomon corresponde a ggwave; no es una nueva modulación.
- `src/inbox.js`: filtrado por identificadores declarativos, vigencia, almacenamiento y deduplicación.
- `src/data.js`: catálogo de demostración y referencias oficiales. Seis localidades iniciales no representan cobertura comprobada.
- `scripts/build.mjs`: sitio estático y service worker con recursos locales para uso offline.

## Alcance verificado y límites

Las pruebas automatizadas verifican el contrato, corrupción de paquetes, reordenamiento, repetición, separación de mensajes, filtrado con geografías distintas, vigencia y persistencia. También verifican codificación y decodificación de la señal ggwave a 44,1 y 48 kHz con ruido sintético leve. Las comprobaciones de navegador verifican interfaz, reconstrucción, texto tratado como texto y apertura desde caché con red bloqueada.

Eso no verifica todavía el canal acústico físico laptop–iPhone, Safari del usuario, micrófonos, reverberación, distancia, consumo ni funcionamiento mediante una emisora AM/FM. Tampoco demuestra cobertura nacional, recepción permanente en segundo plano o comunicación bidireccional a distancia.

Los mensajes del editor son ejercicios. Las fuentes oficiales se muestran como referencias separadas: no hay integración en tiempo real con SENAMHI ni respaldo oficial. `status: actual` en el contrato significa contenido de fuente real y es independiente de su vencimiento. CRC32 detecta corrupción accidental; no autentica al emisor. El almacenamiento del navegador puede ser eliminado por el usuario o el sistema.

La publicación inicial está configurada como privada en Sites. No se ha enviado una entrega ni una bitácora a la plataforma del evento.
