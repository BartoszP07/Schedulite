/**
 * @jest-environment jsdom
 */

const fs = require("fs");
const path = require("path");

describe("Schedulite Frontend — UI, Validation, Sorting & Edit Tests", () => {
    let clientModule;

    beforeEach(() => {
        // Load the real index.html body into JSDOM
        const htmlPath = path.resolve(__dirname, "../client/index.html");
        const htmlContent = fs.readFileSync(htmlPath, "utf8");
        document.documentElement.innerHTML = htmlContent;

        // Re-require script.js with a fresh DOM for each test
        jest.resetModules();
        clientModule = require("../client/script");
    });

    describe("Time Window & Priority Helpers", () => {
        test("formatTimeWindow calculates end time from start_time and duration", () => {
            expect(clientModule.formatTimeWindow("09:00", "2")).toBe("09:00 – 11:00");
            expect(clientModule.formatTimeWindow("14:30", "1.5")).toBe("14:30 – 16:00");
            expect(clientModule.formatTimeWindow("23:00", "2")).toBe("23:00 – 01:00");
            expect(clientModule.formatTimeWindow("", "2")).toBe("--:--");
        });

        test("getPriorityWeight orders High > Medium > Low", () => {
            expect(clientModule.getPriorityWeight("High")).toBeGreaterThan(clientModule.getPriorityWeight("Medium"));
            expect(clientModule.getPriorityWeight("Medium")).toBeGreaterThan(clientModule.getPriorityWeight("Low"));
        });
    });

    describe("Deadline Status Badges", () => {
        test("identifies Overdue, Due Today, and Tomorrow tasks", () => {
            const now = new Date();
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);

            const yesterdayStr = clientModule.getLocalDateString(yesterday);
            const todayStr = clientModule.getLocalDateString(now);
            const tomorrowStr = clientModule.getLocalDateString(tomorrow);

            expect(clientModule.getDeadlineBadgeInfo(yesterdayStr, "12:00")).toEqual({
                text: "Overdue",
                className: "overdue-badge"
            });

            expect(clientModule.getDeadlineBadgeInfo(todayStr, "23:59")).toEqual({
                text: "Due Today",
                className: "today-badge"
            });

            expect(clientModule.getDeadlineBadgeInfo(tomorrowStr, "09:00")).toEqual({
                text: "Tomorrow",
                className: "tomorrow-badge"
            });
        });
    });

    describe("Live Input Validation & Schedule Button State", () => {
        test("starts with invalid-task-input class and switches to valid-task-input when all fields are valid", () => {
            const scheduleBtn = document.getElementById("create-task-btn");
            expect(scheduleBtn.classList.contains("invalid-task-input")).toBe(true);
            expect(scheduleBtn.classList.contains("valid-task-input")).toBe(false);

            document.getElementById("task-title-inp").value = "Finish Coursework";
            document.getElementById("task-description-inp").value = "Complete section 3";
            document.getElementById("task-priority-inp").value = "High";
            document.getElementById("task-deadline-inp").value = "2026-11-20";
            document.getElementById("task-starttime-inp").value = "13:00";
            document.getElementById("task-duration-inp").value = "2.5";
            document.getElementById("task-colour-inp").value = "#ff5500";

            document.getElementById("task-duration-inp").dispatchEvent(new Event("input"));

            expect(clientModule.getNewTaskValidation().isValid).toBe(true);
            expect(scheduleBtn.classList.contains("valid-task-input")).toBe(true);
            expect(scheduleBtn.classList.contains("invalid-task-input")).toBe(false);
        });

        test("rejects negative or non-numeric duration", () => {
            document.getElementById("task-title-inp").value = "Task";
            document.getElementById("task-description-inp").value = "Desc";
            document.getElementById("task-priority-inp").value = "Low";
            document.getElementById("task-deadline-inp").value = "2026-11-20";
            document.getElementById("task-starttime-inp").value = "10:00";
            document.getElementById("task-duration-inp").value = "-2";

            expect(clientModule.getNewTaskValidation().isValid).toBe(false);
            expect(clientModule.getNewTaskValidation().checks.duration).toBe(false);
        });
    });

    describe("Task Sorting, Editing & Filtering", () => {
        test("sorts tasks by earliest deadline + start time first, then priority, then duration", () => {
            const holder = document.getElementById("task-holder-div");

            const taskLate = clientModule.createTaskArticleElement({
                id: 1,
                title: "Later Task",
                description: "Desc",
                priority: "High",
                deadline: "2026-12-10",
                start_time: "09:00",
                duration: "1",
                colour: "#4285f4"
            });

            const taskSameDayLow = clientModule.createTaskArticleElement({
                id: 2,
                title: "Same Day Low Priority",
                description: "Desc",
                priority: "Low",
                deadline: "2026-11-05",
                start_time: "10:00",
                duration: "2",
                colour: "#4285f4"
            });

            const taskSameDayHigh = clientModule.createTaskArticleElement({
                id: 3,
                title: "Same Day High Priority",
                description: "Desc",
                priority: "High",
                deadline: "2026-11-05",
                start_time: "10:00",
                duration: "2",
                colour: "#4285f4"
            });

            holder.appendChild(taskLate);
            holder.appendChild(taskSameDayLow);
            holder.appendChild(taskSameDayHigh);

            clientModule.sortScheduledTasks();

            const titles = Array.from(holder.querySelectorAll(".task-article")).map(
                (el) => el.dataset.title
            );
            expect(titles).toEqual([
                "Same Day High Priority",
                "Same Day Low Priority",
                "Later Task"
            ]);

            const summaryBadge = document.getElementById("tasks-summary-badge");
            expect(summaryBadge.textContent).toBe("3 tasks · 5 hrs");
        });

        test("enters in-place edit mode for all 7 inputs and cancels cleanly", () => {
            const holder = document.getElementById("task-holder-div");
            const article = clientModule.createTaskArticleElement({
                id: 10,
                title: "Original Title",
                description: "Original Description",
                priority: "Medium",
                deadline: "2026-11-12",
                start_time: "14:00",
                duration: "3",
                colour: "#33b679"
            });
            holder.appendChild(article);

            clientModule.enterTaskEditMode(article);
            expect(article.classList.contains("is-editing")).toBe(true);
            expect(article.querySelectorAll(".edit-task-input")).toHaveLength(7);

            // Modify title input then cancel
            article.querySelector('[data-edit-field="title"]').value = "Changed Title";
            clientModule.cancelTaskEdits(article);

            expect(article.classList.contains("is-editing")).toBe(false);
            expect(article.dataset.title).toBe("Original Title");
        });

        test("disables Google Calendar button when setGoogleButtonConnected is called", () => {
            const googleBtn = document.getElementById("google-calendar-btn");
            clientModule.setGoogleButtonConnected();

            expect(googleBtn.classList.contains("connected")).toBe(true);
            expect(googleBtn.hasAttribute("href")).toBe(false);
            expect(googleBtn.getAttribute("aria-disabled")).toBe("true");
        });
    });
});

