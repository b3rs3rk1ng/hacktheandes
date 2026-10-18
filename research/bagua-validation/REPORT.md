# Prueba externa de clasificadores con imágenes del registro de Bagua

Fecha UTC: 2026-10-18T03:40:00.410682+00:00
Código externo revisado en commit `fc46338263d8ea208616f4f97fd0cf2884c493b3`. No se ejecutó código descargado del repositorio; solo arquitecturas estándar torchvision y carga de pesos mediante `torch.load(..., weights_only=True)`, estado estricto de tensores.

## Resultado

**Los checkpoints ejecutan rápido, pero no son un detector de moniliasis listo para aplicar a esta muestra peruana.** El registro de Bagua aporta datos; no encontré pesos ni código de los autores en su registro ni en la búsqueda pública realizada. Por eso se evaluaron tres clasificadores externos publicados por Unclefee.

El registro Figshare apunta únicamente a una carpeta pública de Drive. Se tomaron las primeras 50 imágenes públicamente listadas por cada subcarpeta (100 archivos). Son **73 imágenes únicas por SHA-256: 50 etiquetadas enfermas y 23 sanas**. No es muestreo aleatorio de todo el dataset: el listado inicial está limitado y puede haber más archivos. El primer ensayo aleatorio de 25/carpetas se amplió a todo ese listado para no confundir duplicados con muestras adicionales; resultados finales debajo.

Integridad: **cero hashes SHA-256 compartidos entre etiquetas sanas y enfermas**. El evaluador rechaza conflictos de etiqueta para un mismo archivo. En el ensayo inicial, 50 archivos (25/clase) eran 42 imágenes únicas en total: 25 enfermas + 17 sanas. En la ampliación, 100 archivos (50/clase) son 73 únicas en total: 50 enfermas + 23 sanas. No se pasó de 42 sanas a 23 sanas.

No hubo entrenamiento, ajuste de umbrales ni elección de fotos según aciertos. Preprocesado del autor: RGB, resize directo 224×224, normalización ImageNet; aquí foto completa, porque no hay cajas revisadas en las carpetas Bagua. El entrenamiento externo utiliza recortes de mazorca basados en etiquetas YOLO, por lo que existe cambio de distribución.

## Moniliasis explícita: top-1 clase 3 frente a las etiquetas de carpeta

| Modelo | Enfermas reconocidas como monilia | Sanas marcadas monilia | Sensibilidad aparente | Especificidad aparente | GPU forward |
|---|---:|---:|---:|---:|---:|
| MobileNetV3-Small | 7/50 | 1/23 | 14.0% | 95.7% | 1.26 ms |
| EfficientNet-B0 | 13/50 | 0/23 | 26.0% | 100.0% | 1.95 ms |
| ResNet50 | 13/50 | 5/23 | 26.0% | 78.3% | 2.59 ms |

Filas reales y columnas predichas [negativa, monilia], deduplicadas:
- MobileNetV3-Small: `[[22, 1], [43, 7]]`.
- EfficientNet-B0: `[[23, 0], [37, 13]]`.
- ResNet50: `[[18, 5], [37, 13]]`.

EfficientNet-B0: de las 50 fotos etiquetadas enfermas, predijo 9 sanas, 13 Carmenta, 9 escoba de bruja, 13 monilia y 6 Phytophthora. De las 23 sanas únicas, predijo 17 sanas y 6 escoba de bruja. **37/50 no fueron reconocidas como monilia**; no son todas omisiones de enfermedad, pues algunas se clasificaron como otra afección.

## Si agrupamos cualquier enfermedad

| Modelo | Sensibilidad aparente | Especificidad aparente | Exactitud binaria |
|---|---:|---:|---:|
| MobileNetV3-Small | 82.0% | 69.6% | 78.1% |
| EfficientNet-B0 | 82.0% | 73.9% | 79.5% |
| ResNet50 | 72.0% | 56.5% | 67.1% |

Agrupar enfermedades no equivale a identificar moniliasis ni autoriza retirar frutos automáticamente.

## GPU y latencia

Ejecutado vía SSH en laptop Linux Mint, RTX 4060 Laptop 8 GB; torch 2.11.0+cu130 y torchvision 0.26.0+cu130. Venv aislado lee paquetes ya instalados de otro entorno sin modificarlos. Se usaron 2 hilos CPU, batch 1 y modo inference; 10 warmups + 100 forwards CUDA sincronizados para la media del modelo. No se detuvieron servicios/procesos ajenos.
- MobileNetV3-Small: mediana de decodificar JPG + transformar + inferir + transferir resultado **47.4 ms** por foto. Latencia no incluye captura, red, detección de objetos ni robótica.
- EfficientNet-B0: mediana de decodificar JPG + transformar + inferir + transferir resultado **38.2 ms** por foto. Latencia no incluye captura, red, detección de objetos ni robótica.
- ResNet50: mediana de decodificar JPG + transformar + inferir + transferir resultado **39.4 ms** por foto. Latencia no incluye captura, red, detección de objetos ni robótica.

## Límites que impiden venderlo como validación de campo

- Etiquetas «sanos/enfermos» tomadas de carpetas públicas; no verificación fitopatológica independiente ni información por muestra sobre quién diagnosticó. Las métricas de monilia suponen que «enfermos» significa moniliasis, por el título del registro; esa equivalencia no se pudo confirmar individualmente.
- Al revisar el mosaico, muchas enfermas son rojas y muchas sanas verdes; diferentes resoluciones, fondos y estilos de captura. Puede haber sesgos de color/variedad/cámara. No se puede concluir enfermedad mirando solo el color ni reetiqueté muestras.
- Hay duplicados exactos y fotos muy parecidas de una misma mazorca/sitio. Deduplicar bytes no prueba independencia por planta/sesión. Las métricas no tienen garantía de generalizar a otras parcelas.
- Los checkpoints externos anuncian 87% de exactitud en sus propios datos; eso no se traslada a esta muestra. No se verificó solapamiento con su dataset de entrenamiento.
- Las imágenes son mayormente acercamientos a mazorcas; no son vistas aéreas ni un benchmark de visión entre ramas. Este sistema clasifica una imagen; no localiza instancias, tallitos, posición 3D, enfermedad invisible, trayectorias o cortes.
- No hallé pesos del estudio YOLOv8 de Bagua; no afirmo que no existan en otro lugar. Su DOI enlaza datos, no una solución publicada lista para unir.

## Reproducción

Archivos locales: `manifest-visible.json`, `manifest-selected.json`, `manifest-downloaded.json` (IDs, etiquetas, SHA-256), `download.py`, `evaluate.py`, `results.json`, `duplicate-groups.json`, y mosaico completo EfficientNet-B0. Los 100 JPG y pesos descargados están en `/home/f3mt0/hacktheandes-bagua-validation/`, sin tocar app ni simulador.

En laptop: ejecutar `.venv/bin/python download.py` y `.venv/bin/python evaluate.py`. `results.json` contiene también todas las predicciones y matrices de 100 archivos antes de deduplicar.

## Fuentes

- Dataset Bagua, CC BY 4.0: https://doi.org/10.6084/m9.figshare.32178402.v1
- Metadatos oficiales: https://api.figshare.com/v2/articles/32178402
- Modelos externos y metodología MIT: https://github.com/Unclefee/Cocoa-Pod-Disease-Detection
- Checkpoints: https://github.com/Unclefee/Cocoa-Pod-Disease-Detection/releases/tag/v1.0
