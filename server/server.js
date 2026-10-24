
// Import modules
const express = require("express");
const dotenv = require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const { google } = require('googleapis');

// Create express app and requirements
const app = express();
app.use(express.static("client"));
app.use(express.json());


// Get environment variables
SERVER_PORT = process.env.SERVER_PORT

// Save tasks to database

// Initialize SQLite database (uses in-memory DB during tests, otherwise 'schedulite.db')
const dbPath = process.env.NODE_ENV === "test" ? ":memory:" : "./schedulite.db";
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    if (process.env.NODE_ENV !== "test") {
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
});

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

function saveTokensToDb(newTokens) {
    // Preserve existing refresh_token if Google only returned a refreshed access_token
    const mergedTokens = {
        ...oauth2Client.credentials,
        ...newTokens
    };
    oauth2Client.setCredentials(mergedTokens);
    isGoogleConnected = true;

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

function loadSavedTokensFromDb() {
    db.get(`SELECT encrypted_tokens FROM google_tokens WHERE id = 1`, [], (err, row) => {
        if (err) {
            console.error("Error reading Google tokens from DB:", err.message);
            return;
        }
        if (!row || !row.encrypted_tokens) return;

        try {
            const tokens = decryptTokens(row.encrypted_tokens);
            oauth2Client.setCredentials(tokens);
            isGoogleConnected = true;
            console.log("Loaded saved Google OAuth tokens from database.");
            syncAllUnsyncedTasks();
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
const syncingTaskIds = new Set();

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
        console.error(`Error syncing task ${numericId} with Google Calendar:`, error.message);
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

app.get('/api/auth/google/status', (req, res) => {
    res.json({ connected: isGoogleConnected });
});

app.get('/api/auth/google', (req, res) => {
    if (isGoogleConnected) {
        return res.redirect('/');
    }

    const scopes = ['https://www.googleapis.com/auth/calendar.events'];
    
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

// Open the server when run directly
if (require.main === module) {
    app.listen(SERVER_PORT, function(){
        console.log(`Running server on: localhost:${SERVER_PORT}`);
    });
}

module.exports = {
    app,
    db,
    encryptTokens,
    decryptTokens,
    getGoogleCalendarColorId,
    buildCalendarEventResource,
    saveTokensToDb
};

