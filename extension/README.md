# X Media Archiver Extension

WXT + React implementation of the browser collector.

## Development

```bash
cd extension
npm install
npm run dev
```

WXT starts a development browser profile with hot reload. The content script only runs on:

```text
https://x.com/*
https://twitter.com/*
```

## Build

```bash
npm run build
npm run zip
```

Chrome/Edge build output is written under:

```text
extension/.output/chrome-mv3/
```

Load that directory from `chrome://extensions` when testing a production build.

## Internationalization

The extension uses Chrome extension native i18n resources:

```text
public/_locales/en/messages.json
public/_locales/zh_CN/messages.json
```

Manifest labels use `__MSG_*__`; popup UI text uses `chrome.i18n.getMessage`.
