# Manzana: auditoría de piezas disponibles

Fecha: 2026-10-18. Investigación de lectura; no se ejecutaron modelos ni se midió latencia propia.

**Conclusión: no encontré una opción que reúna pesos abiertos, detección fiable de plaga en FRUTO en campo, validación Perú, impacto peruano cuantificado y retiro robotizado listo.** Manzana sí es compatible con el cosechador Tevel según el fabricante; esa compatibilidad mecánica no valida el diagnóstico ni el manejo sanitario.

## Modelos y descartes

| Candidato / fuente primaria | Pesos y licencia verificados | Métrica publicada y población | ¿Sirve para seleccionar fruto enfermo? |
|---|---|---|---|
| [cosmic1112/Apple_YOLO_cls](https://huggingface.co/cosmic1112/Apple_YOLO_cls) | API de archivos confirma `weights/best.pt` 10,262,024 B y ONNX 20,350,865 B. Card declara MIT. YOLOv8s-cls, entrada 224, 10 épocas según args.yaml. | CSV de validación: top-1 1.0 en época 5, 0.99842 en época 10. Matriz publicada: scab126, black_rot124, cedar_apple_rust55, healthy329, diagonal perfecta. No test externo, país ni identidad de frutos/hojas documentados. | **No.** Clasificación de imagen, sin localización. Etiquetas y cantidades son compatibles con un split de PlantVillage; procedencia exacta no demostrada. Ninguna evidencia de diagnóstico de FRUTO en árbol. No convertir 100% de validación en eficacia real. |
| [ayushdabra/apple-scab-disease-classification](https://github.com/ayushdabra/apple-scab-disease-classification) | GPL-3.0 código; árbol completo de GitHub sólo notebooks/README/imágenes, sin checkpoint. Dataset declara CC BY-NC-ND 4.0. | VGG16: accuracy85.71% en 28 fotos (12 sanas/16 sarna). 297 originales de frutos de Letonia/LatHort. README reconoce reutilizar test durante entrenamiento/validación. | **No listo.** Sí FRUTO, pero clasificador sin localización, evaluación pequeña no independiente y sin pesos publicados. |
| [Rouš et al., 2023](https://arxiv.org/abs/2302.08818) | No descarga directa de pesos localizada en la publicación revisada. | RGB precision0.80 y mAP50=0.73 sobre estudio de168 escenas de huerto; análisis espectral de hojas. | No acredita selección fiable de cada manzana enferma ni paquete listo. |
| [Leiva et al., Plant Methods2026](https://link.springer.com/article/10.1186/s13007-026-01508-7) | Datos completos por solicitud al autor; no enlace a pesos/código entrenado localizado en artículo. | Sí FRUTO, huerto+laboratorio Suiza; split agrupado por fruto. Abstract: detector fruto P0.98/R0.95/mAP50=0.94; lesiones P0.64/R0.75/mAP50=0.75. Conclusión reporta otros agregados superiores: no confundir ambos ni elegir sólo el mayor. | Investigación relevante, **no pieza abierta lista**, no validación Perú y limitación explícita de lesiones pequeñas/lado oculto. |
| [MGA-YOLO](https://github.com/liao1fan/MGA-YOLO-for-apple-leaf-disease-detection), [deep-diagnosis](https://github.com/drkhan107/deep-diagnosis) | Repos de modelos de HOJAS; deep-diagnosis lista .pth y GPL3. No se descargaron pesos para esta auditoría. | Métricas de sus tareas de hojas no transferibles a fruto. | Descartados por órgano objetivo. |
| [ADEC](https://github.com/mustafa20999/ADEC), [paper2025](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0322586) | Dataset de frutos; README limita a uso académico. Repositorio muestra Train/Test, no pesos. | Siete clases; imágenes clasificadas, sin garantizar localización en árbol ni independencia por huerto Perú. | Dataset útil para investigación, **no modelo listo**. |

Accesos reproducibles para el candidato ejecutable de clasificación:

- [HF API archivos](https://huggingface.co/api/models/cosmic1112/Apple_YOLO_cls/tree/main?recursive=true)
- [args.yaml](https://huggingface.co/cosmic1112/Apple_YOLO_cls/resolve/main/args.yaml)
- [results.csv](https://huggingface.co/cosmic1112/Apple_YOLO_cls/resolve/main/results.csv)
- [Matriz publicada](https://huggingface.co/cosmic1112/Apple_YOLO_cls/resolve/main/confusion_matrix.png)

La RTX4060 debería ejecutar un YOLOv8s-cls pequeño; es una expectativa de capacidad, no medición propia. No se revisó completamente la transformación de inferencia del export ONNX; no afirmar equivalencia usando sólo resize224.

## Perú: presencia no equivale a impacto demostrado

- [SENASA BPA manzana2020](https://www.senasa.gob.pe/senasa/wp-content/uploads/2020/07/Guia-BPA-MANZANA-1.pdf) incluye Cydia pomonella, moscas de fruta y sarna/roña Venturia inaequalis en el manejo del manzano. Esto acredita relevancia fitosanitaria local; no mide pérdidas nacionales de cada enfermedad.
- [SENASA Apurímac](https://www.senasa.gob.pe/senasacontigo/senasa-y-productores-combatiran-la-mosca-de-la-fruta-en-la-region-apurimac/) documenta intervención en productores de durazno y manzano.
- [SENASA control nacional2023](https://www.senasa.gob.pe/senasacontigo/acciones-de-control-de-mosca-de-la-fruta-se-despliega-en-mas-229-mil-hectareas-hortofruticolas/):229,150 ha hortofrutícolas en20 regiones. **No son229,150ha de manzana ni pérdidas atribuibles exclusivamente a manzana.**
- [MEF indicador2026](https://www.mef.gob.pe/contenidos/presu_publ/ppr/estr_program/PP_0040_PRODUCTO_2026.pdf) mantiene moscas Ceratitis/Anastrepha como plaga priorizada en90 tipos de cultivos hortofrutícolas, con vigilancia MTD. Gran problema transversal sí; no encontramos un detector abierto y fiable de infestación de cada manzana en árbol.

## ¿Retirar frutos sirve?

[SENASA control cultural-mecánico](https://www.senasa.gob.pe/senasa/descargasarchivos/2014/12/Control-Cultural-Mecanico.pdf) recomienda recoger/enterrar frutos caídos y retirar remanentes de planta y suelo después de cosecha, integrado al control de mosca. **No equivale a diagnosticar larvas internas mediante una foto exterior ni a curar sarna recogiendo algunas manzanas.** El instrumento correcto depende del protocolo sanitario; el fruto retirado requiere manejo, no dejarlo caer bajo el árbol.

## Dictamen

**No apto para prometer esta noche «dron detecta la plaga importante peruana y la elimina» usando piezas ya fiables.** Sí apto como prototipo acotado de detección/cosecha de manzanas o clasificación asistida de fotos, declarando la separación entre diagnóstico, localización, acceso mecánico y decisión agronómica. Esa demo tendría otra promesa y no satisface por sí sola el criterio sanitario solicitado.


## Ampliación: candidato ejecutable para podredumbre visual, sin exigir integración completa

La búsqueda posterior encontró [FruitNet](https://github.com/OleksandrKlanovets/fruitnet), proyecto MIT con checkpoint real `config/fruit_classifier_v3_transfer_learning.h5` de9,428,816bytes verificado mediante árbol GitHub. Código de inferencia y app incluidos. Clasifica seis categorías: manzana, naranja y banana, cada una fresca/podrida. El autor declara99% accuracy en su test del dataset Fruits fresh and rotten de Kaggle. No se verificó test externo de huerto, patógeno específico ni ejecución propia. No localiza fruta automáticamente en escenas complejas.

**Sí constituye una pieza gratuita descargable para experimentar con selección por podredumbre visible en un recorte de manzana.** No debe descartarse por no incluir el controlador del dron: clasificar y recoger pueden implementarse como componentes separados. Tampoco debe venderse como diagnóstico de mosca de fruta o fiabilidad99% en árbol. Este hallazgo corrige cualquier lectura de la auditoría anterior como «no existe ningún modelo utilizable».
