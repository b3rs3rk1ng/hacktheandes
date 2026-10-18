# Descarga de pesos externos

Los binarios externos no se incluyen en Git. Estos enlaces provienen de los manifiestos de las descargas verificadas el 18 de octubre de 2026; las revisiones se conservan cuando están disponibles. No se volvieron a descargar para esta publicación.

| Archivo | Descarga | Condiciones documentadas |
|---|---|---|
| `fruitnet_mobilenetv2.h5` | [Descargar](https://raw.githubusercontent.com/OleksandrKlanovets/fruitnet/42f9d4f39cc6caf3ef84d42eb95dd842c99662f1/config/fruit_classifier_v3_transfer_learning.h5) | MIT del repositorio |
| `akash_best.pt` | [Descargar](https://raw.githubusercontent.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/2c9ab8de378b9a196c71bd42cef60649b434902f/model/fruit_quality/weights/best.pt) | AGPL-3.0 (modelo Ultralytics) |
| `akash_best.onnx` | [Descargar](https://raw.githubusercontent.com/AKASH-ALAM/Fruit_Quality_Detection_Using_Deep_Learning/2c9ab8de378b9a196c71bd42cef60649b434902f/model/fruit_quality/weights/best.onnx) | AGPL-3.0 (modelo Ultralytics) |
| `ausjahk_model.safetensors` | [Descargar](https://huggingface.co/ausjahk/fruits-fresh-rotten-from-scratch/resolve/0cd3827f4a5e38be308680cb26e9730a7169984f/model.safetensors) | Apache-2.0 de la ficha |
| `apricot_mobilenetv3_small.pt` | [ZIP del release](https://github.com/amaniqbal-ai/apricot-disease-classification/releases/download/v1.0/finetuned.zip) (extraer `finetuned/apricot_disease_model.pt`; ZIP de ~844 MB) | MIT del repositorio; consultar avisos del autor |
| AgML YOLO11n APPLEDRONE | [ZIP público](https://agdata-data.s3.us-west-1.amazonaws.com/models/detector/apple_detection_drone_brazil%2Byolo11n.zip) (extraer `best.pt`) | AgML Apache-2.0; Ultralytics AGPL-3.0; sin aviso separado de pesos en el ZIP |

Los tamaños y SHA-256 de los cuatro primeros archivos están en [download-manifest.json](weights/download-manifest.json); el modelo de damasco conserva su [manifiesto](weights/apricot-download-manifest.json). Ver [revisión de pesos](weights-review.md) y [revisión UAV](uav-review.md) para procedencia, métricas y límites.

Los tres modelos entrenados para este proyecto sí están en `research/cacao-training/artifacts/` y `research/cacao-improvement/artifacts/`, con sus fichas.
