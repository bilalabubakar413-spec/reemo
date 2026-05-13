# Reemo - IT Staffing Platform

## Setup

1. **Clone het project:**
   ```bash
   git clone [url]
   ```
2. **Installeer dependencies:**
   ```bash
   cd backend
   npm install
   ```
3. **Maak een .env bestand aan in de `backend` map:**
   ```env
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   DATABASE_URL=... (Gebruik de Session Pooler URL voor Render!)
   ```

   > [!IMPORTANT]
   > Als je host op Render (gratis plan), moet je de **Session Pooler URL** van Supabase gebruiken in plaats van de Direct Connection URL. Render ondersteunt namelijk geen IPv6 op het gratis plan, en de Direct Connection van Supabase vereist IPv6.

4. **Start de server:**
   ```bash
   node server.js
   ```
5. **Open in je browser:**
   [http://localhost:3000](http://localhost:3000)

## Login

- **Admin:** admin@reemo.io / demo1234
- **Developer:** developer@reemo.io / demo1234

## Features

- **Timesheet workflow:** Volledig proces van urenregistratie met approve/reject door de admin.
- **Real-time Sync:** Automatische synchronisatie tussen OLTP en OLAP tabellen via Supabase triggers.
- **CV Management:** Uploaden van CV's naar Supabase Storage met automatische PDF-parsing.
- **Client Dashboard:** Gedetailleerde overzichten per klant inclusief projecten en facturatie.
- **Developer Profiles:** Rijke profielen met skills, beschikbaarheid en CV-koppeling.

## VS Code Gebruik

1. Open VS Code.
2. **File → Open Folder** → kies de `reemo-project` map.
3. Open de terminal in VS Code (`Ctrl + \``).
4. Navigeer naar de backend: `cd backend`.
5. Run: `node server.js`.
6. De server draait op [http://localhost:3000](http://localhost:3000).
