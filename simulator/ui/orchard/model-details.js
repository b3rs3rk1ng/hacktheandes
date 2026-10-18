export async function setupModelDetails(){
 const $=id=>document.getElementById(id),card=await fetch('/api/model-card').then(r=>r.json()),t=card.training;
 if(!t)throw Error('No está disponible la evidencia del entrenamiento');
 const percent=n=>(n*100).toFixed(1)+'%',reg=card.regression_object_test.results.clean.metrics,ext=card.external_image_test.results.clean.metrics;
 function paragraph(text){const p=document.createElement('p');p.textContent=text;return p}
 function result(title,metrics,unit){const section=document.createElement('section'),h=document.createElement('h3');h.textContent=title;section.append(h,paragraph(`${unit} · precisión ${percent(metrics.precision)} · recall ${percent(metrics.recall)}`));return section}
 const content=$('modelTrainingContent');content.replaceChildren(
  paragraph(`Entrenamos YOLO11s específicamente para mazorcas de cacao: sano, monilia y Phytophthora. La intervención virtual se activa sólo para monilia, con umbral ${card.inference_policy.monilia_alert_threshold}.`),
  paragraph(`${t.original_train_images.toLocaleString('es-PE')} fotos originales de entrenamiento + ${t.augmented_train_images.toLocaleString('es-PE')} variantes de luz y desenfoque. ${t.validation_images} fotos de validación, separadas del entrenamiento. ${t.epochs} épocas, entrada de ${card.inference_policy.image_size} px, en ${t.gpu}.`),
  result('Detección por mazorca',reg,`${reg.images} fotografías de regresión; cajas emparejadas con IoU ≥ 0.5`),
  paragraph('En esa regresión, 29 de 80 mazorcas sanas recibieron una alerta de monilia. Son datos ya usados durante el desarrollo, y no una nueva prueba independiente.'),
  result('Alertas por fotografía nueva',ext,`${ext.images} imágenes externas; sin evaluación de la localización de las cajas`),
  paragraph('Las fotos externas tienen fondos asociados a la clase. Estas cifras por imagen no equivalen a precisión por fruto ni a resultados de vuelo.'),
  paragraph('En vivo: RGB de cámara → nuestro checkpoint → cajas y puntuaciones → alerta del dron → aprobación del agricultor → dos confirmaciones nuevas de la cámara terrestre → retirada virtual. El detector recibe píxeles; la geometría conocida del simulador ubica el fruto.'),
  paragraph('Las texturas del huerto derivan de imágenes de entrenamiento. Esta escena comprueba integración; no demuestra rendimiento en una chacra real. La pinza y el corte están idealizados.'),
  paragraph(`Modelo cargado: ${card.name} · SHA-256 ${card.detector.sha256}`)
 );
 $('modelDetailsButton').onclick=()=>{$('modelTraining').hidden=!$('modelTraining').hidden;$('settings').hidden=true;$('evaluation').hidden=true};$('closeModelTraining').onclick=()=>$('modelTraining').hidden=true;
 return card;
}
