# Búsqueda: modelos chinos de enfermedad en mazorca de cacao

Revisión documental 17–18 octubre2026. No se ejecutó ningún modelo nuevo. Se buscaron términos chinos 可可 病害, 可可果 病害检测, 可可豆荚 检测, 模型权重 y sus equivalentes ingleses; búsquedas orientadas a GitHub, Gitee y ModelScope. La búsqueda web indexada no equivale a recorrer exhaustivamente todos los catálogos chinos.

## Hallazgo primario de institución china

Nyarko et al.,2024, Southwest University of Science and Technology, China: Improved YOLOv5m based on Swin Transformer, K-means++ and EIoU. DOI https://doi.org/10.24425/jppr.2024.151253 . Artículo https://www.plantprotection.pl/Improved-YOLOv5m-model-based-on-Swin-Transformer-K-means-and-Efficient-Intersection,187093,0,2.html . PDF https://www.plantprotection.pl/pdf-187093-113569?filename=113569.pdf .

Declara precision96%, recall94%, mAP92%. El texto completo, sección Dataset analysis and preprocessing, define cuatro clases: swollen shoot, stem borer, brown root rot, healthy stem. No son moniliasis de la mazorca ni diagnóstico de frutos retirables. Dataset1000imágenes antes del procesamiento;2173después, split7:2:1. No encontramos descarga de modelo entrenado ni repo de autores. Consultas GitHub API cocoa disease swin y cocoa Nyarko devolvieron cero repositorios. No es prueba de inexistencia universal, ni evaluación propia de calidad. No comparar sus96% de otra tarea con el26% aparente de clasificadores externos en muestra Bagua.

## Resultados chinos que no acreditan un modelo utilizable

La entrada china de312fotos/1591cajas menciona sanos/monilia/Phytophthora, pero es un catálogo de datos sin métricas y sin modelo entrenado: https://blog.51cto.com/u_17467352/14930604 . Se observan incluso traducciones dudosas de la clase Monilia; no atribuir identidad de patógeno al nombre chino traducido. Repackaging no demuestra origen chino del trabajo ni nuevo rendimiento.

Varios resultados en chino eran traducciones de estudios de Latinoamérica o Ghana. El artículo EfficientDet-Lite4 https://arxiv.org/abs/2401.01247 se publicó en un congreso celebrado en Shanghai; la sede de congreso no prueba afiliación china ni origen chino de datos.

## Hallazgos relacionados, separados de China

LGF-CBAM de autores de Ghana, DOI10.1371/journal.pone.0348147: rendimiento publicado alto en datasets de mazorca, incluida Monilia; artículo en https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0348147 . Su texto enlaza Figshare31294003 como datos; no encontramos enlace de pesos en el artículo. No presentar una traducción china como modelo chino ni afirmar ejecución propia.

Repositorio ecuatoriano https://github.com/carolsanmentech-ai/ecuadorian-cacao-moniliasis : la API recursiva muestra README, tres notebooks y weights/ar de1byte, sin checkpoint ni licencia. No es descarga de modelo entrenado verificada.

## Resultado acotado

Sí encontramos investigación de cacao desde China. No verificamos un modelo chino gratuito, descargable, que localice moniliasis en la mazorca y haya demostrado buen rendimiento para la tarea buscada. No se concluye que no existan modelos utilizables en otros países, ni se descarta cacao. El país no es criterio sanitario: debe coincidir la enfermedad y el órgano objetivo; disponibilidad del modelo y rendimiento se comprueban por separado.


## Rastreo específico de descarga solicitado después

### Modelo Nyarko96%

Se revisaron nuevamente página editorial, PDF completo (descargado en pdf.pdf, extraído mediante pdftotext en nyarko-fulltext.txt), metadatos Crossref y ORCID0000-0002-1738-6048. Crossref sólo aporta enlace al PDF, sin relaciones de software/datos. ORCID no tiene researcher-urls. Enlaces de la página editorial no incluyen GitHub/Gitee/Zenodo/Figshare/Drive/checkpoint/suplemento. Búsqueda por DOI, autora y arquitectura no localizó el archivo entrenado.

La cuenta GitHub bennynyarko aparece por búsqueda de nombre, pero no se verificó que sea la autora del artículo: nombre con apellidos diferentes, único repo de sitio de construcción, sin modelos. No atribuirle identidad por coincidencia de nombre. La página Roboflow Miss Nyarko muestra3009imágenes y Models0, con clases distintas al artículo; tampoco prueba autoría ni contiene el checkpoint del estudio. https://universe.roboflow.com/miss-nyarko-s2gtm/cocoa-disease-detection . Su ejemplo de API está marcado Powered by general detection model: no constituye publicación del modelo especializado del paper.

Contacto de correspondencia publicado por el artículo: benedictanyarko41@gmail.com. No se enviaron mensajes. Para conseguir ese modelo específico la vía pendiente es solicitar a los autores el checkpoint, código exacto, configuración y permiso de uso; no hay garantía de que lo entreguen.

### Hallazgo nuevo separado: CGM-DETR, Wuhan2026

Paper https://link.springer.com/article/10.1007/s13042-026-03019-2 , autores Wang/Chen/Dong/Liu, Wuhan Polytechnic University, China. Tiene repositorio que afirma implementar el artículo: https://github.com/sanmeincong/CGM-DETR . No es el modelo96% de Nyarko.

API recursiva revisada en commitd38da3e3b692825f31e0188269a52562a1a62cd0:9913archivos, respuesta no truncada, sin releases. Único checkpoint: yolov8n.pt6,534,387bytes, modelo genérico. No existe best.pt del CGM entrenado. train.py y val.py intentan cargar runs_outer\train\exp9\weights\best.pt, una ruta local ausente del repo. detect.py referencia otro best.pt también ausente. Código/configuración y dataset sí publicados; licencia raíz no encontrada, CITATION conserva AGPL3 de Ultralytics. No se ejecutó código externo.

Clases de Datasets/COCOA/data.yaml: BLACKPOD, FROSTY ROT, HEALTHY, MIRID. Son de mazorca y más cercanas al objetivo que Nyarko, pero no hay modelo entrenado verificable para ejecutar sin entrenamiento. Su artículo reporta mejora relativa frente a RT-DETR, no se leyó cuerpo completo bajo suscripción; no inventar cifras absolutas.

Otros repos con mismo nombre: ChenShiu/CGM sólo README15bytes; ChenShiu/CGM-DETR vacío (GitHub409). No hay descarga de modelo entrenado en ellos.
