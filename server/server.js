
// Import modules
const express = require("express");
const dotenv = require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const { google } = require('googleapis');
const { GoogleGenAI, Type } = require("@google/genai");

// Create express app and requirements
const app = express();
app.use(express.static("client"));
app.use(express.json());


// Get environment variables
SERVER_PORT = process.env.SERVER_PORT;
GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialise google ai
const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY || "test-gemini-key"
});

// JSON Schema defining what the model MUST return
const TaskExtractionSchema = {
    type: Type.OBJECT,
    properties: {
        is_actionable_event: {
            type: Type.BOOLEAN,
            description: "True if this email contains a concrete deadline, delivery, meeting, or scheduled event. False for newsletters, spam, receipts without delivery dates, or general chatter."
        },
        title: {
            type: Type.STRING,
            description: "Concise title for the task (e.g. 'Amazon: Mechanical Keyboard Delivery' or 'Coursework 1 Submission')"
        },
        description: {
            type: Type.STRING,
            description: "Relevant details: tracking numbers, location, meeting links, or submission notes."
        },
        priority: {
            type: Type.STRING,
            enum: ["High", "Medium", "Low"],
            description: "High for academic deadlines/exams, Medium for meetings/calls, Low for deliveries/general."
        },
        deadline: {
            type: Type.STRING,
            description: "Due date or event date in YYYY-MM-DD format based on reference date."
        },
        start_time: {
            type: Type.STRING,
            description: "Start time in 24h format HH:MM. Default to 09:00 if not specified."
        },
        duration: {
            type: Type.STRING,
            description: "Duration in hours as a string (e.g. '1', '0.5', '2'). Default '1'."
        },
        colour: {
            type: Type.STRING,
            enum: [
                "#4285f4", // Blue
                "#7986cb", // Lavender
                "#8e24aa", // Grape
                "#e67c73", // Flamingo
                "#d50000", // Tomato
                "#f4511e", // Tangerine
                "#f6bf26", // Banana
                "#33b679", // Sage
                "#0b8043", // Basil
                "#616161"  // Graphite
            ],
            description: "Pick the colour matching the category based on the user's category rules."
        }
    },
    required: ["is_actionable_event", "title", "priority", "deadline", "start_time", "duration", "colour"],
    propertyOrdering: ["is_actionable_event", "title", "description", "priority", "deadline", "start_time", "duration", "colour"]
};

// Save tasks to database

// Initialize SQLite database (uses in-memory DB during tests, otherwise 'schedulite.db')
const isTestEnv = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;
const dbPath = isTestEnv ? ":memory:" : "./schedulite.db";
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    if (!isTestEnv) {
        console.log('Connected to the SQLite database.');
    }
});

// Build the schema
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT,
        deadline TEXT,
        start_time TEXT,
        duration TEXT,
        colour TEXT,
        google_event_id TEXT 
    )`, () => {
        // Ensure existing databases have start_time and colour columns
        db.run(`ALTER TABLE tasks ADD COLUMN start_time TEXT`, () => {});
        db.run(`ALTER TABLE tasks ADD COLUMN colour TEXT`, () => {});
    });

    // Table to store encrypted Google OAuth tokens (single-row store, id = 1)
    db.run(`CREATE TABLE IF NOT EXISTS google_tokens (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        encrypted_tokens TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error("Error creating google_tokens table:", err.message);
        } else {
            loadSavedTokensFromDb();
        }
    });

    // Table to track processed emails and prevent duplicate task scheduling
    db.run(`CREATE TABLE IF NOT EXISTS processed_emails (
        email_id TEXT PRIMARY KEY,
        thread_id TEXT,
        subject TEXT,
        sender TEXT,
        received_at TEXT,
        task_id INTEGER,
        is_event INTEGER DEFAULT 0,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ensure tasks table has source_email_id column
    db.run(`ALTER TABLE tasks ADD COLUMN source_email_id TEXT`, () => {});

    // Table for Quick Tasks (general checklist notepad)
    db.run(`CREATE TABLE IF NOT EXISTS day_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        completed INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        colour TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
        // Ensure existing databases have the pinned and colour columns
        db.run(`ALTER TABLE day_tasks ADD COLUMN pinned INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE day_tasks ADD COLUMN colour TEXT DEFAULT ''`, () => {});
    });

    // Table for customisable email AI categories and assigned colours
    db.run(`CREATE TABLE IF NOT EXISTS email_categories (
        category_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        colour TEXT NOT NULL
    )`, () => {
        const stmt = db.prepare(`INSERT OR IGNORE INTO email_categories (category_key, label, description, colour) VALUES (?, ?, ?, ?)`);
        for (const cat of DEFAULT_EMAIL_CATEGORIES) {
            stmt.run([cat.category_key, cat.label, cat.description, cat.colour]);
        }
        stmt.finalize(() => {
            refreshEmailCategoriesCache();
        });
    });

    // Table for application settings (e.g. email auto sync interval)
    db.run(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`, () => {
        db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('email_auto_sync_interval', '15')`, () => {
            db.get(`SELECT value FROM app_settings WHERE key = 'email_auto_sync_interval'`, [], (err, row) => {
                if (!err && row && row.value) {
                    updateAutoSyncTimer(Number(row.value));
                } else {
                    updateAutoSyncTimer(15);
                }
            });
        });
    });
});

// Default AI categories and assigned colors
const DEFAULT_EMAIL_CATEGORIES = [
    { category_key: "deadlines", label: "Deadlines & Assessments", description: "Coursework, exams, urgent submissions", colour: "#d50000" },
    { category_key: "meetings", label: "Meetings & Lectures", description: "Supervisor syncs, classes, appointments", colour: "#8e24aa" },
    { category_key: "deliveries", label: "Package Deliveries", description: "Courier tracking, Amazon, postal parcels", colour: "#33b679" },
    { category_key: "events", label: "General Events", description: "Webinars, society events, reservations", colour: "#4285f4" },
    { category_key: "admin", label: "Admin & Reminders", description: "Bills, confirmations, low-priority reminders", colour: "#616161" }
];

let emailCategoriesCache = [...DEFAULT_EMAIL_CATEGORIES];
let autoSyncTimer = null;
let autoSyncIntervalMins = 15;

function refreshEmailCategoriesCache() {
    db.all(`SELECT category_key, label, description, colour FROM email_categories`, [], (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length > 0) {
            emailCategoriesCache = rows;
        }
    });
}

function updateAutoSyncTimer(intervalMins) {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }

    autoSyncIntervalMins = Math.max(0, parseInt(intervalMins, 10) || 0);
    if (isTestEnv || autoSyncIntervalMins <= 0) return;

    console.log(`[Auto-Sync] Email background scan scheduled every ${autoSyncIntervalMins} minute(s).`);
    autoSyncTimer = setInterval(async () => {
        if (isGoogleConnected && !isGoogleTokenExpired && !isEmailSyncInProgress) {
            console.log("[Auto-Sync] Running background scan for new emails...");
            try {
                await syncRecentEmails({ daysBack: 2 });
            } catch (err) {
                console.error("[Auto-Sync] Background scan error:", err.message);
            }
        }
    }, autoSyncIntervalMins * 60 * 1000);
}

// Accepts "#rrggbb" or "" (no colour); anything else is treated as no colour
function normaliseDayTaskColour(value) {
    const str = typeof value === "string" ? value.trim() : "";
    return /^#[0-9A-Fa-f]{6}$/.test(str) ? str.toLowerCase() : "";
}

function formatDayTask(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        description: row.description || "",
        completed: Boolean(row.completed),
        pinned: Boolean(row.pinned),
        colour: row.colour || "",
        created_at: row.created_at
    };
}

// AES-256-GCM helpers for encrypting tokens at rest in SQLite
const ENCRYPTION_KEY = crypto.scryptSync(
    process.env.TOKEN_ENCRYPTION_SECRET || process.env.GOOGLE_CLIENT_SECRET || "schedulite-default-secret",
    "schedulite-oauth-salt",
    32
);

function encryptTokens(tokens) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    const plaintext = JSON.stringify(tokens);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptTokens(payload) {
    const [ivHex, authTagHex, encryptedHex] = payload.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encryptedText = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
}

// Initialize the Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

let isGoogleConnected = false;
let isGoogleTokenExpired = false;

function isGoogleAuthError(error) {
    if (!error) return false;
    const status = Number(error?.code || error?.status || error?.response?.status);
    const errorCode = String(error?.response?.data?.error || "").toLowerCase();
    const message = String(error?.message || error?.response?.data?.error_description || "").toLowerCase();

    return (
        status === 401 ||
        (status === 403 && (message.includes("insufficient") || message.includes("scope") || message.includes("permission"))) ||
        errorCode === "invalid_grant" ||
        errorCode === "invalid_token" ||
        message.includes("invalid_grant") ||
        message.includes("invalid credentials") ||
        message.includes("token has been expired or revoked") ||
        message.includes("no refresh token is set")
    );
}

function markGoogleTokenExpired() {
    isGoogleConnected = false;
    isGoogleTokenExpired = true;
}

function saveTokensToDb(newTokens) {
    // Preserve existing refresh_token if Google only returned a refreshed access_token
    const mergedTokens = {
        ...oauth2Client.credentials,
        ...newTokens
    };
    oauth2Client.setCredentials(mergedTokens);
    isGoogleConnected = true;
    isGoogleTokenExpired = false;

    try {
        const encryptedPayload = encryptTokens(mergedTokens);
        const sql = `INSERT OR REPLACE INTO google_tokens (id, encrypted_tokens, updated_at)
                     VALUES (1, ?, CURRENT_TIMESTAMP)`;
        db.run(sql, [encryptedPayload], (err) => {
            if (err) console.error("Error saving Google tokens to DB:", err.message);
        });
    } catch (error) {
        console.error("Error encrypting Google tokens:", error);
    }
}

async function verifyGoogleTokenHealth() {
    const creds = oauth2Client.credentials || {};
    if (!creds.access_token && !creds.refresh_token) {
        return { connected: false, expired: isGoogleTokenExpired };
    }

    const now = Date.now();
    const isPastExpiry = creds.expiry_date ? creds.expiry_date <= now + 60 * 1000 : false;

    if (isPastExpiry && !creds.refresh_token) {
        markGoogleTokenExpired();
        return { connected: false, expired: true };
    }

    if (isPastExpiry || !creds.access_token) {
        try {
            await oauth2Client.getAccessToken();
            isGoogleConnected = true;
            isGoogleTokenExpired = false;
        } catch (error) {
            if (isGoogleAuthError(error)) {
                markGoogleTokenExpired();
            }
        }
    }

    const credsScope = String(creds.scope || "");
    const hasGmailScope = credsScope.includes("gmail.readonly");

    return {
        connected: isGoogleConnected && !isGoogleTokenExpired,
        expired: isGoogleTokenExpired,
        hasGmailScope
    };
}

function loadSavedTokensFromDb() {
    db.get(`SELECT encrypted_tokens FROM google_tokens WHERE id = 1`, [], async (err, row) => {
        if (err) {
            console.error("Error reading Google tokens from DB:", err.message);
            return;
        }
        if (!row || !row.encrypted_tokens) return;

        try {
            const tokens = decryptTokens(row.encrypted_tokens);
            oauth2Client.setCredentials(tokens);
            isGoogleConnected = true;
            isGoogleTokenExpired = false;
            console.log("Loaded saved Google OAuth tokens from database.");
            const health = await verifyGoogleTokenHealth();
            if (health.connected) {
                syncAllUnsyncedTasks();
            }
        } catch (error) {
            console.error("Failed to decrypt saved Google tokens:", error.message);
        }
    });
}

// Automatically persist refreshed tokens when googleapis refreshes an expired access_token
oauth2Client.on("tokens", (tokens) => {
    saveTokensToDb(tokens);
});

// Google Calendar automatic sync helpers
const calendar = google.calendar({ version: "v3", auth: oauth2Client });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });
const syncingTaskIds = new Set();
let isEmailSyncInProgress = false;

// Official Google Calendar event palette (colorId "1" to "11")
const GOOGLE_CALENDAR_COLORS = [
    { id: "1", hex: "#7986cb" }, // Lavender
    { id: "2", hex: "#33b679" }, // Sage
    { id: "3", hex: "#8e24aa" }, // Grape
    { id: "4", hex: "#e67c73" }, // Flamingo
    { id: "5", hex: "#f6bf26" }, // Banana
    { id: "6", hex: "#f4511e" }, // Tangerine
    { id: "7", hex: "#039be5" }, // Peacock
    { id: "8", hex: "#616161" }, // Graphite
    { id: "9", hex: "#3f51b5" }, // Blueberry
    { id: "10", hex: "#0b8043" }, // Basil
    { id: "11", hex: "#d50000" }  // Tomato
];

function hexToRgb(hex) {
    const clean = (hex || "").replace("#", "");
    if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16)
    };
}

function getGoogleCalendarColorId(colourHex, fallbackPriority) {
    const targetRgb = hexToRgb(colourHex);
    if (targetRgb) {
        let bestId = "7";
        let minDistance = Number.POSITIVE_INFINITY;
        for (const palette of GOOGLE_CALENDAR_COLORS) {
            const rgb = hexToRgb(palette.hex);
            const dist =
                (targetRgb.r - rgb.r) ** 2 +
                (targetRgb.g - rgb.g) ** 2 +
                (targetRgb.b - rgb.b) ** 2;
            if (dist < minDistance) {
                minDistance = dist;
                bestId = palette.id;
            }
        }
        return bestId;
    }

    const normalized = (fallbackPriority || "Low").toLowerCase();
    if (normalized === "high") return "11";
    if (normalized === "medium") return "5";
    return "10";
}

function buildCalendarEventResource(task) {
    const durationHours = Math.max(0.25, parseFloat(task.duration) || 1);
    const startTimeStr = task.start_time && /^\d{2}:\d{2}$/.test(task.start_time) ? task.start_time : "09:00";
    const startDate = new Date(`${task.deadline}T${startTimeStr}:00`);
    const validStart = !Number.isNaN(startDate.getTime()) ? startDate : new Date();
    const endDate = new Date(validStart.getTime() + durationHours * 60 * 60 * 1000);

    return {
        summary: task.title,
        description: `${task.description || ""}\n\nPriority: ${task.priority || "Low"}\nStart Time: ${startTimeStr}\nDuration: ${task.duration} hours`.trim(),
        colorId: getGoogleCalendarColorId(task.colour, task.priority),
        start: {
            dateTime: validStart.toISOString()
        },
        end: {
            dateTime: endDate.toISOString()
        },
        extendedProperties: {
            private: {
                scheduliteTaskId: String(task.id)
            }
        }
    };
}

async function syncTaskWithGoogleCalendar(taskId) {
    if (!isGoogleConnected) return;
    const numericId = Number(taskId);
    if (syncingTaskIds.has(numericId)) return;
    syncingTaskIds.add(numericId);

    try {
        const task = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM tasks WHERE id = ?`, [numericId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!task) return;

        const eventResource = buildCalendarEventResource(task);

        // If task already has a google_event_id, update existing event to avoid duplicates
        if (task.google_event_id) {
            try {
                await calendar.events.update({
                    calendarId: "primary",
                    eventId: task.google_event_id,
                    requestBody: eventResource
                });
                return;
            } catch (updateErr) {
                if (isGoogleAuthError(updateErr)) {
                    markGoogleTokenExpired();
                    console.warn("Google Calendar token expired or revoked during event update.");
                    return;
                }
                const status = updateErr?.code || updateErr?.response?.status;
                // Only create a new event if the old one was deleted from Google Calendar (404 / 410)
                if (status !== 404 && status !== 410) {
                    console.error(`Error updating Google Calendar event for task ${numericId}:`, updateErr.message);
                    return;
                }
            }
        }

        // Check Google Calendar by private extendedProperty first to prevent duplicates
        const existingList = await calendar.events.list({
            calendarId: "primary",
            privateExtendedProperty: `scheduliteTaskId=${numericId}`,
            maxResults: 1
        });

        if (existingList.data.items && existingList.data.items.length > 0) {
            const existingEventId = existingList.data.items[0].id;
            await calendar.events.update({
                calendarId: "primary",
                eventId: existingEventId,
                requestBody: eventResource
            });
            db.run(`UPDATE tasks SET google_event_id = ? WHERE id = ?`, [existingEventId, numericId]);
            return;
        }

        // Insert new Google Calendar event and save its google_event_id
        const created = await calendar.events.insert({
            calendarId: "primary",
            requestBody: eventResource
        });

        const newEventId = created.data.id;
        if (newEventId) {
            db.run(`UPDATE tasks SET google_event_id = ? WHERE id = ?`, [newEventId, numericId]);
        }
    } catch (error) {
        if (isGoogleAuthError(error)) {
            markGoogleTokenExpired();
            console.warn(`Google Calendar token expired or revoked while syncing task ${numericId}.`);
        } else {
            console.error(`Error syncing task ${numericId} with Google Calendar:`, error.message);
        }
    } finally {
        syncingTaskIds.delete(numericId);
    }
}

async function deleteGoogleCalendarEvent(googleEventId) {
    if (!isGoogleConnected || !googleEventId) return;
    try {
        await calendar.events.delete({
            calendarId: "primary",
            eventId: googleEventId
        });
    } catch (error) {
        if (isGoogleAuthError(error)) {
            markGoogleTokenExpired();
            console.warn("Google Calendar token expired or revoked during event deletion.");
            return;
        }
        const status = error?.code || error?.response?.status;
        if (status !== 404 && status !== 410) {
            console.error("Error deleting Google Calendar event:", error.message);
        }
    }
}

function syncAllUnsyncedTasks() {
    if (!isGoogleConnected) return;
    db.all(`SELECT id FROM tasks WHERE google_event_id IS NULL OR google_event_id = ''`, [], async (err, rows) => {
        if (err || !Array.isArray(rows)) return;
        for (const row of rows) {
            await syncTaskWithGoogleCalendar(row.id);
        }
    });
}

app.get('/api/auth/google/status', async (req, res) => {
    const status = await verifyGoogleTokenHealth();
    res.json(status);
});

app.get('/api/auth/google', (req, res) => {
    const forceReauth = req.query.reauth === "1" || req.query.reauth === "true";
    const creds = oauth2Client.credentials || {};
    const scopeStr = String(creds.scope || "");
    const hasGmailScope = scopeStr.includes("gmail.readonly");

    // If connected and has both scopes, redirect back unless forced to re-auth
    if (isGoogleConnected && !isGoogleTokenExpired && hasGmailScope && !forceReauth) {
        return res.redirect('/');
    }

    const scopes = [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.readonly'
    ];
    
    // Generate the Google login URL
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Requests a refresh token so the user stays logged in
        scope: scopes,
        prompt: 'consent' // Forces the consent screen to appear so you always get a refresh token
    });
    
    // Redirect the user to Google's login page
    res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
    const code = req.query.code;
    
    try {
        // Exchange the code for access and refresh tokens
        const { tokens } = await oauth2Client.getToken(code);
        
        // Encrypt and save tokens in SQLite
        saveTokensToDb(tokens);

        // Automatically sync any existing tasks that haven't been synced yet
        syncAllUnsyncedTasks();
        
        // Send the user back to your main task manager dashboard
        res.redirect('/?google=connected'); 
    } catch (error) {
        console.error('Error exchanging token:', error);
        res.status(500).send('Authentication failed');
    }
});

app.post('/api/save-task', (req, res) => {
    // Get all of the task values
    const { title, description, priority, deadline, start_time, duration, colour } = req.body;
    
    const sql = `INSERT INTO tasks (title, description, priority, deadline, start_time, duration, colour) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
                 
    db.run(sql, [title, description, priority, deadline, start_time, duration, colour], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        
        const newTaskId = this.lastID;

        // Automatically sync the newly created task with Google Calendar
        syncTaskWithGoogleCalendar(newTaskId);

        // Return the newly generated SQLite ID back to the frontend
        res.json({ 
            message: "Task successfully saved", 
            taskId: newTaskId 
        });
    });
});

app.put('/api/update-task/:id', (req, res) => {
    const taskId = req.params.id; // Extract the task ID from the URL
    const { title, description, priority, deadline, start_time, duration, colour } = req.body; // Extract updated data
    
    // The UPDATE statement overwrites the existing row matching the ID
    const sql = `UPDATE tasks 
                 SET title = ?, description = ?, priority = ?, deadline = ?, start_time = ?, duration = ?, colour = ?
                 WHERE id = ?`;
                 
    db.run(sql, [title, description, priority, deadline, start_time, duration, colour, taskId], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        
        if (this.changes === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Automatically update (or create if missing) the linked Google Calendar event
        syncTaskWithGoogleCalendar(taskId);
        
        res.json({ message: "Task successfully updated" });
    });
});

app.delete('/api/delete-task/:id', (req, res) => {
    const taskId = req.params.id;

    db.get(`SELECT google_event_id FROM tasks WHERE id = ?`, [taskId], (selectErr, row) => {
        if (selectErr) return res.status(400).json({ error: selectErr.message });

        const sql = `DELETE FROM tasks WHERE id = ?`;

        db.run(sql, [taskId], function(err) {
            if (err) return res.status(400).json({ error: err.message });

            if (this.changes === 0) {
                return res.status(404).json({ message: "Task not found" });
            }

            // Automatically delete the linked Google Calendar event if present
            if (row && row.google_event_id) {
                deleteGoogleCalendarEvent(row.google_event_id);
            }

            res.json({ message: "Task successfully deleted" });
        });
    });
});

app.delete('/api/complete-task/:id', (req, res) => {
    const taskId = req.params.id;

    // Remove the completed task from SQLite without deleting the Google Calendar event
    const sql = `DELETE FROM tasks WHERE id = ?`;

    db.run(sql, [taskId], function(err) {
        if (err) return res.status(400).json({ error: err.message });

        if (this.changes === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        res.json({ message: "Task marked as complete and removed from database" });
    });
});

app.get('/api/get-tasks', (req, res) => {
    // Select all tasks, ordered by closest deadline first
    const sql = `SELECT * FROM tasks ORDER BY deadline ASC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        
        // Send the array of task objects to the frontend
        res.json(rows);
    });
});

// ==========================================
// Quick Tasks (Checklist Notepad) Routes
// ==========================================

app.get("/api/day-tasks", (req, res) => {
    const sql = `SELECT * FROM day_tasks ORDER BY pinned DESC, completed ASC, id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((rows || []).map(formatDayTask));
    });
});

app.post("/api/day-tasks", (req, res) => {
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();

    if (!title) {
        return res.status(400).json({ error: "Task name is required" });
    }

    const sql = `INSERT INTO day_tasks (title, description, completed, colour) VALUES (?, ?, 0, ?)`;
    db.run(sql, [title, description, normaliseDayTaskColour(req.body.colour)], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        db.get(`SELECT * FROM day_tasks WHERE id = ?`, [this.lastID], (getErr, row) => {
            if (getErr) return res.status(500).json({ error: getErr.message });
            res.status(201).json(formatDayTask(row));
        });
    });
});

app.put("/api/day-tasks/:id", (req, res) => {
    const taskId = Number(req.params.id);
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();

    if (!title) {
        return res.status(400).json({ error: "Task name cannot be empty" });
    }

    // Keep the existing colour if the client didn't send one
    const colour = req.body.colour === undefined ? null : normaliseDayTaskColour(req.body.colour);
    const sql = `UPDATE day_tasks SET title = ?, description = ?, colour = COALESCE(?, colour) WHERE id = ?`;
    db.run(sql, [title, description, colour, taskId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Task not found" });

        db.get(`SELECT * FROM day_tasks WHERE id = ?`, [taskId], (getErr, row) => {
            if (getErr) return res.status(500).json({ error: getErr.message });
            res.json(formatDayTask(row));
        });
    });
});

app.patch("/api/day-tasks/:id/toggle", (req, res) => {
    const taskId = Number(req.params.id);

    db.get(`SELECT * FROM day_tasks WHERE id = ?`, [taskId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Task not found" });

        const nextState = row.completed ? 0 : 1;
        db.run(`UPDATE day_tasks SET completed = ? WHERE id = ?`, [nextState, taskId], function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            db.get(`SELECT * FROM day_tasks WHERE id = ?`, [taskId], (getErr, updatedRow) => {
                if (getErr) return res.status(500).json({ error: getErr.message });
                res.json(formatDayTask(updatedRow));
            });
        });
    });
});

app.patch("/api/day-tasks/:id/pin", (req, res) => {
    const taskId = Number(req.params.id);

    db.get(`SELECT * FROM day_tasks WHERE id = ?`, [taskId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Task not found" });

        const nextPinState = row.pinned ? 0 : 1;
        db.run(`UPDATE day_tasks SET pinned = ? WHERE id = ?`, [nextPinState, taskId], function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            db.get(`SELECT * FROM day_tasks WHERE id = ?`, [taskId], (getErr, updatedRow) => {
                if (getErr) return res.status(500).json({ error: getErr.message });
                res.json(formatDayTask(updatedRow));
            });
        });
    });
});

app.delete("/api/day-tasks/completed", (req, res) => {
    db.run(`DELETE FROM day_tasks WHERE completed = 1`, [], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deletedCount: this.changes });
    });
});

app.delete("/api/day-tasks/:id", (req, res) => {
    const taskId = Number(req.params.id);
    db.run(`DELETE FROM day_tasks WHERE id = ?`, [taskId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Task not found" });
        res.json({ message: "Task deleted" });
    });
});

// --- Gmail & AI Task Extraction Helpers ---

function decodeBase64Url(base64UrlStr) {
    if (!base64UrlStr || typeof base64UrlStr !== "string") return "";
    try {
        const normalized = base64UrlStr.replace(/-/g, "+").replace(/_/g, "/");
        return Buffer.from(normalized, "base64").toString("utf8");
    } catch (_) {
        return "";
    }
}

function getHeader(headers = [], name = "") {
    if (!Array.isArray(headers) || !name) return "";
    const target = name.toLowerCase();
    const found = headers.find((h) => (h.name || "").toLowerCase() === target);
    return found ? found.value : "";
}

function cleanHtmlContent(rawHtml) {
    if (!rawHtml || typeof rawHtml !== "string") return "";
    return rawHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .replace(/\s+([.,!?;:])/g, "$1")
        .trim();
}

function extractTextFromParts(parts = []) {
    let text = "";
    for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body && part.body.data) {
            text += decodeBase64Url(part.body.data) + "\n";
        } else if (part.mimeType === "text/html" && !text && part.body && part.body.data) {
            const rawHtml = decodeBase64Url(part.body.data);
            text += cleanHtmlContent(rawHtml) + "\n";
        } else if (part.parts && Array.isArray(part.parts)) {
            text += extractTextFromParts(part.parts) + "\n";
        }
    }
    return text.trim();
}

function extractEmailContent(messagePayload) {
    if (!messagePayload) return "";
    if (messagePayload.body && messagePayload.body.data) {
        const raw = decodeBase64Url(messagePayload.body.data);
        if (messagePayload.mimeType === "text/html") {
            return cleanHtmlContent(raw);
        }
        return raw.trim();
    }
    if (messagePayload.parts && Array.isArray(messagePayload.parts)) {
        return extractTextFromParts(messagePayload.parts);
    }
    return "";
}

async function extractTaskFromEmail(subject, body, emailDateStr) {
    const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }

    const refDate = emailDateStr ? new Date(emailDateStr) : new Date();
    const validRef = !isNaN(refDate.getTime()) ? refDate : new Date();
    const todayIso = validRef.toISOString().split("T")[0];
    const dayOfWeek = validRef.toLocaleDateString("en-GB", { weekday: "long" });

    const truncatedBody = (body || "").slice(0, 3500);

    const rulesText = emailCategoriesCache.map((c) => 
        `- "${c.colour}": ${c.label} (${c.description})`
    ).join("\n");

    const prompt = `
Reference Date (when email was received): ${todayIso} (${dayOfWeek})

Email Subject: ${subject || "(No Subject)"}
Email Content:
${truncatedBody}
    `.trim();

    const config = {
        systemInstruction: `You are an intelligent scheduling assistant for Schedulite.
Analyze the email and determine if it represents an actionable deadline, scheduled meeting, package delivery, appointment, flight/train, or academic assessment/submission.
Resolve all relative dates ('tomorrow', 'this Friday', 'next Monday', 'in 3 days') relative to the Reference Date provided.
If it is a promotional newsletter, sales discount blast, routine marketing, invoice/receipt without a delivery date, social media digest, or general conversation without an event or deadline, set is_actionable_event to false.

For colour, choose strictly based on the user-configured category rules:
${rulesText}`.trim(),
        responseMimeType: "application/json",
        responseJsonSchema: TaskExtractionSchema
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash-lite",
            contents: prompt,
            config
        });
        if (!response || !response.text) return null;
        return JSON.parse(response.text);
    } catch (err) {
        console.warn("gemini-3.5-flash-lite call failed, trying gemini-3.8-flash fallback:", err.message);
        const response = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: prompt,
            config
        });
        if (!response || !response.text) return null;
        return JSON.parse(response.text);
    }
}

async function syncRecentEmails(options = {}) {
    if (!isGoogleConnected) {
        return { success: false, reason: "Google account not connected", scanned: 0, scheduled: 0, tasks: [] };
    }

    const scopeStr = String(oauth2Client.credentials?.scope || "");
    if (!scopeStr.includes("gmail.readonly")) {
        return {
            success: false,
            needsReauth: true,
            reason: "Gmail permission not granted yet. Please click 'Enable Gmail Access' in the header to authorize email scanning.",
            error: "insufficient_scope",
            scanned: 0,
            scheduled: 0,
            tasks: []
        };
    }

    if (isEmailSyncInProgress) {
        return { success: false, reason: "Sync already in progress. Please wait a moment.", scanned: 0, scheduled: 0, tasks: [] };
    }

    isEmailSyncInProgress = true;

    try {
        const daysBack = Number(options.daysBack) || 7;
        const maxResults = Math.min(Number(options.maxResults) || 20, 50);

        // Filter query to only inspect emails with date / event indicators
        const query = options.query || `newer_than:${daysBack}d (deadline OR "due date" OR delivery OR "out for delivery" OR dispatched OR arriving OR meeting OR assignment OR coursework OR appointment OR scheduled)`;

        const listRes = await gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults
        });

        const messageSummaries = listRes.data?.messages || [];
        if (messageSummaries.length === 0) {
            return { success: true, scanned: 0, scheduled: 0, tasks: [] };
        }

        const newTasksScheduled = [];
        let scannedCount = 0;

        for (const summary of messageSummaries) {
            const emailId = summary.id;
            const threadId = summary.threadId;

            // Check if already processed
            const alreadyProcessed = await new Promise((resolve) => {
                db.get(`SELECT email_id FROM processed_emails WHERE email_id = ?`, [emailId], (err, row) => {
                    resolve(Boolean(row));
                });
            });

            if (alreadyProcessed) {
                continue;
            }

            scannedCount++;

            // Fetch message details
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: emailId,
                format: "full"
            });

            const headers = msg.data?.payload?.headers || [];
            const subject = getHeader(headers, "Subject") || "(No Subject)";
            const sender = getHeader(headers, "From") || "";
            const dateHeader = getHeader(headers, "Date") || "";
            const body = extractEmailContent(msg.data?.payload);

            try {
                const taskData = await extractTaskFromEmail(subject, body, dateHeader);

                if (taskData && taskData.is_actionable_event && taskData.title && taskData.deadline) {
                    const insertSql = `INSERT INTO tasks (title, description, priority, deadline, start_time, duration, colour, source_email_id) 
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

                    const newTaskId = await new Promise((resolve, reject) => {
                        db.run(insertSql, [
                            taskData.title,
                            taskData.description || `From: ${sender}`,
                            taskData.priority || "Low",
                            taskData.deadline,
                            taskData.start_time || "09:00",
                            taskData.duration || "1",
                            taskData.colour || "#4285f4",
                            emailId
                        ], function (err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        });
                    });

                    // Mark email as processed with linked task
                    db.run(
                        `INSERT OR REPLACE INTO processed_emails (email_id, thread_id, subject, sender, received_at, task_id, is_event)
                         VALUES (?, ?, ?, ?, ?, ?, 1)`,
                        [emailId, threadId, subject, sender, dateHeader, newTaskId]
                    );

                    // Sync newly created task with Google Calendar
                    syncTaskWithGoogleCalendar(newTaskId);

                    newTasksScheduled.push({
                        id: newTaskId,
                        title: taskData.title,
                        description: taskData.description,
                        priority: taskData.priority,
                        deadline: taskData.deadline,
                        start_time: taskData.start_time,
                        duration: taskData.duration,
                        colour: taskData.colour
                    });
                } else {
                    // Not actionable, mark as processed so we don't scan it again
                    db.run(
                        `INSERT OR REPLACE INTO processed_emails (email_id, thread_id, subject, sender, received_at, task_id, is_event)
                         VALUES (?, ?, ?, ?, ?, NULL, 0)`,
                        [emailId, threadId, subject, sender, dateHeader]
                    );
                }
            } catch (err) {
                console.error(`Error processing email ${emailId}:`, err.message);
            }
        }

        return {
            success: true,
            scanned: scannedCount,
            scheduled: newTasksScheduled.length,
            tasks: newTasksScheduled
        };
    } catch (error) {
        if (isGoogleAuthError(error)) {
            markGoogleTokenExpired();
        }
        console.error("Error in syncRecentEmails:", error.message);
        return { success: false, reason: error.message, error: error.message, scanned: 0, scheduled: 0, tasks: [] };
    } finally {
        isEmailSyncInProgress = false;
    }
}

// Gmail API Endpoints
app.post("/api/gmail/sync", async (req, res) => {
    try {
        const { daysBack, maxResults, query } = req.body || {};
        const result = await syncRecentEmails({ daysBack, maxResults, query });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/gmail/status", async (req, res) => {
    const health = await verifyGoogleTokenHealth();

    db.get(
        `SELECT COUNT(*) as total_scanned, 
                SUM(CASE WHEN is_event = 1 THEN 1 ELSE 0 END) as total_scheduled
         FROM processed_emails`,
        [],
        (err, stats) => {
            res.json({
                connected: health.connected,
                expired: health.expired,
                hasGmailScope: health.hasGmailScope,
                isSyncing: isEmailSyncInProgress,
                stats: stats || { total_scanned: 0, total_scheduled: 0 }
            });
        }
    );
});

app.get("/api/gmail/processed", (req, res) => {
    db.all(`SELECT * FROM processed_emails ORDER BY processed_at DESC LIMIT 30`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// Category and Auto-Sync Settings Endpoints
app.get("/api/email-categories", (req, res) => {
    db.all(`SELECT category_key, label, description, colour FROM email_categories`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            categories: rows && rows.length > 0 ? rows : emailCategoriesCache,
            autoSyncInterval: autoSyncIntervalMins
        });
    });
});

app.put("/api/email-categories", (req, res) => {
    const { categories, autoSyncInterval } = req.body || {};

    if (Array.isArray(categories)) {
        const updateStmt = db.prepare(`UPDATE email_categories SET colour = ? WHERE category_key = ?`);
        for (const cat of categories) {
            if (cat.category_key && typeof cat.colour === "string" && /^#[0-9A-Fa-f]{6}$/.test(cat.colour.trim())) {
                updateStmt.run([cat.colour.trim().toLowerCase(), cat.category_key]);
            }
        }
        updateStmt.finalize(() => {
            refreshEmailCategoriesCache();
        });
    }

    if (autoSyncInterval !== undefined) {
        const interval = Math.max(0, parseInt(autoSyncInterval, 10) || 0);
        db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('email_auto_sync_interval', ?)`, [String(interval)], () => {
            updateAutoSyncTimer(interval);
        });
    }

    setTimeout(() => {
        db.all(`SELECT category_key, label, description, colour FROM email_categories`, [], (err, rows) => {
            res.json({
                success: true,
                categories: rows && rows.length > 0 ? rows : emailCategoriesCache,
                autoSyncInterval: autoSyncIntervalMins
            });
        });
    }, 40);
});

// Open the server when run directly
if (require.main === module) {
    app.listen(SERVER_PORT, "127.0.0.1", function(){
        console.log(`Running server on: localhost:${SERVER_PORT}`);
    });
}

module.exports = {
    app,
    db,
    oauth2Client,
    encryptTokens,
    decryptTokens,
    getGoogleCalendarColorId,
    buildCalendarEventResource,
    saveTokensToDb,
    isGoogleAuthError,
    markGoogleTokenExpired,
    verifyGoogleTokenHealth,
    decodeBase64Url,
    getHeader,
    extractTextFromParts,
    extractEmailContent,
    extractTaskFromEmail,
    syncRecentEmails,
    DEFAULT_EMAIL_CATEGORIES,
    updateAutoSyncTimer,
    refreshEmailCategoriesCache,
    emailCategoriesCache
};

