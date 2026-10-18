# Revisión del robot de campo

El usuario pide aprobar la forma y el movimiento antes de integrar el robot al huerto. Esta página es una mesa de revisión 3D que corre localmente, sin detector e incluye un circuito físico independiente.

Paleta: fondo de estudio gris azulado #e7edef, carcasas #edf0e9, brazo azul #253c55, neumáticos #242b2d, metal #a9b6bd y herramienta ámbar #cb943d. Tipografía Avenir Next para títulos, controles y medidas. Texto a la izquierda; el robot es el elemento dominante, con espacio alrededor del brazo extendido.

Disposición: cabecera discreta; modelo grande a la izquierda; panel de revisión a la derecha con fase, dimensiones propuestas y controles de articulaciones; reproducción y línea de tiempo al pie. En móvil el modelo ocupa el espacio superior y los controles siguen debajo, sin superponerlos al brazo.

Se evita reproducir el HUD del dron: aquí se revisa un producto físico, sin misión, batería ficticia ni métricas de detección. La identidad visual está en los materiales y las articulaciones del robot. El referente guía el tipo de máquina; no se copia su marca ni se presenta como un producto comercial existente.

La secuencia de brazo es cinemática y programada. El circuito de terreno usa dinámica de cuerpo rígido con ruedas por rayos; sus parámetros son aproximados. No se atribuyen a esta revisión pruebas de hardware, contacto de agarre o visión. La integración al simulador espera la aprobación de Kevin.

## Ampliación de revisión — terreno y cámaras

Se añade un circuito independiente para revisar ruedas de 45 cm, tacos abiertos y respuesta física de suspensión. El modo de brazo conserva su secuencia cinemática. La cabecera permite alternar ambas pruebas; la vista principal y el recuadro intercambian cámaras montadas y seguimiento exterior. El panel muestra medidas derivadas del motor físico en terreno. Suelo con textura local, señalización sobria y vegetación periférica; no se modifica el huerto compartido ni se presenta esta revisión como validación de un producto real.
