# Fuentes, procedencia y límites de Onda

Verificado el 17 de octubre de 2026. Los datos incluidos son una selección manual de fuentes oficiales. No se ha implementado una conexión en tiempo real con SENAMHI ni una integración autorizada con un sistema de emergencias.

## Boletines de demostración con fuente real

### SENAMHI 420/2026

- [Detalle oficial](https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente&a=2026&b=29266&c=00&d=SENA).
- [Mapa y departamentos de posible afectación, 17 de octubre](https://www.senamhi.gob.pe/mapas/mapa-avisos-meteorologicos/index.php?av=420&nl=2&mp=1&fc=2026).
- Emisión: 15 de octubre de 2026. La página no especifica hora de emisión: se conserva `2026-10-15`, con precisión de día.
- Inicio del evento: 17 de octubre de 2026 a las 00:00, hora local de Perú.
- Fin del evento: 18 de octubre de 2026 a las 23:59, hora local de Perú (`-05:00`).
- Nivel original: amarillo. `moderate` es la categoría interna de visualización de Onda; no una escala oficial nueva.
- Ámbitos de posible afectación mostrados: Apurímac, Arequipa, Cusco, Moquegua, Puno y Tacna.

La ficha de Onda resume el pronóstico de frío nocturno. Las mínimas cercanas a −12 °C se refieren a sectores sobre 4000 metros, no a todos los habitantes o puntos de esos departamentos. El resumen no recomienda decisiones agronómicas ni predice daños.

### SENAMHI 421/2026

- [Detalle oficial](https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente&a=2026&b=29267&c=00&d=SENA).
- [Mapa y departamentos de posible afectación, 17 de octubre](https://www.senamhi.gob.pe/mapas/mapa-avisos-meteorologicos/index.php?av=421&nl=3&mp=1&fc=2026).
- Emisión: 15 de octubre de 2026, sin hora publicada.
- Inicio: 17 de octubre de 2026 a las 00:00, hora local.
- Fin: 19 de octubre de 2026 a las 23:59, hora local (`-05:00`).
- Nivel original: naranja. `severe` es una categoría interna de visualización; el texto conserva el nivel original.
- Departamentos mostrados: Cajamarca, La Libertad, Lambayeque, Piura y Tumbes.

El resumen conserva la distinción entre lluvia costera y precipitaciones de la sierra. Una selección por departamento permite encontrar un boletín regional; no confirma que un distrito esté en cada polígono diario, que haya daños o que una carretera esté cerrada.

### Procedencia, autenticidad y vigencia

`app/src/data.js` mantiene las horas verificadas de inicio y fin. La fecha de emisión sin hora se guarda literalmente y su precisión se documenta en `bulletinProvenance`. Nunca se convierte el inicio del fenómeno en la supuesta hora de emisión.

`status: 'actual'` identifica contenido procedente de un aviso real, frente a `status: 'test'` para ejercicios. No equivale a «vigente en este momento»: la interfaz debe calcular vencimiento desde `expiresAt` y el reloj del dispositivo. Al reproducir estos paquetes después de su vencimiento, deben aparecer vencidos. Tampoco hay actualización automática que permita afirmar que sigue siendo el aviso más reciente.

Los resúmenes fueron redactados manualmente por Onda. Un enlace con nombre de SENAMHI identifica la procedencia editorial; no constituye firma digital, certificación del emisor ni aprobación institucional. Las verificaciones de integridad del transporte no acreditan la identidad de quien emitió el contenido.

## Catálogo de localidades

[MEF: Anexo N.º 01 de gobiernos locales con código UBIGEO](https://mef.gob.pe/contenidos/archivos-descarga/Anexo_01_DS010_2020EF.pdf), páginas 1 y 2:

| UBIGEO | Distrito | Departamento |
|---|---|---|
| 210101 | Puno | Puno |
| 211101 | Juliaca | Puno |
| 080601 | Sicuani | Cusco |
| 081210 | Ocongate | Cusco |
| 200101 | Piura | Piura |
| 200105 | Catacaos | Piura |

Estos lugares son un catálogo de prueba, no comunidades con falta de conectividad validada. La referencia no prueba recepción AM/FM, disponibilidad de smartphone, energía ni exposición a un fenómeno. `areaCodes` relaciona declarativamente cada localidad con su departamento para filtrar boletines regionales; no se ejecuta un análisis geográfico de detalle.

El protocolo admite otros códigos de área y localidades por configuración. El motor de transmisión no debe contener condiciones específicas para Perú, SENAMHI o estos seis distritos.

## Ejercicios editables

`DEMO_DEFAULTS` siempre utiliza `status: 'test'`, un título de ejercicio y texto explícito de prueba. Es contenido generado para demostrar recepción y no una alerta oficial. Su URL de referencia del evento no acredita la emisión del mensaje. El formulario del emisor debe mantener la etiqueta de ejercicio para contenidos escritos libremente por el usuario.

## Qué demuestra el prototipo

La prueba entre una laptop que reproduce audio y un teléfono que lo escucha puede demostrar transporte acústico, recuperación de contenido, filtrado por área y consulta local sin conexión una vez cargada la aplicación. No demuestra por sí sola transmisión RF, cobertura AM/FM, compatibilidad con radios antiguas, recepción en segundo plano o funcionamiento durante una emergencia real. El paso por radio requiere hardware y pruebas adicionales.

## Registro y visibilidad en Hack the Andes

La [documentación pública de proyectos de la plataforma](https://github.com/cuevaio/hack-the-andes/blob/main/docs/hackathon-projects.md), consultada el 17 de octubre de 2026, indica:

- El proyecto pertenece al equipo existente; no se crea una segunda identidad de proyecto.
- `andes project update --message "..."` registra un avance antes de la entrega final.
- La primera entrega mediante `andes project submit` requiere URL de despliegue, URL de presentación, repositorio de GitHub y descripción. Después se pueden editar campos individuales.
- La organización puede consultar equipos y avances.
- La galería empieza oculta y se publica manualmente. Mientras siga oculta, la lectura pública no muestra las entregas. Esta configuración puede cambiar; no es una garantía permanente de privacidad. Un repositorio de GitHub público o una URL compartida pueden verse de manera independiente.
- La organización abre la aplicación y presentación desde las URLs entregadas. La documentación señala que los participantes no conectan sus laptops; la demostración debe prepararse con esa restricción.

Registrar un avance ahora es posible. No hace falta publicar una especificación completa del protocolo para describir el problema y el experimento; tampoco hay exclusividad de idea derivada del registro.
