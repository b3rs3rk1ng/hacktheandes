# Materiales y procedencia

- Corteza: **Bark Brown 01**, Poly Haven, CC0. https://polyhaven.com/a/bark_brown_01
  - `bark-color.jpg`: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_01/bark_brown_01_diff_1k.jpg`
  - `bark-normal.jpg`: mapa `bark_brown_01_nor_gl_1k.jpg` de la misma colección.
- Suelo: **Forest Leaves 02**, Poly Haven, CC0. https://polyhaven.com/a/forest_leaves_02
  - `ground-color.jpg`: `forest_leaves_02_diffuse_1k.jpg`.
  - `ground-normal.jpg`: `forest_leaves_02_nor_gl_1k.jpg`.
- Suelo activo del huerto: **Leaves Forest Ground**, Poly Haven, CC0. https://polyhaven.com/a/leaves_forest_ground
  - `leaf-litter-color.jpg`: `leaves_forest_ground_diff_1k.jpg`.
  - `leaf-litter-normal.jpg`: `leaves_forest_ground_nor_gl_1k.jpg`.
  - Texturas de 1024 píxeles; las hojas cercanas añaden geometría curvada reutilizada. Las fotografías suministradas por el usuario se usaron como referencia visual, sin extraer sus píxeles.
- `cacao-leaf.png`: material visual generado con la herramienta integrada de generación de imágenes. Tiene canal alfa y no es una fotografía botánica. No se usó para entrenar el detector. Prompt y modo en `leaf-generation.md`.
- Mazorcas: texturas cilíndricas derivadas de recortes anotados de **entrenamiento**. `pods/provenance.json` conserva cada ID, caja y hash. No se usaron fotografías del nuevo test Mendeley. CocoaMoniliaDataSet v2 publica CC BY 4.0; Serrano/Torres conserva términos de base de datos y derechos de los autores de las imágenes. Estos materiales locales no implican una autorización adicional para redistribuir su corpus.
- Geometría: generador procedural del proyecto, con tronco, ramas, hojas curvas y mazorcas acanaladas. La textura de hoja se aplica a una malla, no a una imagen de un árbol completo.
- Follaje distante: atlas transparente de 512 píxeles horneado al iniciar con nueve hojas de la misma malla. Tres planos cruzados por brote sustituyen las hojas individuales a distancia; las hojas cercanas conservan su geometría.
- Three.js 0.186.1, MIT, licencia en `/vendor/THREE-LICENSE`. Sky procede del mismo paquete.
- Física: Webots R2025a / ODE. Render: Three.js. El render de la cámara y la física comparten distribución y poses mediante `runtime/orchard.json`.

La prueba de este escenario no es independiente del entrenamiento: las pieles de mazorca proceden de fotografías de entrenamiento y la asociación de cajas a posiciones usa geometría conocida. No se atribuye precisión de campo real a este recorrido.
