
// Import modules
const express = require("express");
const dotenv = require("dotenv").config();
const path = require("path");
const sqlite3 = require("sqlite3");

// Create express app and requirements
const app = express();
app.use(express.static("client"));
app.use(express.json());

// Get environment variables
SERVER_PORT = process.env.SERVER_PORT

// Save tasks to database

// Initialize SQLite database (creates 'schedulite.db' if it doesn't exist)
const db = new sqlite3.Database('./schedulite.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the SQLite database.');
});

// Build the schema
db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT,
    deadline TEXT,
    duration TEXT,
    google_event_id TEXT 
)`);

app.post('/api/save-task', (req, res) => {
    // Get all of the task values
    const { title, description, priority, deadline, duration } = req.body;
    
    const sql = `INSERT INTO tasks (title, description, priority, deadline, duration) 
                 VALUES (?, ?, ?, ?, ?)`;
                 
    db.run(sql, [title, description, priority, deadline, duration], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        
        // Return the newly generated SQLite ID back to the frontend
        res.json({ 
            message: "Task successfully saved", 
            taskId: this.lastID 
        });
    });
});

app.put('/api/update-task/:id', (req, res) => {
    const taskId = req.params.id; // Extract the task ID from the URL
    const { title, description, priority, deadline, duration } = req.body; // Extract updated data
    
    // The UPDATE statement overwrites the existing row matching the ID
    const sql = `UPDATE tasks 
                 SET title = ?, description = ?, priority = ?, deadline = ?, duration = ?
                 WHERE id = ?`;
                 
    db.run(sql, [title, description, priority, deadline, duration, taskId], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        
        if (this.changes === 0) {
            return res.status(404).json({ message: "Task not found" });
        }
        
        res.json({ message: "Task successfully updated" });
    });
});

app.delete('/api/delete-task/:id', (req, res) => {
    const taskId = req.params.id;

    const sql = `DELETE FROM tasks WHERE id = ?`;

    db.run(sql, [taskId], function(err) {
        if (err) return res.status(400).json({ error: err.message });

        if (this.changes === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        res.json({ message: "Task successfully deleted" });
    });
});

app.delete('/api/delete-task/:id', (req, res) => {
    const taskId = req.params.id;

    const sql = `DELETE FROM tasks WHERE id = ?`;

    db.run(sql, [taskId], function(err) {
        if (err) return res.status(400).json({ error: err.message });

        if (this.changes === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        res.json({ message: "Task successfully deleted" });
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

// Open the server
app.listen(SERVER_PORT, function(){
    console.log(`Running server on: localhost:${SERVER_PORT}`)
})

