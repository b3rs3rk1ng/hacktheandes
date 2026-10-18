# Auditoría: ciruela Prunus, 2026-10-18

## Veredicto

**Ningún candidato encontrado cumple conjuntamente pesos abiertos verificables, detección fiable de una plaga importante demostrada en Perú sobre ciruela Prunus, y retiro sanitario autónomo mediante el dron Tevel.** No se ejecutaron modelos: esta es auditoría de evidencia, no validación propia. Hay detección de frutos para cosecha y artículos de diagnóstico; no equivalen al sistema pedido.

## Candidatos primarios

| Candidato | Qué reconoce y métricas publicadas | Artefactos / límites | Decisión |
|---|---|---|---|
| [Ahmad et al., Sensors 2020](https://doi.org/10.3390/s20195569) | Clasificación de imágenes de fruta/hoja en cinco clases: healthy, brown rot, nutrient deficiency, shot hole fruit, shot hole leaf. Inception-v3 accuracy 94.34%; brown rot 96.30% en matriz por clase. Split 60/20/20 **antes** de aumentación; evaluación adicional de 100 fotos de internet. | Texto completo y licencia CC BY disponibles; no encontré enlace de código/pesos en sus enlaces ni publicación ejecutable del autor. Artículo recuperado por [EuropePMC XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7583767/fullTextXML). Clasifica un recorte; no localiza todos los frutos ni tallos. Sin validación peruana. | No cumple conexión inmediata. |
| [YOLO-CMA Sanhua 2026](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2026.1759809/full) | Cajas de cinco tipos: enfermo, insecto, ave, agrietado, normal. Global P95.4%, R88.1%, mAP50 91.1%, mAP50–95 73.2%. **Insecto:** P91%, R54.5%, AP50 63.9%. 10,000 imágenes tras aumentación; split 70/20/10. | [Repo del autor](https://github.com/wo-boboya/Sanhua-Plum-Multi-Weather-Enhanced-Dataset): API raíz muestra README y carpetas de imágenes/etiquetas; releases vacías; no pesos/licencia visibles. Una zona de China, sin prueba externa Perú, agujeros menores de 1mm difíciles; identidad de agente causal no establecida por clase genérica. No pude auditar recursivamente todos los archivos: API tree devolvió 500. | No alta fiabilidad para insectos; no pesos verificados. |
| [ACFR University Sydney](https://data.acfr.usyd.edu.au/Agriculture/PlumDetection/) | Localizar **ciruelas rojas**, no diagnosticar enfermedad. 350 fotos diurnas y 350 nocturnas; 4449 y 1402 frutos. Comparación documentada con AP VOC2007 IoU0.5, no accuracy sanitaria ni AP50–95. | Pesos reales listados, por ejemplo [trained_weights_final.h5](https://data.acfr.usyd.edu.au/Agriculture/PlumDetection/networks/YoloV3/DayTransferResults/trained_weights_final.h5), 235MB, con train.py y métricas. Repos Keras/TensorFlow antiguos; no comprobé ejecución actual ni licencia específica de pesos. [Paper autor](https://arxiv.org/abs/2105.03832). | Útil para cosecha; no cubre plaga. |

## Trampas de taxonomía y métricas

- [Dataset 2025 llamado “plum leaf and fruit”](https://pmc.ncbi.nlm.nih.gov/articles/PMC12145562/) usa variedades **Deshi Kul y Apple Kul**; el artículo las vincula con jujube/buckthorn. No asumir Prunus por traducción “plum”. Mezcla hojas y fruta y solo categoría genérica de fruto enfermo. Sus 3554 fotos no son un detector listo con pesos y validación peruana.
- “Java plum”, “hog plum”, “African plum”, “mango ciruelo” tampoco son automáticamente ciruela Prunus.
- AP de localización de frutos, accuracy de clasificación, sensibilidad de enfermos y éxito de manipulación son medidas distintas.

## Perú e intervención sanitaria

[SENASA 2017 Tumbes](https://www.senasa.gob.pe/senasacontigo/tumbes-senasa-capacita-a-productores-de-ciruela-en-tecnicas-de-control-de-mosca-de-la-fruta/) describe mosca de la fruta y recojo/entierro de frutos en ciruela, con 400ha. **La nota no identifica especie botánica; no prueba que ese cultivo sea Prunus**, ni sustenta pérdidas nacionales actuales en ese fruto. [Otra nota SENASA](https://www.senasa.gob.pe/senasacontigo/senasa-monitoreo-de-incidencia-de-plaga-mosca-de-la-fruta-en-frontera-con-ecuador/) explica oviposición y larvas internas: el daño interno puede faltar en imágenes RGB externas.

No hallé en esta búsqueda evidencia primaria suficiente para declarar una enfermedad identificada por esos modelos como **gran problema de ciruela Prunus en Perú**. Una norma de importación con plagas exigidas ausentes no demuestra presencia ni pérdidas locales. Recojo/entierro de frutos caídos o sobremaduros tampoco demuestra que arrancar un fruto detectado por dron sea suficiente tratamiento.

Tevel puede listar ciruela como cultivo de cosecha; eso no confirma capacidad de reconocer enfermedad, arrancar frutos degradados sin diseminar inóculo ni disponerlos sanitariamente. Pendientes: espécimen/variedad peruana, patógeno confirmado, fotos externas independientes, umbral de intervención agronómico, geolocalización/alcance y manipulación con contención.
