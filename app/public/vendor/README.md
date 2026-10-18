# Vendored dependencies

These distributions are served locally and cached with the application. No CDN is required at runtime.

- `ggwave-0.4.0.js`: unmodified browser/CommonJS distribution from `https://registry.npmjs.org/ggwave/-/ggwave-0.4.0.tgz`. The WebAssembly binary is embedded in the JavaScript file. MIT license in `ggwave-LICENSE`, retrieved from upstream commit `9ac1624d77b4dd82c6710aa538bfa4bb42c9b263`.
- `fflate-0.8.3.js`: unmodified `esm/browser.js` from `https://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz`. MIT license in `fflate-LICENSE`.

SHA-256:

```text
f3792b5c185345a35a935ca68a5064b97f979d13fbba0062ff16f6b3b31a6113  ggwave-0.4.0.js
b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1  fflate-0.8.3.js
```

The transport uses ggwave's existing audible modulation and Reed–Solomon error correction. It does not implement a new radio standard and has not been validated over an AM/FM broadcast chain. Message CRC32 checksums detect accidental corruption; they are not digital signatures or proof of an official sender.
