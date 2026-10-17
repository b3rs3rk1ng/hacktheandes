// Catalogue configuration; transport and filtering do not depend on these places.
// District codes: UBIGEO. areaCodes: department-level ISO 3166-2 identifiers.
export const locations = [
  { code: '210101', name: 'Puno', region: 'Puno', country: 'PE', areaCodes: ['PE-PUN'] },
  { code: '211101', name: 'Juliaca', region: 'Puno', country: 'PE', areaCodes: ['PE-PUN'] },
  { code: '080601', name: 'Sicuani', region: 'Cusco', country: 'PE', areaCodes: ['PE-CUS'] },
  { code: '081210', name: 'Ocongate', region: 'Cusco', country: 'PE', areaCodes: ['PE-CUS'] },
  { code: '200101', name: 'Piura', region: 'Piura', country: 'PE', areaCodes: ['PE-PIU'] },
  { code: '200105', name: 'Catacaos', region: 'Piura', country: 'PE', areaCodes: ['PE-PIU'] },
];

const senamhiUrl = (reference) =>
  `https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente&a=2026&b=${reference}&c=00&d=SENA`;

// Manually verified official-source summaries. No live feed or local impact inference.
// status "actual" distinguishes real-source content from an exercise; expiry must
// be evaluated independently, including when replaying these packets after 2026.
export const officialBulletins = [
  {
    version: 1,
    id: 'senamhi-2026-420',
    status: 'actual',
    kind: 'weather',
    severity: 'moderate',
    areas: [
      { code: 'PE-APU', name: 'Apurímac' },
      { code: 'PE-ARE', name: 'Arequipa' },
      { code: 'PE-CUS', name: 'Cusco' },
      { code: 'PE-MOQ', name: 'Moquegua' },
      { code: 'PE-PUN', name: 'Puno' },
      { code: 'PE-TAC', name: 'Tacna' },
    ],
    issuedAt: '2026-10-15',
    expiresAt: '2026-10-18T23:59:00-05:00',
    title: 'Descenso de temperatura nocturna en la sierra sur',
    body: 'Aviso 420, nivel amarillo. Para el 17 y 18 de octubre se prevén mínimas cercanas a -12 °C en sectores de la sierra sur sobre 4000 m. Es un pronóstico regional; no confirma afectación en cada localidad.',
    source: { name: 'SENAMHI · aviso 420/2026', url: senamhiUrl('29266') },
  },
  {
    version: 1,
    id: 'senamhi-2026-421',
    status: 'actual',
    kind: 'weather',
    severity: 'severe',
    areas: [
      { code: 'PE-CAJ', name: 'Cajamarca' },
      { code: 'PE-LAL', name: 'La Libertad' },
      { code: 'PE-LAM', name: 'Lambayeque' },
      { code: 'PE-PIU', name: 'Piura' },
      { code: 'PE-TUM', name: 'Tumbes' },
    ],
    issuedAt: '2026-10-15',
    expiresAt: '2026-10-19T23:59:00-05:00',
    title: 'Precipitaciones en la sierra norte y costa norte',
    body: 'Aviso 421, nivel naranja. Del 17 al 19 de octubre se prevén lluvias en la costa norte y precipitaciones en la sierra norte. Mayor incidencia costera en Tumbes y el interior de Piura. El ámbito es regional; no confirma daños ni vías cortadas.',
    source: { name: 'SENAMHI · aviso 421/2026', url: senamhiUrl('29267') },
  },
];

// Provenance stays outside transport packets. A missing issuance hour is not
// replaced with midnight or confused with the start of the forecast period.
export const bulletinProvenance = {
  'senamhi-2026-420': {
    verifiedOn: '2026-10-17',
    issuedAtPrecision: 'day',
    expiresAtPrecision: 'minute',
    timeZone: 'America/Lima',
    eventStartsAt: '2026-10-17T00:00:00-05:00',
    geographicPrecision: 'department-and-altitude',
    originalLevel: 'AMARILLO',
    summaryBy: 'Onda; resumen manual de fuente oficial',
    sourceSigned: false,
    areaSourceUrl: 'https://www.senamhi.gob.pe/mapas/mapa-avisos-meteorologicos/index.php?av=420&nl=2&mp=1&fc=2026',
    limitation: 'Los departamentos son ámbitos de posible afectación. Seleccionar un distrito solo filtra el boletín de su región; no prueba que el punto esté dentro del polígono ni sobre 4000 m.',
  },
  'senamhi-2026-421': {
    verifiedOn: '2026-10-17',
    issuedAtPrecision: 'day',
    expiresAtPrecision: 'minute',
    timeZone: 'America/Lima',
    eventStartsAt: '2026-10-17T00:00:00-05:00',
    geographicPrecision: 'department-and-subregion',
    originalLevel: 'NARANJA',
    summaryBy: 'Onda; resumen manual de fuente oficial',
    sourceSigned: false,
    areaSourceUrl: 'https://www.senamhi.gob.pe/mapas/mapa-avisos-meteorologicos/index.php?av=421&nl=3&mp=1&fc=2026',
    limitation: 'El boletín diferencia costa y sierra. El filtro por departamento no reemplaza una intersección con los polígonos oficiales.',
  },
};

export const DEMO_DEFAULTS = {
  version: 1,
  status: 'test',
  kind: 'weather',
  severity: 'info',
  locationCode: '210101',
  title: 'Ejercicio de recepción sin internet',
  body: 'EJERCICIO. Mensaje de prueba de Onda. No es una alerta oficial. Comprueba que este texto llega completo a tu dispositivo sin conexión.',
  durationMinutes: 120,
  source: { name: 'Onda · ejercicio local', url: 'https://hacktheandes.com' },
};

export const officialSources = [
  {
    name: 'Avisos meteorológicos nacionales del SENAMHI',
    url: 'https://www.senamhi.gob.pe/?p=aviso-meteorologico',
    description: 'Consulta oficial; Onda incluye una selección verificada manualmente, no sincronización en tiempo real.',
  },
  {
    name: 'MEF · Anexo de gobiernos locales con UBIGEO',
    url: 'https://mef.gob.pe/contenidos/archivos-descarga/Anexo_01_DS010_2020EF.pdf',
    description: 'Referencia de los seis distritos del catálogo. No es evidencia de cobertura de radio, desconexión ni exposición a peligros.',
  },
];
