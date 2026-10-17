# Onda

Prototipo para Hack the Andes: una laptop consulta datos oficiales con internet y los transmite mediante tonos audibles. El teléfono recupera paquetes por el micrófono, actualiza un mapa guardado y conserva los datos sin conexión. El canal implementado es acústico; una emisora AM/FM real requiere pruebas adicionales.

## Ejecutar

Requiere Node.js 22 o posterior. Instala la dependencia de desarrollo `esbuild`; ggwave 0.4.0 y fflate 0.8.3 están incluidos localmente con sus licencias.

```sh
npm ci
npm test
npm run build
npm run validate
npm run dev
```

Abre `http://localhost:4173`. El servidor local sirve `dist` y el endpoint `/api/feed`. El build también produce `dist/server/index.js`: un Worker ESM autónomo que incorpora los mismos recursos estáticos y el gateway. La configuración de Sites conserva el proyecto existente; no requiere D1 ni R2.

Para otro dispositivo utiliza HTTPS: una dirección HTTP de la red local no habilita el micrófono en Safari. `localhost` sólo sirve para el dispositivo que ejecuta el servidor.

## Preparar el teléfono

1. Abre Onda en Safari con conexión y espera **«Lista sin internet»**. Ese estado comprueba que el service worker guardó los recursos de esta versión, incluidos mapa, localidades y módem.
2. Para añadirla al inicio del iPhone, utiliza **Compartir → Añadir a pantalla de inicio**. No es una app nativa ni descarga datos automáticamente por radio. Abre también el icono instalado con conexión y comprueba su preparación offline antes de depender de él.
3. En **«¿Dónde estás?»**, elige una localidad guardada, toca un punto del mapa o pulsa **«Usar mi ubicación»**. Las coordenadas se guardan en ese teléfono y no se envían al servidor.
4. La selección manual funciona sin red. El botón GPS usa la API de geolocalización del dispositivo, sin reverse geocoding ni consultas de red hechas por Onda. Obtener una posición depende del equipo, permisos y condiciones; sin conexión puede tardar o fallar. Siempre queda la selección manual.
5. Para verificar la preparación, activa modo avión, apaga Wi-Fi y Bluetooth y vuelve a abrir Onda. El almacenamiento del navegador puede ser eliminado por el usuario o el sistema; guardar la web una vez no garantiza conservación permanente.

La ubicación del mapa y la localidad de los avisos escritos son controles separados. Los avisos usan identificadores territoriales declarativos; el mapa consulta las celdas que contienen las coordenadas elegidas.

## Recibir y emitir

En el teléfono pulsa **«Escuchar boletín»**, permite el micrófono y mantén Onda visible con la pantalla encendida. La escucha se detiene al ocultar la página. No se implementa recepción permanente en segundo plano. Para una prueba física evita iPhone Mirroring: durante la duplicación el micrófono del iPhone no está disponible.

En la laptop abre **«Emitir»**. El panel prepara el snapshot incluido y consulta `/api/feed`. Selecciona:

- **Último análisis real:** transmite la observación más reciente disponible y conserva su fecha original.
- **Histórico · ver cambios:** reproduce seis observaciones reales anteriores, con contexto `replay` y rótulo histórico. Al terminar la secuencia sigue repitiendo el último registro; no genera observaciones nuevas.

Pulsa **«Emitir datos continuamente»** con el teléfono cerca del altavoz, empezando con volumen medio. Cada rejilla se fragmenta y se transmite dos veces. Entre vueltas hay una pausa de 2,5 segundos; la laptop debe permanecer abierta. **«Resistente»** usa el modo `fast` de ggwave; **«Rápida · experimental»** usa `fastest`. Una mayor velocidad no implica fiabilidad acústica equivalente.

Para ver cambios del histórico, elige Tamshiyacu y abre **«Mi zona»** en el receptor. El mapa permite explorar Perú y muestra lo recibido para el punto seleccionado. La emisión actual incluye un resumen nacional de 26 × 38 celdas, de aproximadamente 0,5°, y un detalle de 9 × 9 alrededor de Tamshiyacu, de aproximadamente 22 km de lado. Son muestreos de centros de celda, no cobertura de radio comprobada ni resolución uniforme de todo el país.

El editor desplegable también permite enviar un aviso escrito de ejercicio. Un emisor no recibe confirmación del teléfono: terminar de reproducir los tonos no demuestra entrega. Comprueba el contenido recibido y su fecha en el receptor.

## Fuente real, caché e histórico

El adaptador consulta el [índice de nowcasting de SENAMHI](https://www.senamhi.gob.pe/mapas/mapa-nowcasting/nowcasting-analisis.php), descubre su último identificador y descarga el GeoJSON del WFS oficial. El navegador no puede consultar directamente ese WFS por CORS; el gateway lo hace desde el servidor. El receptor no consulta `/api/feed` ni descarga las rejillas por internet: éstas entran por audio.

`GET /api/feed` devuelve el contrato común `{fields, fetchedAt, sourceUpdatedAt, ...}`. Sólo acepta GET/HEAD sin parámetros; no permite elegir URLs externas. Usa caché de 300 segundos cuando hay Cache API, un límite total de 15 segundos y respuestas de fuente acotadas. Ante un fallo devuelve JSON HTTP 503; no sustituye silenciosamente la consulta por datos antiguos. El cliente emisor conserva su último snapshot con la fecha original. **«Consultar ahora»** también respeta esa caché.

Durante la emisión actual se vuelve a consultar cuando han pasado al menos cinco minutos, al comenzar una nueva vuelta. La cadencia de publicación de SENAMHI es independiente: repetir una emisión o consultar el endpoint no crea información nueva. La vigencia de dos horas de cada rejilla es un criterio operativo de Onda, no la duración de un aviso oficial. La interfaz distingue observaciones desactualizadas, futuras e históricas.

Los archivos `public/data/initial-feed.json` y `replay-feed.json` son observaciones reales empaquetadas con su fecha. El primero permite preparar el emisor cuando la fuente falla; no se presenta como una consulta recién completada. Para actualizarlo de forma explícita:

```sh
node scripts/refresh-data.mjs
```

El build no depende de una consulta HTTP ni refresca esos archivos automáticamente. Para generar otra reproducción desde archivos GeoJSON guardados:

```sh
node scripts/refresh-data.mjs --output public/data/replay-feed.json --replay snapshot-a.json snapshot-b.json
```

El nowcasting es experimental. `1`, `2` y `3` conservan las categorías amarilla, naranja y roja de la fuente; `0` significa **sin clasificación en el punto muestreado**, no ausencia de lluvia; `255` significa **sin dato**. No se interpretan `ppmin`/`ppmax` como milímetros ni se infieren daños, predicción exacta para un poblado, rutas seguras o instrucciones oficiales de evacuación. Un punto sin categoría puede cambiar en la siguiente observación. No hay respaldo oficial de SENAMHI al proyecto.

## Componentes y contrato

- `src/protocol.js`: avisos con formato de transporte v1 y rejillas con formato v2, sobre un mecanismo común de fragmentación, DEFLATE opcional, CRC32 y reensamblado acotado. Ambos contratos de aplicación usan `version: 1`; esa propiedad es distinta de la versión del formato de transporte.
- `src/audio.js`: módem ggwave, micrófono, activación de audio y emisión continua con limpieza al detener. Reed–Solomon pertenece a ggwave; Onda no introduce una nueva modulación.
- `src/sources/senamhi.js`: URLs, campos, clasificación y rejillas declarativas del proveedor. `src/live-feed.js` contiene el muestreo genérico de polígonos, huecos y MultiPolygon, la descarga acotada y la conservación de fechas.
- `src/field-store.js`: reemplaza observaciones antiguas por nuevas, separa `live`/`replay`, comprueba conflictos y conserva datos recibidos localmente. `src/location.js` opera con coordenadas geográficas y almacenamiento local.
- `src/map-view.js` y `src/situation.js`: mapa sin teselas remotas, selección del punto y presentación de fuente, fecha y vigencia. La geometría base procede de Natural Earth y las localidades de GeoNames; las atribuciones están en los JSON y en el mapa.
- `src/inbox.js`: avisos escritos, deduplicación, vigencia y filtrado por identificadores configurados. `src/station.js` prepara la fuente y coordina las vueltas de emisión.
- `worker/feed-handler.js`: gateway de fuente fija; `worker/static-handler.js` sirve los recursos incorporados. `scripts/build.mjs` crea el Worker y un service worker con verificación de recursos; `/api/feed` y los snapshots inicial/histórico del emisor no se incluyen en la caché offline del receptor. Las exclusiones se declaran en `package.json`, en `onda.offline.exclude`.

Una rejilla declara `id`, `variable`, `bounds: [oeste, sur, este, norte]`, `cols`, `rows`, `values`, `observedAt`, `expiresAt`, `source` y `context: live|replay`. Las filas van de sur a norte y las columnas de oeste a este. El motor admite hasta 4096 celdas, ejes de hasta 128 y categorías `0..3` o `255`; los valores se empaquetan a tres bits antes de la compresión. Los IDs estables permiten sustituir una observación sin codificar reglas del proveedor en el transporte. Los límites no admiten una rejilla que cruce el antimeridiano en un único rectángulo.

Los paquetes miden como máximo 140 bytes: cabecera de 18 y carga de hasta 122. El mensaje compacto tiene un límite de 8192 bytes y el reensamblador conserva hasta 16 mensajes pendientes durante 15 minutos. Admite fragmentos reordenados, repetidos e intercalados. Necesita todos los fragmentos de un mensaje: las repeticiones pueden recuperar pérdidas, pero no se implementan fountain codes. CRC32 detecta corrupción accidental; no autentica al emisor. Los avisos de prueba y los campos históricos conservan su identificación en el transporte.

## Verificación y límites pendientes

Los tests cubren contratos, rejillas de geografías distintas, corrupción, orden, repeticiones, límites, persistencia, vigencia, fuentes, geometría con huecos, caché del gateway, selección manual/GPS simulado y ciclo de vida del audio. También atraviesan el módem real a 44,1 y 48 kHz con ruido sintético leve. `npm run validate` comprueba el Worker construido, los bytes de sus recursos, la ruta API y las políticas de micrófono/geolocalización.

Se verificaron la preparación de caché y la recarga en Safari. Las pruebas automatizadas comprueban la integridad del contenido guardado; la apertura física en modo avión aún debe comprobarse en el dispositivo. Un aviso escrito de la primera versión se recibió físicamente entre laptop e iPhone. Eso no valida todavía las nuevas rejillas, la velocidad experimental, el GPS sin red, todos los modelos de teléfono ni la instalación PWA en cada versión de iOS. Una prueba sintética del módem tampoco sustituye pruebas con micrófonos, reverberación, distancia y ruido real.

Quedan por medir fiabilidad del flujo completo de mapas en el teléfono, consumo y recepción mediante emisoras AM/FM. No se afirma cobertura nacional de una antena, conectividad equivalente a internet, recepción garantizada ni comunicación bidireccional a distancia. El mapa base es generalizado y no contiene una red vial operativa. Las referencias a otras fuentes oficiales no son integraciones de datos adicionales.

## Instalación directa en iPhone

La carpeta `ios/` contiene una app SwiftUI/WKWebView que incluye los recursos del receptor y abre sin depender del hosting. Reutiliza el protocolo y el módem de la web. Consulta [ios/README.md](ios/README.md) para compilar, firmar e instalar con Xcode/Developer Mode. La firma y los perfiles de desarrollo se gestionan fuera del repositorio.

La compilación para un iPhone físico y la instalación por USB se verificaron. La primera apertura necesita que el usuario confíe en el certificado de desarrollo en los ajustes de iOS. Las pruebas físicas de audio/GPS de este contenedor siguen pendientes hasta autorizarlo y abrirlo.
