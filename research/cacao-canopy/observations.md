# Observaciones visuales de cacaotales

Se inspeccionaron las tres fotografías descargadas y la fotografía de árbol aportada por Kevin. URLs originales en sources.json; uso de investigación, sin redistribución de las fotos. Las imágenes no forman una muestra representativa de los cacaotales del Perú.

## Lo observado

- UFSB: numerosos frutos agrupados junto al tronco y bifurcaciones; ramas y hojas ocupan el espacio alrededor de las mazorcas.
- Fotógrafo Jochen Weber: frutos bajo ramas horizontales y junto al tronco, con varios tallos parcialmente ocultos; algunas mazorcas están cerca del suelo.
- Lindt: árboles con espacio visible entre troncos, pero con ramas bajas cruzadas y frutos en distintas caras del tronco; hojas secas y restos en el suelo.
- Foto aportada por Kevin: hojas y ramas delante de varios frutos; no se observa un corredor despejado para acercar un vehículo volador a todos los frutos.

## Implicaciones por comprobar

Un detector de una mazorca en una imagen no demuestra que un robot pueda verla desde su cámara, estimar su pose y el tallo en 3D, alcanzar una posición con espacio para hélices o brazo, cortar y retirar sin dañar el árbol. Las fotos sugieren restricciones de acceso, pero no permiten medir distancias, pendientes ni tasa de éxito. Tampoco prueban que un vehículo terrestre acceda a todos los árboles.

La simulación existente tiene una mazorca objetivo de posición conocida y un entorno simplificado: no valida estas restricciones.

ICCO describe cosecha mediante corte limpio del tallo evitando daño de la rama, y herramienta de gancho con cuchilla y pértiga para frutos altos: https://www.icco.org/harvesting-post-harvest-new/ . No debe extrapolarse el giro o desprendimiento de una manzana al cacao. Esta fuente describe cosecha, no todo el manejo sanitario de frutos enfermos.
