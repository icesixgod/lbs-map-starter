# Contributing

Run the complete check from the repository root:

```sh
npm run verify
```

Start the application with `npm start`. After changing browser source, rebuild and reload; after changing server code, restart the server.

Keep fixes focused and include a meaningful regression check when changing building identity, polygon holes, roof/facade picking, streamed loading, cancellation or GPS behavior. Explain any change to map source attributes or height assumptions.

Commit source files and necessary small fixtures. Generated `dist/`, `.cache/`, recordings, test screenshots and local deployment configuration stay out of version control. Retain dataset attribution and third-party license notices.

The application currently uses Chinese UI labels. The main README is Chinese, with an English entry point in `README.en.md`.
