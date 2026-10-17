# Onda para iPhone

App iOS de desarrollo con los recursos del receptor incluidos. Reutiliza el mapa, el almacenamiento y el módem de la web. No necesita visitar el hosting ni instalar desde Safari para abrir.

Requiere Xcode, un iPhone con Developer Mode activado y una cuenta/equipo de firma configurado en Xcode. El certificado y el perfil permanecen en el llavero y en Xcode; no se guardan en este repositorio.

Desde la raíz del proyecto `app`:

```sh
npm ci
node scripts/prepare-ios.mjs
xcodebuild -project ios/Onda.xcodeproj -scheme Onda -configuration Debug \
  -destination 'id=IDENTIFICADOR_DEL_IPHONE' -derivedDataPath ios/DerivedData \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=EQUIPO_DE_FIRMA build
xcrun devicectl device install app --device IDENTIFICADOR_DEL_IPHONE \
  ios/DerivedData/Build/Products/Debug-iphoneos/Onda.app
xcrun devicectl device process launch --device IDENTIFICADOR_DEL_IPHONE \
  org.hacktheandes.onda
```

La app sirve los recursos del bundle únicamente en loopback y mantiene un puerto estable para conservar el origen del almacenamiento local. El micrófono y la ubicación requieren permiso del usuario. Los datos de ubicación y el audio se procesan en el dispositivo. Los enlaces externos se abren en Safari al tocarlos.

El receptor no incluye el flujo HTTP del emisor ni sus snapshots de demostración. Los datos del mapa llegan mediante los mismos paquetes acústicos que utiliza la web. Para emitir, utiliza la web de la laptop.

La firma de desarrollo tiene una vigencia definida por su perfil. La instalación no sustituye distribución por App Store/TestFlight. No se promete recepción con la pantalla bloqueada o en segundo plano.
