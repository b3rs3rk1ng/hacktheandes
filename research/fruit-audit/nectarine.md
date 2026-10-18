# Auditoría: nectarina

Revisión: 2026-10-17. Investigación documental; sin descargar pesos, ejecutar ni entrenar modelos. **Resultado: no apto para integrar hoy bajo los requisitos solicitados.** No se encontró un paquete abierto de pesos + código + licencia + prueba independiente en nectarina peruana. Esto no demuestra que no exista; delimita la búsqueda realizada.

## Candidatos comprobados

| Candidato | Qué identifica y datos | Métricas publicadas | Disponibilidad y objeción decisiva |
|---|---|---|---|
| [DCTNet, Zhang et al., Complex & Intelligent Systems 2025](https://link.springer.com/article/10.1007/s40747-024-01749-w) | Enfermedades del fruto en huerto chino; imágenes con dron, mayo–septiembre 2023. La mezcla de variedades incluye explícitamente nectarina. Clases: sarna, podredumbre parda, antracnosis, cancro bacteriano, normal. | AP50 95.57%; F1 0.91. No confundir AP50 con accuracy ni con AP50–95. No hay resultado separado para nectarina ni prueba peruana verificados. | El artículo declara datos por solicitud al autor y «Code Availability: Not applicable». No encontramos pesos enlazados. No permite ensamblar y correr directamente. La licencia abierta del artículo no constituye licencia del modelo. |
| [GIA-YOLO, Ren et al., Agronomy 2025](https://www.mdpi.com/2073-4395/15/8/1934) | Localiza frutos de nectarina, una clase «Nectarine»; **no reconoce enfermedades**. 3234 imágenes de smartphone a 20–50 cm, variedad Zhongyou 4, instalación de cultivo en Shandong, China. Split interno 7:2:1. | Precision 93.9%, recall 88.9%, mAP 96.2%; 5 MB, 73 fps reportados en equipo del estudio. No identificamos el umbral IoU del mAP en el extracto consultado: no etiquetar 96.2% como mAP50–95 ni como fiabilidad sanitaria. | No encontramos repositorio/pesos ejecutables de autores. Aunque existieran, este modelo serviría para localizar fruta, no para decidir qué fruta enferma retirar. Sin validación peruana ni despliegue en el dron concreto. |

La búsqueda GitHub API de repositorios con `nectarine disease`, `nectarine detection` y `DCTnet peach` devolvió cero resultados. `GIA-YOLO` devolvió coincidencias no relacionadas; esto es cobertura de búsqueda, no prueba de inexistencia universal. No se sustituyeron modelos de hoja/durazno por modelos de fruto/nectarina.

## Problema sanitario en Perú

- La evidencia primaria hallada sobre nectarinas es principalmente de **importación y cuarentena**, no una estimación de pérdidas en nectarinales peruanos. [SENASA, 12 abril 2024](https://www.gob.pe/institucion/senasa/noticias/936097-peru-suspende-importacion-de-carozos-y-manzana-de-chile) describe riesgo de **ingreso** de Grapholita molesta. No usar esa noticia como prueba de plaga ya extendida en el Perú.
- El [plan SAG–SENASA de carozos Chile→Perú](https://www.sag.gob.cl/sites/default/files/PT%20Carozos%20Peru.pdf) incluye nectarina y enumera Monilinia laxa y Cydia molesta entre plagas reguladas. Nuevamente, una lista cuarentenaria no demuestra prevalencia nacional.
- [Resolución SENASA 002-2025](https://www.gob.pe/institucion/senasa/normas-legales/6410164-002-2025-midagri-senasa-dsv): requisitos de importación actualizados. No presentar la suspensión de 2024 como estado actual del comercio.
- No verificamos una fuente primaria que cuantifique un **gran problema de enfermedades del fruto de nectarina producida en Perú**, ni un manejo peruano específico que justifique la selección visual y retiro con este dron. No trasladar números de durazno, toda la fruta o toda Monilinia a nectarina.

## Decisión

**Descartar nectarina para la promesa «modelo abierto listo + plaga importante Perú + retiro autónomo».** DCTNet es un antecedente científicamente relevante y GIA-YOLO un localizador de fruta; ninguno satisface la combinación exigida. Ni la GPU ni el tamaño del modelo resuelven la falta de pesos comprobados, diagnóstico por fruto y validación externa.

Para reabrir: conseguir pesos y permisos verificables, evaluar un test independiente de frutos peruanos con sensibilidad/especificidad por enfermedad, validar que el retiro sea manejo agronómico correcto y demostrar alcance/agarre del dron en ese huerto. No existe garantía razonable de «ninguna objeción del jurado».
