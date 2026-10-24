const http = require("http");
const {
    app,
    db,
    encryptTokens,
    decryptTokens,
    getGoogleCalendarColorId,
    buildCalendarEventResource
} = require("../server/server");

// Helper to make HTTP requests against the Express app without extra dependencies
function requestApp(server, method, path, body = null) {
    return new Promise((resolve, reject) => {
        const address = server.address();
        const payload = body ? JSON.stringify(body) : null;

        const req = http.request(
            {
                hostname: "127.0.0.1",
                port: address.port,
                path,
                method,
                headers: payload
                    ? {
                          "Content-Type": "application/json",
                          "Content-Length": Buffer.byteLength(payload)
                      }
                    : {}
            },
            (res) => {
                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    let parsed = raw;
                    try {
                        parsed = JSON.parse(raw);
                    } catch (_) {
                        // Keep raw string if not JSON
                    }
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed });
                });
            }
        );

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

describe("Schedulite Server — Unit & API Tests", () => {
    let server;

    beforeAll((done) => {
        server = app.listen(0, () => done());
    });

    afterAll((done) => {
        server.close(() => {
            db.close(() => done());
        });
    });

    beforeEach((done) => {
        db.run(`DELETE FROM tasks`, () => done());
    });

    describe("Token Encryption (AES-256-GCM)", () => {
        test("encrypts and decrypts OAuth tokens accurately", () => {
            const sampleTokens = {
                access_token: "ya29.sample_access_token",
                refresh_token: "1//sample_refresh_token",
                expiry_date: 1790000000000
            };

            const encrypted = encryptTokens(sampleTokens);
            expect(typeof encrypted).toBe("string");
            expect(encrypted.split(":")).toHaveLength(3);
            expect(encrypted).not.toContain("ya29.sample_access_token");

            const decrypted = decryptTokens(encrypted);
            expect(decrypted).toEqual(sampleTokens);
        });

        test("throws an error if encrypted token payload is tampered with", () => {
            const encrypted = encryptTokens({ access_token: "secret" });
            const parts = encrypted.split(":");
            // Flip a byte in the auth tag
            const tamperedTag = parts[1].slice(0, -2) + (parts[1].endsWith("00") ? "ff" : "00");
            const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

            expect(() => decryptTokens(tampered)).toThrow();
        });
    });

    describe("Google Calendar Event Helpers", () => {
        test("maps hex colours to the closest Google Calendar colorId", () => {
            // Red -> Tomato ("11")
            expect(getGoogleCalendarColorId("#ff0000", "Low")).toBe("11");
            // Green -> Basil ("10") or Sage ("2")
            expect(["2", "10"]).toContain(getGoogleCalendarColorId("#0b8043", "Low"));
            // Blue -> Peacock ("7") or Blueberry ("9")
            expect(["7", "9"]).toContain(getGoogleCalendarColorId("#039be5", "Low"));
        });

        test("falls back to priority colour when hex is invalid", () => {
            expect(getGoogleCalendarColorId("invalid", "High")).toBe("11");
            expect(getGoogleCalendarColorId("", "Medium")).toBe("5");
            expect(getGoogleCalendarColorId(null, "Low")).toBe("10");
        });

        test("builds a Google Calendar event resource with start_time + duration", () => {
            const task = {
                id: 42,
                title: "Revise Algorithms",
                description: "Practice dynamic programming",
                priority: "High",
                deadline: "2026-11-15",
                start_time: "14:00",
                duration: "2.5",
                colour: "#d50000"
            };

            const eventResource = buildCalendarEventResource(task);
            expect(eventResource.summary).toBe("Revise Algorithms");
            expect(eventResource.colorId).toBe("11");
            expect(eventResource.extendedProperties.private.scheduliteTaskId).toBe("42");

            const startMs = Date.parse(eventResource.start.dateTime);
            const endMs = Date.parse(eventResource.end.dateTime);
            expect(endMs - startMs).toBe(2.5 * 60 * 60 * 1000);
        });
    });

    describe("Tasks REST API Endpoints", () => {
        test("POST /api/save-task creates a task and GET /api/get-tasks returns it", async () => {
            const newTask = {
                title: "Write Jest Tests",
                description: "Add unit and integration tests",
                priority: "High",
                deadline: "2026-10-30",
                start_time: "10:30",
                duration: "2",
                colour: "#4285f4"
            };

            const saveRes = await requestApp(server, "POST", "/api/save-task", newTask);
            expect(saveRes.status).toBe(200);
            expect(saveRes.body.message).toBe("Task successfully saved");
            expect(typeof saveRes.body.taskId).toBe("number");

            const getRes = await requestApp(server, "GET", "/api/get-tasks");
            expect(getRes.status).toBe(200);
            expect(getRes.body).toHaveLength(1);
            expect(getRes.body[0]).toMatchObject({
                id: saveRes.body.taskId,
                ...newTask
            });
        });

        test("PUT /api/update-task/:id updates an existing task", async () => {
            const createRes = await requestApp(server, "POST", "/api/save-task", {
                title: "Initial Title",
                description: "Initial Desc",
                priority: "Low",
                deadline: "2026-10-28",
                start_time: "09:00",
                duration: "1",
                colour: "#33b679"
            });
            const taskId = createRes.body.taskId;

            const updatedPayload = {
                title: "Updated Title",
                description: "Updated Desc",
                priority: "High",
                deadline: "2026-10-29",
                start_time: "15:00",
                duration: "3.5",
                colour: "#d50000"
            };

            const updateRes = await requestApp(server, "PUT", `/api/update-task/${taskId}`, updatedPayload);
            expect(updateRes.status).toBe(200);
            expect(updateRes.body.message).toBe("Task successfully updated");

            const getRes = await requestApp(server, "GET", "/api/get-tasks");
            expect(getRes.body[0]).toMatchObject({
                id: taskId,
                ...updatedPayload
            });
        });

        test("PUT /api/update-task/:id returns 404 for non-existent task", async () => {
            const res = await requestApp(server, "PUT", "/api/update-task/99999", {
                title: "Missing",
                description: "Missing",
                priority: "Low",
                deadline: "2026-10-29",
                start_time: "10:00",
                duration: "1",
                colour: "#4285f4"
            });
            expect(res.status).toBe(404);
        });

        test("DELETE /api/complete-task/:id removes the task from SQLite", async () => {
            const createRes = await requestApp(server, "POST", "/api/save-task", {
                title: "Task to Complete",
                description: "Complete me",
                priority: "Medium",
                deadline: "2026-10-28",
                start_time: "11:00",
                duration: "1",
                colour: "#f6bf26"
            });

            const completeRes = await requestApp(server, "DELETE", `/api/complete-task/${createRes.body.taskId}`);
            expect(completeRes.status).toBe(200);

            const getRes = await requestApp(server, "GET", "/api/get-tasks");
            expect(getRes.body).toHaveLength(0);
        });

        test("DELETE /api/delete-task/:id removes the task and returns 404 if deleted again", async () => {
            const createRes = await requestApp(server, "POST", "/api/save-task", {
                title: "Task to Delete",
                description: "Delete me",
                priority: "Low",
                deadline: "2026-10-28",
                start_time: "12:00",
                duration: "2",
                colour: "#4285f4"
            });
            const taskId = createRes.body.taskId;

            const delRes = await requestApp(server, "DELETE", `/api/delete-task/${taskId}`);
            expect(delRes.status).toBe(200);
            expect(delRes.body.message).toBe("Task successfully deleted");

            const delAgainRes = await requestApp(server, "DELETE", `/api/delete-task/${taskId}`);
            expect(delAgainRes.status).toBe(404);
        });

        test("GET /api/auth/google/status returns connection status", async () => {
            const res = await requestApp(server, "GET", "/api/auth/google/status");
            expect(res.status).toBe(200);
            expect(typeof res.body.connected).toBe("boolean");
        });
    });
});

