# Acceso al dataset sin descargarlo entero

Consulta del 18 de octubre de 2026. No se inició una descarga grande ni se operó sobre laptop.

## Tamaño real del ZIP de origen

Según el directorio ZIP ya recuperado por la auditoría:

- ZIP completo: 6,187,303,002 bytes.
- RGB originales: 1,950 archivos, 6,121,457,049 bytes comprimidos (98.94% del ZIP).
- RGB sin comprimir: 6,207,774,785 bytes.
- Reparto: h0 646 imágenes/2,345,814,397 bytes; m1 436/1,265,265,718; m2 401/1,151,725,800; m3 467/1,358,651,134.

Descargar sólo RGB por rangos no representa un ahorro material. Puede servir para un subconjunto preliminar, pero no para acelerar una evaluación de todo el dataset.

## Mirror de Hugging Face

https://huggingface.co/datasets/Project-AgML/cocoa_monilia_detection

La organización Project-AgML reformateó CocoaMoniliaDataSet. Contiene 1,950 imágenes en cinco archivos Parquet que suman 2,667,825,999 bytes. El árbol de archivos y tamaños está en `hf-tree.json`.

Las etiquetas del mirror contienen cinco categorías numéricas. La documentación original resume cuatro categorías pero la auditoría encontró una quinta categoría en sus propios COCO. No se debe colapsar o desplazar categorías sin resolver esta discrepancia.

El formato Parquet incluye image (bytes/path), objects (bbox/categories) y treatment. Verificar nombres y dimensiones al compararlo con las anotaciones originales; no atribuir identidad bit a bit al JPEG sin compararlo.

## Prueba de velocidad en Mac

Se solicitaron únicamente los primeros 3 MiB por HTTP Range de cada origen en paralelo. Resultados en `speed.json`:

- Zenodo: HTTP 206, 27.16 segundos, 0.116 MB/s.
- HF: HTTP 206, 3.60 segundos, 0.874 MB/s.

Es una prueba pequeña incluyendo conexión/redirecciones. No prueba la velocidad sostenida en laptop. Conviene probar allí un shard antes de sustituir una descarga ya iniciada.

El endpoint S3 legado de AgML para este dataset devuelve HTTP 403; no es alternativa disponible.

## Estrategia sugerida

Usar los cinco Parquet del mirror en paralelo, verificando cada archivo por su SHA256 de LFS. Extraer con PyArrow conservando path y dimensiones, y contrastar etiquetas/clases con COCO. Descargar sólo imágenes selectas por rangos es una opción para una muestra pequeña, pero no acelera el total de originales.

## Downloader implementado

`fetch_parquet.py` usa la API pública del Hub para resolver un commit inmutable, enumera Parquet, descarga rangos concurrentes con reintentos, conserva partes para reanudar y valida SHA256 de cada shard. No requiere paquetes adicionales para descargar. La extracción requiere `pyarrow` y `Pillow`.

```sh
python fetch_parquet.py --repo Project-AgML/cocoa_monilia_detection --revision main --output /ruta/dataset --workers 16 --chunk-mib 32
```

Por defecto preserva los bytes de imagen incrustados y escribe imágenes con nombres consecutivos (`images/00000000.jpg`). `rows.jsonl` conserva `row_idx`, `image` (ruta absoluta), `source_path`, dimensiones originales, SHA256 y los metadatos de la fila; los campos escalares, como `treatment`, también aparecen arriba. No aplica etiquetas HF.

`--max-side 1280` activa una copia redimensionada y registra sus escalas. No se activó para la descarga propuesta: hay que comprobar primero la geometría contra COCO. `--download-only` y `--extract-only` separan ambas fases. `--coco prefijo=archivo.json` permite contrastes opcionales y `--require-coco-match` exige correspondencia inequívoca y dimensiones iguales.

Verificado: compilación Python, manifiesto remoto con cinco shards/2.668 GB, descarga real de un rango HF de 16 KiB que no comienza en cero y reanudación de ese rango. Un Parquet sintético comprobó extracción, metadatos, nombres por fila, correspondencia COCO exacta y resize opcional de 80×40 a 32×16. No se descargó ningún shard completo en Mac.
