# Apricot Cure 🍑

**Apricot Cure** is an offline mobile application for detecting apricot diseases using an INT8 ConvNeXt AI model. The application performs disease prediction directly on the Android device without requiring an internet connection.

## 📱 Download

The latest Android APK is available from the **GitHub Release v1.0.0**.

**Download:** Go to **Releases → v1.0.0 → Assets → Apricot-Cure.apk**

> Android may show a security warning when installing an APK downloaded outside Google Play. Allow installation from your browser/file manager if required.

## Features

* 📷 Take a photo using the camera
* 🖼️ Select an image from the gallery
* 🤖 Offline AI disease detection
* 🏆 Top-3 disease predictions
* 📊 Prediction confidence scores
* 🌿 Disease descriptions and treatment advice
* 🖼️ Reference images for comparison
* ⚡ On-device inference without internet

## Supported Diseases

The application supports seven classes:

1. Brown Rot
2. Gummosis & Galls
3. Healthy
4. Other Disorder (e.g. Water Stress)
5. Shot Hole
6. Shot Hole (Leaves)
7. Wilting & Dieback

## Performance

The application was tested on an **Oppo F15** low-end Android device.

In a 10-image field test:

* **Top-1:** 50%
* **Top-2:** 70%
* **Top-3:** 90%
* **Average prediction time:** approximately 3.5 seconds

## Technology

* Flutter / Dart
* ONNX Runtime
* ConvNeXt-Base INT8
* Offline/on-device inference

## Research Use

This application was developed as part of research on **mobile, offline apricot disease detection for resource-constrained environments**.

The APK provided in Release **v1.0.0** represents the application version used for the reported on-device field evaluation.

## License

MIT License
