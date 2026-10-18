# Hack the Andes

Repositorio del proyecto: aplicación Onda, análisis visual de cacao, entrenamiento y evaluación de modelos, y simulación de inspección y manipulación.

## Componentes

- [Aplicación Onda](app/README.md): avisos locales por audio, receptor web e integración iOS.
- [Simulación](simulator/README.md) y [chacra virtual](simulator/ORCHARD.md): escenarios, vehículos, control, visión y evidencia de pruebas.
- [Entrenamiento base de cacao](research/cacao-training/README.md): preparación de datos, detector de moniliasis y evaluación.
- [Mejora del detector y clasificador](research/cacao-improvement/README.md): protocolo, entrenamiento, benchmark, modelos y resultados.
- [Pesos externos: enlaces de descarga](research/model-discovery/free-options/DOWNLOADS.md).
- [Búsqueda de modelos](research/model-discovery/README.md), [validación Bagua](research/bagua-validation/REPORT.md), auditorías y fuentes en `research/`.
- [Fuentes del proyecto](docs/FUENTES.md) y presentaciones en `output/`.

## Ejecutar la aplicación

Requiere Node.js 22 o posterior.

```sh
cd app
npm ci
npm test
npm run build
npm run validate
npm run dev
```

Para el simulador y el entrenamiento, seguir sus README: requieren dependencias y recursos adicionales. Algunas configuraciones y evidencias conservan rutas del equipo usado originalmente; deben adaptarse al entorno de ejecución. Los datasets completos se descargan desde las fuentes documentadas.

## Qué se conserva en Git

Se incluyen código, configuraciones, lockfiles, documentación, resultados y evidencias de evaluación, recursos gráficos de la simulación, modelos entrenados seleccionados con sus fichas, y presentaciones.

Se excluyen credenciales y tokens, perfiles de navegador, entornos y dependencias instaladas, compilaciones y cachés, descargas masivas de datasets, pesos externos descargados durante la búsqueda, copias de fotos originales, capturas HTML de páginas externas y material temporal. También se excluyen documentos de autorización con datos personales. Estas exclusiones sólo afectan a Git; los archivos locales se conservan. La política está en `.gitignore` y en los `.gitignore` de cada componente.

Los datos, bibliotecas, modelos y recursos de terceros conservan sus propias condiciones de uso; consultar las fichas, atribuciones y reportes. Los resultados son de investigación y simulación: no acreditan diagnóstico de laboratorio, vuelo real ni retirada autónoma segura de frutos.

## Historial y automatización

Se conserva el historial previo de la aplicación; el commit de integración mueve su contenido a `app/` y agrega los demás componentes. No se incorporan workflows de GitHub Actions. Cualquier workflow futuro debe usar exclusivamente runners propios (`self-hosted`).
