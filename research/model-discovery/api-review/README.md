# Revisión por APIs: modelos de enfermedad o deterioro del fruto

Consulta: 2026-10-18 UTC. Sólo APIs públicas de Hugging Face y GitHub y recursos de texto/imágenes referidos por esas APIs, con Python stdlib. Se revisaron 9 búsquedas HF, detalles de 20 modelos y 11 búsquedas GitHub. Las respuestas originales, tarjetas, árboles, código leído y algunas imágenes de evaluación están en esta carpeta. [Resumen estructurado](curated-candidates.json).

No ejecuté código externo, inferencia ni modelos. No descargué pesos ni archivos de releases. La existencia de un archivo en API se distingue de comprobar su contenido y ejecución. Se leyó primero la auditoría previa de `research/fruit-audit/`.

**Sí hay piezas gratuitas reutilizables para experimentar. La manzana con deterioro exterior visible es el candidato más inmediato de esta búsqueda. Ninguna opción revisada demuestra todavía alta fiabilidad desde un dron que recorre el huerto.**

| Candidato | Evidencia verificable | Resultado declarado | Límite decisivo |
|---|---|---|---|
| [AKASH-ALAM, Fruit Quality Detection](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning) | Detector YOLOv8n, `best.pt` 6,211,946 B y `best.onnx` 12,144,721 B reales en árbol. Matriz incluye `bad apple`/`good apple`. | Validación multiclase: P .9817, R .9779, mAP50 .9897, mAP50–95 .8589, según informe. | Fotos de frutos retirados sobre mesa/mano; no huerto ni cámara móvil. MIT repo, pero Ultralytics declara AGPL3: la cadena completa no queda acreditada como MIT. |
| [ausjahk, fruits-fresh-rotten-from-scratch](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch) | Clasificador ResNet18, `model.safetensors` 44,772,544 B, config con manzana fresca/podrida; preprocesador disponible. Card Apache2. | Accuracy .9610 autodeclarada en evaluación. | Card incompleta; model-index llama `train` al split y texto dice evaluación. Procedencia/split no precisados; sin métrica por manzana, test externo, huerto o movimiento. |
| [FruitNet](https://github.com/OleksandrKlanovets/fruitnet) | Ya encontrado en auditoría previa. Confirmado H5 9,428,816 B y código; MIT repo. MobileNetV2; fresca/podrida, incluida manzana. | 99% test según autor sobre Kaggle Fruits fresh and rotten. | Clasifica recortes, sin localización y sin clase desconocida. Soportar webcam no valida visión de dron. |
| [Apricot disease classification](https://github.com/amaniqbal-ai/apricot-disease-classification) | MIT repo; releases API confirma `finetuned.zip` 843,703,864 B y `top5_v2.zip` 1,523,097,756 B. Clases mezclan fruto/hoja/rama e incluyen `brown_rot`. | MobileNetV3 Small 79.9%, Swin Base 88.46%, según config/README. | No métricas específicas de fruto con podredumbre ni localización. Archivos de releases no inspeccionados. APK relacionado reporta sólo 50% Top1 en 10 fotos de campo y 3.5 s en Oppo F15. |

## Hallazgos que afectan la integración

- AKASH es el hallazgo nuevo más directo para *localizar y distinguir manzana visualmente deteriorada*. No diagnostica una plaga o patógeno específico. El informe es de validación agregada, no prueba de retirar correctamente manzanas en árbol. El autor declara 3–4 segundos por imagen en CPU cloud; no es un benchmark a bordo.
- Revisé visualmente `akash_val2_labels.jpg`: son manzanas ya retiradas sobre superficie azul o sostenidas con mano, con numerosas vistas similares. La independencia por fruto físico no está documentada. **Esto no demuestra fuga entre entrenamiento y test**, pero impide tratar sus métricas como generalización demostrada a un huerto nuevo.
- Su `predict.py` usa `label.startswith("Good")` y `label.startswith("Rotten")`; la matriz publicada usa `good apple` y `bad apple`. Ese veredicto requiere corregirse a partir del mapa real de clases del checkpoint antes de reutilizar la aplicación. La existencia de pesos no equivale a aplicación lista sin revisión.
- El proyecto de damasco publica pesos en *releases*, aunque el árbol Git sólo tenga `.gitkeep`; una búsqueda que inspeccione únicamente el árbol los perdería. La licencia MIT se declara para el repo; no se encontró un aviso separado de los archivos de pesos ni se inspeccionó su contenido.
- El [APK de damasco](https://github.com/amaniqbal-ai/apricot-disease-classification-apk) tiene un límite honesto de campo: Top1 50%, Top2 70%, Top3 90%, n=10 y ~3.5 s con ConvNeXt INT8. Latest release v1.0.1 dice cambiar a Swin; no trasladar aquella evaluación a esta versión.

## Descartes útiles

- `ixrbhii/peach-disease-convnext` y `ixrbhii/pear-disease-convnext`: explícitamente de **hojas**.
- `NonoBru/fruit-disease-classifier`: mezcla de enfermedades/órganos, accuracy .64045 y licencia ausente.
- `charlesniswander/fruit_freshness_demo`: accuracy .34831 y licencia ausente.
- `DavieObi/Fresh-vs-Rotten-Fruit-Classification-YOLOv8-`: sólo un `yolov8n-cls.pt` en árbol, sin un checkpoint afinado identificable; no asumir que el peso base publicado es el clasificador de frutas descrito.
- `diboworks/rotten_fruit_classifier`, `Senu-12/fruit-freshness-classifier`: pesos y Apache2 visibles, pero documentación insuficiente de etiquetas/evaluación para recomendar su calidad.
- `Aniket2003333333/fruit-veg-freshness-mobilenetv2` y copia `Piyu12/...`: Apache2, MobileNetV2 fresh/stale que incluye manzana; no publica métricas. Es una reserva ligera para ensayos, no evidencia de excelencia.

## Fuentes primarias reproducibles

- [API árbol AKASH](https://api.github.com/repos/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/git/trees/main?recursive=1), [informe](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/blob/main/classification.txt), [matriz](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/blob/main/model/fruit_quality/confusion_matrix.png), [muestras de manzanas](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/blob/main/model/fruit_quality/val_batch2_labels.jpg).
- [API archivos ausjahk](https://huggingface.co/api/models/ausjahk/fruits-fresh-rotten-from-scratch/tree/main), [config](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch/blob/main/config.json), [tarjeta](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch/blob/main/README.md).
- [API releases damasco](https://api.github.com/repos/amaniqbal-ai/apricot-disease-classification/releases), [config modelos](https://github.com/amaniqbal-ai/apricot-disease-classification/blob/main/src/config.py).
- [API licencia Ultralytics](https://api.github.com/repos/ultralytics/ultralytics).

El siguiente ensayo debe comparar por fruto físico y por huerto, incluir luz cambiante, movimiento/desenfoque, oclusión, frutos desconocidos y latencia. Seguir el mismo fruto entre fotogramas y exigir evidencia repetida antes de actuar son capacidades compartidas de la canalización, independientes de proveedor o cultivo. Esa evaluación aún no se realizó.
