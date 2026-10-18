# Opciones gratuitas: modelos y límites

Verificación adicional 18 de octubre de 2026. Se consultaron fuentes primarias y APIs y se inspeccionaron artefactos pequeños sin ejecutar modelos. Descargar gratuitamente no acredita precisión en un huerto ni un uso industrial documentado. La ejecución local consume recursos del propio equipo, sin exigir una API de inferencia de pago para los checkpoints públicos listados.

| Opción | Qué permite probar | Acceso y licencia publicados | Evidencia de vuelo |
|---|---|---|---|
| [FruitNet](https://github.com/OleksandrKlanovets/fruitnet) | Clasifica recortes de manzana fresca/podrida; no localiza ni diagnostica patógeno. | H5 9.43 MB descargado y verificado; proyecto MIT. | No encontrada. |
| [ausjahk ResNet18](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch) | Clasifica manzana fresca/podrida, junto con otras frutas. | Safetensors 44.77 MB descargado y verificado; ficha Apache-2.0. | No encontrada. |
| [AKASH YOLOv8n](https://github.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning) | Localiza y distingue `good apple` / `bad apple` en imágenes. No identifica la enfermedad causal. | PT 6.21 MB y ONNX 12.14 MB descargados; el export ONNX declara AGPL-3.0. MIT del código propio no sustituye esa licencia del modelo. | No encontrada; validación de fruta retirada. |
| [Apricot disease classification](https://github.com/amaniqbal-ai/apricot-disease-classification) | Clasificación que incluye podredumbre parda de damasco y otras condiciones/órganos. | Proyecto MIT y checkpoints en releases gratuitos. MobileNet de 6.24 MB extraído por rangos del ZIP público, CRC correcto; no se ejecutó. | No encontrada; su 79.9% declarado es agregado, no sensibilidad por fruto en vuelo. |
| [AgML YOLO11n APPLEDRONE](https://github.com/Project-AgML/AgML) | **Solo localizar manzanas**, sin clasificar enfermedad. | [ZIP público](https://agdata-data.s3.us-west-1.amazonaws.com/models/detector/apple_detection_drone_brazil%2Byolo11n.zip) 4.9 MB; contiene `best.pt` 5.49 MB. AgML Apache-2.0, Ultralytics AGPL-3.0, sin licencia separada de pesos en ZIP. | Dataset real de [DJI Phantom 4 Pro](https://arxiv.org/html/2110.12331v1). No demuestra que el checkpoint posterior se ejecutara a bordo ni uso industrial. |

## Qué se puede concluir

Sí hay piezas gratuitas para experimentar. Para clasificación sencilla de deterioro de manzana, FruitNet tiene pesos, código y orden de clases; para localizar y clasificar estado visual en una sola pasada, AKASH es candidato gratuito bajo AGPL-3.0. Para una enfermedad con nombre concreto, el proyecto de damasco aporta una etiqueta pertinente, aunque mezcla órganos y tiene desempeño más modesto.

AgML aporta una pieza más próxima a las condiciones de captura aérea. Su mAP50 89.57% y recall 82.26% provienen del `results.json` del modelo y miden **localización de manzanas**; no calidad sanitaria. Combinarlo con un clasificador de frescura sería un experimento por validar, no un sistema de enfermedad listo ni evidencia de uso industrial.

Ninguno de estos recursos tiene aquí demostrados conjuntamente: diagnóstico fiable del fruto en árbol, modelo abierto y gratuito, ejecución en dron real y operación industrial habitual. No se califica como excelente ningún modelo basándose solo en su cifra publicada.

## Roboflow: otra vía con nivel gratuito

[Roboflow](https://roboflow.com/pricing) ofrece actualmente plan de $0 con créditos limitados e inferencia local incluida. Hay modelos entrenados como [manzana fresca/podrida de Ammar Azahar](https://universe.roboflow.com/ammar-azahar-fzejn/detect-apple-fresh-and-rotten) y [Apple-Disease-Detection de PFE](https://universe.roboflow.com/pfe-o6ixg/apple-disease-detection-fqwzp/model/2). Requieren cuenta/API key; no se verificó la descarga efectiva de sus pesos en esta sesión. La licencia CC BY de un dataset no sustituye la licencia del modelo. No hay prueba de vuelo/industria de estos modelos y el banner de API genérica no debe confundirse con el checkpoint especializado.

## Evidencia detallada

- [Revisión de pesos](weights-review.md).
- [Revisión de recursos UAV](uav-review.md).
- Para Roboflow, las condiciones y modelos se enlazan en la sección anterior; no se descargaron sus pesos.

Los pesos descargados se conservan localmente e ignoran en Git. No se ejecutó inferencia ni se alteró el simulador.
