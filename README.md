# Cloud Asset Inventory

A cloud asset dashboard with a Node.js backend. Plain HTML, CSS and JavaScript on the front end. No npm packages to install.

## Run it locally

1. Install Node.js 18 or newer from https://nodejs.org
2. Unzip the project and open the folder in VS Code (File > Open Folder)
3. Open the terminal (Ctrl + `) and run:

       npm start

4. Open http://localhost:5173 in your browser

Demo login: `admin@cloudinventory.com` / `Admin@123` (or create your own account).

To use another port: `PORT=3000 npm start` (Windows PowerShell: `$env:PORT=3000; npm start`).

## Project structure

    server.js             Backend: REST API, login, static file server
    data/db.json          Created on first run (your data). Delete it to reset.
    public/index.html     Page shell
    public/css/style.css  Styles, light and dark theme
    public/js/app.js      Front end: pages, routing, API calls

## What's included

Landing page, sign in and register, dashboard with live counts and charts, asset inventory (add, edit, delete, filter, search), cloud accounts (connect, sync, edit, remove), resource explorer, security findings with compliance score, alerts, activity logs, CSV reports, settings with dark mode.

## API overview

All routes except login and register need an `Authorization: Bearer <token>` header.

    POST /api/auth/login, /api/auth/register     GET /api/auth/me
    GET  /api/dashboard                          POST /api/scan
    GET/POST /api/assets    PUT/DELETE /api/assets/:id
    GET/POST /api/accounts  PUT/DELETE /api/accounts/:id   POST /api/accounts/:id/sync
    GET /api/findings       PUT /api/findings/:id
    GET /api/alerts         PUT /api/alerts/:id/read, /api/alerts/read-all
    GET /api/logs
    GET /api/reports        POST /api/reports/:type/generate   GET /api/reports/:type/download
    PUT /api/settings

Data is stored in a JSON file, which is fine for learning and demos. For real use, swap it for a database such as SQLite or PostgreSQL, and connect the AWS SDK to pull live resources.
