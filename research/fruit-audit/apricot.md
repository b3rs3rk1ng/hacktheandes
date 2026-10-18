# Auditoría: damasco / albaricoque (apricot)

Fecha: 2026-10-17. Investigación documental; no se ejecutó inferencia ni se validaron imágenes peruanas.

**Conclusión: ningún candidato encontrado reúne todos los filtros solicitados.** Hay investigación seria de detección, pero no encontré pesos entrenados abiertos utilizables inmediatamente, validación independiente peruana y evidencia de un gran problema nacional específico del damasco que coincida con esas clases.

## Compatibilidad del robot

[Tevel, fabricante](https://www.tevel-tech.com/technology/) declara que sus Flying Autonomous Robots cosechan desde un albaricoque de 50 g hasta una manzana de 700 g. Esto respalda capacidad declarada de cosecha de damasco; no demuestra una tasa de éxito para retirar fruta enferma ni que hardware/control/software de Tevel sean open source. La página menciona detección de enfermedad, pero no publica matriz por enfermedad o evaluación peruana.

## Candidatos

### APNet / ATZD01 — candidato principal, descartado para conectar hoy

[Paper original, Plant Methods 2025](https://link.springer.com/article/10.1186/s13007-025-01324-5): detector de plagas y enfermedades en exteriores, no solo clasificación de fruto aislado. Incluye hojas, ramas, frutos e insectos; no todos los blancos corresponden a un fruto que deba retirarse. ATZD01 contiene 6.055 imágenes / 20.272 instancias, 11 categorías y partición aleatoria 80/10/10. No encontré evaluación externa peruana ni separación por huerto para el test.

Métricas publicadas del experimento principal: **precision 87,1%; recall 75,6%; mAP50–95 43,6%; 2,79 M parámetros; 8 GFLOPs**. El 87,1% que el resumen llama «accuracy» es precision en resultados/cuerpo; no debe presentarse como exactitud diagnóstica. K-fold: precision media 87,5%, recall 79,7%, F1 83,4%. Ninguno demuestra fiabilidad suficiente para retirar automáticamente fruta en Perú.

[Repositorio de autores](https://github.com/meanlang/ATZD01) revisado por árbol recursivo de la API GitHub: README, requirements, siete imágenes y módulos `APNet.yaml`, `bolck.py`, `head.py`. **No hay checkpoint `.pt`, `.pth` u `.onnx`; no hay releases; API de licencia devuelve 404.** El dataset requiere autorización y contraseña de descompresión; no equivale a pesos abiertos listos.

Clases declaradas: ácaros, bacterial shot hole, gomosis, sarna, brown rot, antracnosis, Carposina sasakii, Aromia bungii, Cnidocampa flavescens, Hyphantria cunea y el insecto beneficioso Chilocorus rubidus. No asumir presencia o importancia en Perú de este listado extranjero. Retirar fruta sería particularmente incoherente para una detección de insecto beneficioso, daño de hoja o gomosis de rama.

### YOLOR + MGC, imágenes UAV — pertinente técnicamente, sin pesos disponibles

[Publicación institucional de autores](https://research.uaeu.ac.ae/en/publications/leveraging-model-explainability-and-fine-grained-cutmix-augmentat/) y [manuscrito alojado por coautora](https://giuliademasi.weebly.com/uploads/4/4/1/7/4417618/leveraging_model_explainability_and_fine-grained_cutmix_augmentation_for_robust_detection_of_apricot_diseases_in_uav_images-compresso.pdf), DOI 10.1016/j.eswa.2025.128946, volumen 2026. Detecta frutos sanos, brown rot y shot hole en imágenes UAV. Tabla 5: precision **94,8%**, recall **79,0%**, mAP **91,6%**; no confundir mAP con accuracy ni mAP50–95. Tabla 4 reporta «mAP» por clase: healthy 96,3%, shot hole 85,8%, brown rot 92,6%. No validé en esta auditoría el umbral IoU exacto de esos mAP.

Los autores reconocen una sola localización. Datos: «Data will be made available on request». Sin enlace GitHub en el manuscrito ni pesos abiertos encontrados. No existe prueba local peruana aquí. Es evidencia de investigación pertinente, no una pieza instalable para esta noche.

### AgriVision-Apricot — dataset, no modelo

[Mendeley Data, agosto 2026](https://data.mendeley.com/datasets/5wk5wpzczw/1): conjunto para clasificación de patología/estrés; adquisición declarada a 10 cm–1 m con móviles. No ofrece en la descripción un checkpoint ejecutable con evaluación externa. No convertir disponibilidad de imágenes en disponibilidad de modelo fiable.

## Perú e impacto

La [lista oficial SENASA de hospederos de moscas de la fruta](https://www.senasa.gob.pe/senasa/wp-content/uploads/jer/DIR_CAU_NORSO/RD_510_2005.pdf) incluye damasco/albaricoque. Es evidencia de hospedero reconocido, **no** de incidencia actual, magnitud económica ni detectabilidad visual de larvas internas mediante RGB. Los modelos anteriores no tienen como clase mosca de la fruta.

Se localizó un [informe SENASA 2021](https://www.senasa.gob.pe/senasa/descargasarchivos/2021/09/INFORME.pdf) con pérdidas por cultivo 2017–2020, incluido damasco. No se extrajo ni verificó la tabla completa: no usar cifras del fragmento del buscador como estimación nacional actual.

No encontré en esta revisión acotada una fuente primaria que demuestre gran impacto nacional actual de brown rot/shot hole específicamente en damasco peruano. Las normas de importación, listas cuarentenarias o referencias a Chile **no prueban presencia en Perú**. Tampoco encontré un protocolo peruano que valide un circuito automático de detección RGB + retirada de damasco enfermo con este dron.

## Resultado de los filtros

| Filtro | Resultado |
|---|---|
| Fabricante incluye fruta entre capacidades | Sí, declaración Tevel |
| Modelo específico con métricas explícitas | Sí, papers APNet / YOLOR-MGC |
| Pesos abiertos y licencia clara, ejecutar ahora | No encontrados |
| Fiabilidad externa en Perú | No encontrada |
| Enfermedad detectada = gran problema damasco Perú | No demostrado |
| Retirada automática validada como control sanitario | No demostrada |

**No recomendar damasco como ganador para unir piezas esta noche.** Esto describe ausencia de evidencia suficiente en la búsqueda, no inexistencia universal de tecnología.
