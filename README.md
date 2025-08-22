Create project folder

mkdir site-audit-tool && cd site-audit-tool


Initialize & install dependencies

npm init -y
npm install express puppeteer open


Add files

server.mjs (your backend code with /api/audit)

public/index.html (frontend form + output box)

Enable ES modules → in package.json add:

"type": "module",
"scripts": { "start": "node server.mjs" }


Run the server

npm start


Open browser → visit http://localhost:4000 → enter a URL → see results & suggestion (or -).
