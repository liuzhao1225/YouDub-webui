# External file transformation plugin

This standalone, precompiled package adds `example.uppercase`, a task-detail panel, and `/extensions/text` with a navigation entry. It requires no YouDub source edits or web rebuild. Host code reads the uploaded UTF-8 file, writes an uppercase file in its invocation workspace, and registers the real output artifact.

Install this directory through `npm run plugins -- install --source ./fixtures/plugins/file-transform`, then restart the Host. Select **文本转大写**, upload a text file, run the task, and download the result. The detail page displays **外部文本插件** only for this workflow.

Open **外部文本插件** in navigation and click the counter. This page uses `React.useState` from the shared host React instance and is served through the existing catch-all route.

The same files can live in an independent GitHub repository. Supply its GitHub URL and a ref to install; YouDub records the resolved commit. `dist/client.js` uses the host React module through the platform import map. All contributions return their disposers to Cordis.
