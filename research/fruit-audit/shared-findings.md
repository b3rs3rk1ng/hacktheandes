# Evidencia transversal: recolector Tevel y encaje Perú

Revisión documental 17 octubre 2026. No se ejecutaron estos modelos, no hay tasas propias de inferencia ni prueba en un dron Tevel. Se asignó un agente separado por cada una de las seis frutas del listado actual del fabricante.

## Robot y frutos

La foto aportada coincide visualmente con FAR de Tevel. El fabricante lista apples, peaches, nectarines, plums, pears y apricots bajo “Fruits We Are Picking”: https://www.tevel-tech.com/ . La compatibilidad declarada es de esta familia de robots, no certificación independiente del ejemplar antiguo de la fotografía, de toda variedad ni de extracción de frutos podridos.

El fabricante documenta recogida de manzanas en Chile: https://www.tevel-tech.com/press-release-tevel-partners-with-unifrutti-expands-to-south-america/ . Para duraznos, nectarinas y ciruelas, describe operaciones con HMC Farms: https://www.tevel-tech.com/tevel-partners-with-hmc-farms-of-kingsburg-california-ex/ . HMC confirma el piloto en su propia web: https://www.hmcfarms.com/tag/tevel/ .

No encontramos una interfaz pública de control, SDK ni repositorio abierto del controlador Tevel. Esto no demuestra que no ofrezcan integración comercial. No presentar una simulación nuestra como su software, física validada o integración con su hardware.

## Problema peruano

SENASA confirma intervención contra mosca de la fruta en productores de duraznos y manzanas de Apurímac: https://www.senasa.gob.pe/senasacontigo/senasa-y-productores-combatiran-la-mosca-de-la-fruta-en-la-region-apurimac/ .

Nota SENASA del 1 febrero 2024: 70,986 agricultores y 143,637 hectáreas hortofrutícolas en ocho regiones en proceso de erradicación (Proyecto Mosca IV). Son beneficiarios/área del programa multicultivo, no productores infectados de una sola fruta, superficie perdida ni ahorro atribuible al robot: https://www.gob.pe/institucion/senasa/noticias/900543-midagri-mas-de-70-mil-productores-beneficiados-con-campana-de-control-de-mosca-de-la-fruta . Texto recuperado por urllib con User-Agent de navegador; el visor web recibió HTTP418.

Las larvas se desarrollan dentro del fruto. La vigilancia combina trampas y muestreo: https://www.senasa.gob.pe/senasacontigo/junin-senasa-controla-incidencia-de-mosca-de-la-fruta-mediante-sistema-de-trampeo/ . No se sigue de ello que todo fruto infestado sea reconocible por una cámara externa. Recojo y disposición sanitaria son una parte del manejo integrado, no garantía de eliminar la plaga.

## Tamaño de los cultivos, sin confundir con daño sanitario

RM0046-2026-MIDAGRI, anexo Padrón de Productores Agrarios: manzana7,695, melocotón5,940, ciruela955 productores de agricultura familiar. Son registros del padrón, no necesariamente censo exhaustivo ni afectados por plaga. Fuente: https://busquedas.elperuano.pe/api/visor_html/2485345-1 . No usar el número de toda fruticultura como mercado de cada cultivo.

## Comprobación adicional de fruto (no hoja)

https://huggingface.co/cvtechniques/rotttenfruits describe YOLO11 manzanas/naranjas sanas y podridas en cinta transportadora. Reporta RottenApple precision .935, recall .984, mAP50 .981 y mAP50-95 .915. El autor limita explícitamente su uso a fondos simples y reconoce degradación con fondos complejos. La API de archivos a revisión5a79fc87c38cf9db90f493c322d063c89819dcc7 NO lista .pt/.onnx ni licencia (cardData null); hay métricas, imágenes y args, sin pesos. Tampoco identifica especie de plaga, ni valida fruta en árbol peruano. No presentarlo como paquete abierto listo pese a cifras elevadas.

Otro antecedente https://arxiv.org/abs/2512.22990 combina detección manzana, clasificación de hojas y frescura: 98.9% accuracy de hojas, 97.4% frescura y F1 .857 localización. Son tres tareas distintas, no una tasa de diagnóstico sanitario del fruto y extracción autónoma.

## Criterio de decisión

Un candidato prometedor puede servir para experimentar con sus límites. Una métrica publicada alta no acredita por sí sola alta fiabilidad de extremo a extremo. Para afirmar que es una pieza lista deben existir pesos/licencia/inferencia y evidencia de la tarea pertinente; para afirmar impacto de una plaga en Perú debe existir evidencia local, no sólo una lista de cuarentena. La fiabilidad peruana y el retiro físico quedan como afirmaciones separadas que no se deducen de métricas extranjeras. No es posible garantizar ausencia de objeciones de un jurado.
