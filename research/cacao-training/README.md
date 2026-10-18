# Cacao: entrenamiento y evaluación reproducibles

Trabajo en la laptop por SSH, aislado en `/home/f3mt0/hacktheandes-cacao-training`.
El reporte de resultados se entrega en `REPORT.md` después de finalizar la evaluación.

## Datos y alcance

- Original: [CocoaMoniliaDataSet v2](https://zenodo.org/records/17716661), CC BY 4.0.
- [Artículo de los autores](https://pmc.ncbi.nlm.nih.gov/articles/PMC12834835/) y [repositorio](https://github.com/joanfco30/CocoaMoniliaDataSet).
- Imágenes obtenidas del [espejo AgML](https://huggingface.co/datasets/Project-AgML/cocoa_monilia_detection), revisión fijada en `config.json`; SHA256 de cada Parquet verificado. Se usan las **anotaciones COCO originales**, no las cajas convertidas del espejo.
- Cuatro clases: `h0` sin síntomas anotados, `m1` abultamientos, `m2` manchas pardas/aceitosas, `m3` esporulación. Esto no certifica ausencia de infección latente ni diagnóstico de laboratorio.

La preparación aplica orientación EXIF, exige dimensiones compatibles, combina duplicados exactos con sus anotaciones y excluye imágenes completas con categorías no documentadas o cajas contradictorias. Las categorías se leen de cada anotación, nunca se deducen del directorio. Agrupa días inferidos de nombres y vecinos por hash perceptual antes de dividir en entrenamiento/validación/prueba. No hay IDs de finca o árbol que garanticen independencia física.

## Repetir

Ejecutar dentro del entorno aislado de la laptop, con `torch`, `ultralytics`, `pyarrow`, `Pillow`, `numpy`, `scipy` y `PyYAML` instalados. Las versiones usadas se guardan en `runs/environment.json` y `runs/pip-freeze.txt`. El directorio de preparación debe ser nuevo o vacío.

```bash
python fetch_parquet.py --repo Project-AgML/cocoa_monilia_detection \
  --revision 07aeef939a7009fc13202a812185607772759f2d \
  --output downloads/agml --workers 12 --chunk-mib 16

python prepare_dataset.py --config config.json \
  --rows downloads/agml/rows.jsonl \
  --zip-index dataset-audit/zip_directory.json --output data/grouped-v1

python train_detector.py --config config.json \
  --data data/grouped-v1/data.yaml --output runs

python evaluate_detector.py --weights runs/baseline/weights/best.pt \
  --data data/grouped-v1/data.yaml --manifest data/grouped-v1/manifest.json \
  --output evaluation-v2 --device 0
```

La prueba externa se mantiene enteramente fuera del entrenamiento. Descargar su ZIP original de Kaggle versión 2 (URL documentada en `external-review/README.md`) en `downloads/external-cocoa-yolov4.zip` y ejecutar:

```bash
python external-review/yolo_to_manifest.py \
  --zip downloads/external-cocoa-yolov4.zip --output data/external-v2 \
  --mapping external-review/class_mapping.json --max-side 1280 \
  --box-tolerance 0.000001

python evaluate_transfer.py --weights runs/baseline/weights/best.pt \
  --manifest data/external-v2/manifest.json \
  --internal-report evaluation-v2/evaluation.json \
  --internal-manifest data/grouped-v1/manifest.json \
  --config external-review/transfer_config.json \
  --output external-evaluation --device 0
```

El adaptador registra los ajustes diminutos por redondeo; fuera de la tolerancia rechaza la imagen completa. La transferencia verifica que pesos y manifest interno coincidan con el informe que congeló el umbral.

El script de descarga local está en `download-review/fetch_parquet.py`; en la laptop se copia al directorio principal. Los COCO originales están en `dataset-audit/`.

El checkpoint se elige por validación. El umbral operativo se elige únicamente en validación, buscando F1 con precisión de síntomas ≥90% si es posible; se congela para prueba. Se reportan mAP, errores por mazorca, detección temprana y falsas acciones en sanas. La latencia batch 1 incluye decodificación, preprocesado, inferencia, NMS y copia de cajas a CPU, con sincronización CUDA.

Las pruebas de blur horizontal, brillo y resolución son alteraciones sintéticas del test. **No son vuelos reales**, ni verifican agarre, corte, navegación, control sanitario o ahorro económico. YOLO/Ultralytics usa licencia AGPL-3.0 salvo licencia comercial alternativa; consultar sus condiciones al distribuir el sistema.
