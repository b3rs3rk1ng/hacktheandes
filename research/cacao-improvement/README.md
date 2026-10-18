# Cacao: segunda ronda de entrenamiento y evaluación

Este experimento busca reducir falsas alarmas de moniliasis al distinguir **sano, Monilia y Phytophthora**, incorporar movimiento simulado y comprobar la transferencia a fotografías nuevas. Compara el detector YOLO11s solo y combinado con un clasificador de recortes EfficientNet-B0, frente al YOLO11n anterior.

La selección del candidato y sus umbrales usa únicamente validación de desarrollo. El objetivo configurado es precisión ≥95%, con recall mínimo 50% y al menos 20 alertas; **son criterios de selección, no resultados alcanzados**. El selector registra si necesita aplicar una alternativa cuando esos requisitos no se cumplen.

Los resultados finales, exclusiones y decisión están documentados en [REPORT.md](REPORT.md). El protocolo está en [run_plan.json](run_plan.json) y [METHODOLOGY.md](METHODOLOGY.md).

## Datos y funciones

| Fuente | Uso en esta ronda | Licencia publicada |
|---|---|---|
| [CocoaMoniliaDataSet](https://zenodo.org/records/17716661) | Conserva train/val; el test anterior queda protegido como regresión. `h0`→sano; `m1/m2/m3`→Monilia. | CC BY 4.0 |
| [Serrano/Torres, versión 2](https://www.kaggle.com/datasets/serranosebas/enfermedades-cacao-yolov4) | Sus 312 fotos y etiquetas por objeto pasan a **desarrollo**; ya se habían inspeccionado como test. Se mantiene Phytophthora como clase distinta. | Base: ODbL; contenido: © autores originales. No sustituir por la licencia de un mirror. |
| [Mendeley ykbtpsyfv9 v1](https://data.mendeley.com/datasets/ykbtpsyfv9/1) | **Sólo prueba externa por imagen**: muestra congelada de 200 sanas + 200 Monilia. Toda la colección queda fuera del entrenamiento y ajuste de umbrales. | CC BY 4.0 |

El constructor agrupa imágenes por identidad de píxeles, pHash y grupos previos; protege regresión y registra conflictos/exclusiones. Las variantes de luz y desenfoque se generan exclusivamente para train. Los recortes ROI conservan clase, grupo y procedencia; entrenamiento e inferencia comparten su contrato geométrico.

La muestra Mendeley usa semilla **20261019**, escogida sobre el índice completo antes de inferencia. Cada foto conserva header/CRC32 comprobados y SHA256/pHash calculados, con orientación EXIF normalizada; **no se verificó el SHA256 de los RAR completos**. [Plan y evidencia de muestreo](source-review/SAMPLED_HOLDOUT.md).

## Entorno y rutas reales

La GPU se utiliza en el equipo accesible mediante `ssh laptop`:

```sh
ssh laptop
cd /home/f3mt0/hacktheandes-cacao-improvement
export PYTHONPATH=/home/f3mt0/hacktheandes-cacao-training
export OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=2
export YOLO_CONFIG_DIR=/home/f3mt0/hacktheandes-cacao-improvement/.yolo
```

Se presupone el entorno `.venv` preparado con PyTorch/CUDA, torchvision, Ultralytics y las dependencias de los scripts. Los manifiestos de origen deben existir en el directorio hermano `hacktheandes-cacao-training/data/`; sus rutas se declaran en [mixed_config.json](mixed_config.json). Las fotos no se distribuyen dentro del código.

## Reproducir preparación y entrenamiento

Construir `mixed-v2` con la configuración declarativa y los helpers existentes:

```sh
.venv/bin/python build_mixed_dataset.py \
  --config mixed_config.json --output data/mixed-v2 \
  --helpers /home/f3mt0/hacktheandes-cacao-training/prepare_dataset.py
```

Se exportan `disease/data.yaml`, `disease/manifest.json` y `roi/manifest.json`, junto con la auditoría. El nombre `mixed-v2` corresponde al directorio de esta ejecución; la configuración determina el contenido.

Entrenar el detector con el entrenador heredado:

```sh
.venv/bin/python /home/f3mt0/hacktheandes-cacao-training/train_detector.py \
  --config training_config.json --data data/mixed-v2/disease/data.yaml \
  --output runs/detector
```

En otra terminal del mismo entorno puede iniciarse el clasificador mientras termina el detector. `--wait-for` permite preparar recortes en CPU y reserva su uso de GPU hasta encontrar el marcador del detector:

```sh
.venv/bin/python train_classifier.py \
  --config classifier_config.json --manifest data/mixed-v2/roi/manifest.json \
  --output runs/classifier --wait-for runs/detector/training_complete.json
```

El detector deja `runs/detector/baseline/weights/best.pt`; el clasificador, `runs/classifier/best.pt`, `metadata.json` y `complete.json`. Sus configuraciones fijan semillas, arquitectura, aumentos y selección por validación. Para repetir una corrida, usa destinos nuevos y actualiza sus rutas en la configuración del benchmark.

## Evaluación reproducible

Las 400 fotos nuevas y su manifiesto portable deben estar en `data/mendeley-sample/`; `benchmark_config.json` apunta a `manifest-laptop.json`. Si cambias de máquina, [rebase_manifest.py](rebase_manifest.py) adapta sólo los campos de ruta indicados, preservando IDs, etiquetas y procedencia.

```sh
.venv/bin/python run_benchmark.py --config benchmark_config.json --dry-run
.venv/bin/python run_benchmark.py --config benchmark_config.json
```

El ejecutor espera los marcadores de ambos entrenamientos, calibra con validación, congela la selección y compara el candidato elegido con la referencia anterior. **No usa el nuevo test para escoger modelo ni umbral.** Comprueba solapamientos de fuente antes de evaluar y conserva exclusiones, hashes y configuración en `runs/benchmark-v1/`.

El benchmark separa detección sobre regresión y alertas binarias sobre fotografías Mendeley. Aplica `clean`, `motion_blur_11` y `motion_blur_21` con la política congelada. Los indicadores por objeto y por imagen no son intercambiables.

## Límites que acompañan cualquier resultado

- «Sano» significa sin síntomas anotados; una cámara RGB no descarta infección latente ni confirma un diagnóstico de laboratorio.
- Serrano ahora es desarrollo; sus resultados y la regresión anterior no constituyen una nueva prueba independiente.
- Mendeley carece de cajas. Hay muestras enfermas recogidas sobre **tela negra** y sanas en **árboles**: el fondo puede confundir la evaluación. Sus 400 fotos tampoco equivalen a 400 mazorcas o fincas independientes.
- Los grupos de fechas/pHash aproximan dependencia entre imágenes; no acreditan identidad de árbol o parcela. El balance 200/200 no estima prevalencia real.
- El desenfoque es sintético. No hay validación con cámara volando, seguimiento temporal, distancia real, vuelo autónomo ni retirada segura del fruto.
- Un resultado de clasificación no demuestra ahorro económico, uso industrial cotidiano ni que retirar una fruta sea la mejor intervención agronómica.

Las condiciones de distribución de bibliotecas, pesos iniciales y datos se conservan por separado; no se hereda automáticamente la licencia del código para todos los artefactos. La revisión de alternativas públicas está en [source-review/](source-review/).
