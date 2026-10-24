# Schedulite

A professional, full-stack task management application featuring uni-directional synchronization to Google Calendar via OAuth 2.0. Built to provide a streamlined, database-driven scheduling experience with a custom responsive UI.

## Project Overview

Schedulite was developed to bridge the gap between lightweight task trackers and heavy calendar applications. It allows users to quickly log, edit, and categorize tasks with specific durations and deadlines. Schedulite acts as the source of truth, automatically pushing all local task creations, updates, and deletions directly to the user's primary Google Calendar in real-time.

## Key Features

*   **OAuth 2.0 Integration:** Secure Google Calendar API authentication flow with automatic token exchange and session management.
*   **One-Way Automated Sync:** Creating, updating, or deleting a task in the Schedulite dashboard automatically executes the corresponding action in the user's Google Calendar without duplicating events.
*   **Persistent SQLite Storage:** Relational database architecture mapping local task entities to Google `event_id`s, ensuring state consistency across sessions.
*   **Custom Grid UI:** Fully bespoke, responsive frontend built with native CSS Grid and Flexbox. Features strict height constraints, text truncation, and zero reliance on external CSS frameworks.
*   **RESTful API Architecture:** Clean separation of concerns with dedicated Express.js routes handling CRUD operations and API interactions.

## Technical Stack & Packages

**Frontend:** HTML5, CSS3 (CSS Grid, Variables, Custom WebKit Scrollbars), Vanilla JavaScript (Fetch API)
**Backend Core:** Node.js, Express.js (`express`)
**Database:** SQLite3 (`sqlite3`)
**Authentication & Sync:** Google APIs Client Library (`googleapis`), Environment Variable Management (`dotenv`)
**Deployment Infrastructure:** Ubuntu Linux, PM2, Tailscale / Cloudflare Tunnels

## Local Setup & Installation

### 1. Google Cloud Console Configuration
Before running the application locally, you must authorize it to communicate with Google's servers.
* Go to the Google Cloud Console and create a new project.
* Navigate to **APIs & Services > Library** and enable the **Google Calendar API**.
* Configure the **OAuth consent screen** (External) and add your email to the Test Users list.
* Under **Credentials**, create an **OAuth client ID** (Web application). 
* Add `http://localhost:"port"/api/auth/google/callback` to your Authorized redirect URIs.

### 2. Environment Variables
Create a file named exactly `.env` in the root directory of your project. Populate it with the credentials generated from your Google Cloud Console:

```env
SERVER_PORT="port"
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:"port"/api/auth/google/callback
