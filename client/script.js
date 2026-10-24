// Mobile bottom-sheet drawer controls for "New Task"
const openCreateTaskBtn = document.getElementById("open-create-task-btn");
const closeCreateTaskBtn = document.getElementById("close-create-task-btn");
const mobileModalBackdrop = document.getElementById("mobile-modal-backdrop");
const taskTitleInput = document.getElementById("task-title-inp");

function openMobileTaskSheet() {
    document.body.classList.add("mobile-sheet-open");
    if (taskTitleInput) {
        setTimeout(() => taskTitleInput.focus(), 200);
    }
}

function closeMobileTaskSheet() {
    document.body.classList.remove("mobile-sheet-open");
}

if (openCreateTaskBtn) {
    openCreateTaskBtn.addEventListener("click", openMobileTaskSheet);
}

if (closeCreateTaskBtn) {
    closeCreateTaskBtn.addEventListener("click", closeMobileTaskSheet);
}

if (mobileModalBackdrop) {
    mobileModalBackdrop.addEventListener("click", closeMobileTaskSheet);
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("mobile-sheet-open")) {
        closeMobileTaskSheet();
    }
});


// Editing existing tasks in-place
const taskHolderDiv = document.getElementById("task-holder-div");

function getPriorityClass(priority) {
    const normalized = (priority || "Low").toLowerCase();
    if (normalized === "high") return "high-priority";
    if (normalized === "medium") return "medium-priority";
    return "low-priority";
}

function getPriorityWeight(priority) {
    const normalized = (priority || "Low").toLowerCase();
    if (normalized === "high") return 3;
    if (normalized === "medium") return 2;
    return 1;
}

function sortScheduledTasks() {
    if (!taskHolderDiv) return;

    const articles = Array.from(taskHolderDiv.querySelectorAll(".task-article"));
    if (articles.length <= 1) return;

    articles.sort((articleA, articleB) => {
        const dataA = extractTaskData(articleA);
        const dataB = extractTaskData(articleB);

        const timeA = dataA.deadline && !Number.isNaN(Date.parse(dataA.deadline))
            ? Date.parse(dataA.deadline)
            : Number.POSITIVE_INFINITY;
        const timeB = dataB.deadline && !Number.isNaN(Date.parse(dataB.deadline))
            ? Date.parse(dataB.deadline)
            : Number.POSITIVE_INFINITY;

        // 1. Primary sort: Earliest deadline at the top
        if (timeA !== timeB) {
            return timeA - timeB;
        }

        // 2. Secondary sort: Higher priority first (High > Medium > Low)
        const priorityDiff = getPriorityWeight(dataB.priority) - getPriorityWeight(dataA.priority);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 3. Tie-breaker: Longer duration first
        return (Number(dataB.duration) || 0) - (Number(dataA.duration) || 0);
    });

    articles.forEach((article) => taskHolderDiv.appendChild(article));
}

function extractTaskData(article) {
    const infoParagraphs = article.querySelectorAll(".info-holder .task-info p");

    const title = article.dataset.title ?? (infoParagraphs[0]?.textContent.replace(/\s+/g, " ").trim() || "");
    const description = article.dataset.description ?? (infoParagraphs[1]?.textContent.replace(/\s+/g, " ").trim() || "");
    const priority = article.dataset.priority ?? (infoParagraphs[2]?.textContent.trim() || "Low");

    const rawDeadlineText = infoParagraphs[3]?.textContent.replace(/\s+/g, " ").trim() || "";
    const dateMatch = rawDeadlineText.match(/\d{4}-\d{2}-\d{2}/);
    const deadline = article.dataset.deadline ?? (dateMatch ? dateMatch[0] : "");

    const rawDurationText = infoParagraphs[4]?.textContent.replace(/\s+/g, " ").trim() || "";
    const durationMatch = rawDurationText.match(/(\d+(?:\.\d+)?)/);
    const duration = article.dataset.duration ?? (durationMatch ? durationMatch[1] : "");

    return { title, description, priority, deadline, duration };
}

function renderTaskInfoView(article, data) {
    if (data.id !== undefined) {
        article.dataset.taskId = data.id;
    }
    article.dataset.title = data.title;
    article.dataset.description = data.description;
    article.dataset.priority = data.priority;
    article.dataset.deadline = data.deadline;
    article.dataset.duration = data.duration;

    const infoCells = article.querySelectorAll(".info-holder .task-info");
    if (infoCells.length < 5) return;

    infoCells[0].innerHTML = "";
    const titleP = document.createElement("p");
    titleP.textContent = data.title || "Untitled Task";
    infoCells[0].appendChild(titleP);

    infoCells[1].innerHTML = "";
    const descP = document.createElement("p");
    descP.textContent = data.description || "No description";
    infoCells[1].appendChild(descP);

    infoCells[2].innerHTML = "";
    const priorityP = document.createElement("p");
    priorityP.className = `priority-text ${getPriorityClass(data.priority)}`;
    priorityP.textContent = data.priority;
    infoCells[2].appendChild(priorityP);

    infoCells[3].innerHTML = "";
    const deadlineP = document.createElement("p");
    deadlineP.textContent = `Due by ${data.deadline || "deadline"}`;
    infoCells[3].appendChild(deadlineP);

    infoCells[4].innerHTML = "";
    const durationP = document.createElement("p");
    durationP.textContent = `${data.duration || "..."} hours`;
    infoCells[4].appendChild(durationP);
}

function createFieldWrapper(labelText, inputElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "edit-field-wrapper";

    const label = document.createElement("span");
    label.className = "edit-field-label";
    label.textContent = labelText;

    wrapper.appendChild(label);
    wrapper.appendChild(inputElement);
    return wrapper;
}

function enterTaskEditMode(article) {
    if (article.classList.contains("is-editing")) return;

    const currentData = extractTaskData(article);
    article._originalTaskData = { ...currentData };
    article.classList.add("is-editing");

    const infoCells = article.querySelectorAll(".info-holder .task-info");
    if (infoCells.length < 5) return;

    // 1. Title input
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "edit-task-input";
    titleInput.dataset.editField = "title";
    titleInput.value = currentData.title;
    titleInput.placeholder = "Title";
    infoCells[0].innerHTML = "";
    infoCells[0].appendChild(createFieldWrapper("Title", titleInput));

    // 2. Description input
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "edit-task-input";
    descInput.dataset.editField = "description";
    descInput.value = currentData.description;
    descInput.placeholder = "Description";
    infoCells[1].innerHTML = "";
    infoCells[1].appendChild(createFieldWrapper("Description", descInput));

    // 3. Priority select
    const prioritySelect = document.createElement("select");
    prioritySelect.className = `edit-task-input edit-priority-select ${getPriorityClass(currentData.priority)}`;
    prioritySelect.dataset.editField = "priority";
    ["Low", "Medium", "High"].forEach((level) => {
        const option = document.createElement("option");
        option.value = level;
        option.textContent = level;
        if (level.toLowerCase() === currentData.priority.toLowerCase()) {
            option.selected = true;
        }
        prioritySelect.appendChild(option);
    });
    prioritySelect.addEventListener("change", () => {
        prioritySelect.className = `edit-task-input edit-priority-select ${getPriorityClass(prioritySelect.value)}`;
    });
    infoCells[2].innerHTML = "";
    infoCells[2].appendChild(createFieldWrapper("Priority", prioritySelect));

    // 4. Deadline date input
    const deadlineInput = document.createElement("input");
    deadlineInput.type = "date";
    deadlineInput.className = "edit-task-input";
    deadlineInput.dataset.editField = "deadline";
    deadlineInput.value = currentData.deadline;
    infoCells[3].innerHTML = "";
    infoCells[3].appendChild(createFieldWrapper("Deadline", deadlineInput));

    // 5. Duration input
    const durationInput = document.createElement("input");
    durationInput.type = "text";
    durationInput.inputMode = "decimal";
    durationInput.className = "edit-task-input";
    durationInput.dataset.editField = "duration";
    durationInput.value = currentData.duration;
    durationInput.placeholder = "Hrs";
    infoCells[4].innerHTML = "";
    infoCells[4].appendChild(createFieldWrapper("Duration (hrs)", durationInput));

    // Swap Edit button to Save and add Cancel button
    const editBtn = article.querySelector("#edit-task-btn, .edit-task-btn");
    if (editBtn) {
        editBtn.textContent = "Save";
        editBtn.classList.add("save-btn");

        if (!article.querySelector(".cancel-btn")) {
            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "ammend-task-btn cancel-btn";
            cancelBtn.textContent = "Cancel";
            editBtn.insertAdjacentElement("afterend", cancelBtn);
        }
    }

    titleInput.focus();
}

function exitTaskEditMode(article, dataToRender) {
    renderTaskInfoView(article, dataToRender);
    article.classList.remove("is-editing");
    delete article._originalTaskData;

    const editBtn = article.querySelector("#edit-task-btn, .edit-task-btn");
    if (editBtn) {
        editBtn.textContent = "Edit";
        editBtn.classList.remove("save-btn");
    }

    const cancelBtn = article.querySelector(".cancel-btn");
    if (cancelBtn) {
        cancelBtn.remove();
    }
}

async function updateTaskOnServer(taskId, taskData) {
    const response = await fetch(`/api/update-task/${encodeURIComponent(taskId)}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(taskData)
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to update task");
    }
    return result;
}

async function saveTaskEdits(article) {
    const titleInp = article.querySelector('[data-edit-field="title"]');
    const descInp = article.querySelector('[data-edit-field="description"]');
    const priorityInp = article.querySelector('[data-edit-field="priority"]');
    const deadlineInp = article.querySelector('[data-edit-field="deadline"]');
    const durationInp = article.querySelector('[data-edit-field="duration"]');

    const title = titleInp?.value.trim() || "";
    const description = descInp?.value.trim() || "";
    const priority = priorityInp?.value || "Low";
    const deadline = deadlineInp?.value.trim() || "";
    const duration = durationInp?.value.trim() || "";

    const isTitleValid = title.length > 0;
    const isDescValid = description.length > 0;
    const isDeadlineValid = deadline.length > 0 && !Number.isNaN(Date.parse(deadline));
    const isDurationValid = duration.length > 0 && !Number.isNaN(Number(duration)) && Number(duration) > 0;

    titleInp?.classList.toggle("field-error", !isTitleValid);
    descInp?.classList.toggle("field-error", !isDescValid);
    deadlineInp?.classList.toggle("field-error", !isDeadlineValid);
    durationInp?.classList.toggle("field-error", !isDurationValid);

    if (!isTitleValid || !isDescValid || !isDeadlineValid || !isDurationValid) {
        const saveBtn = article.querySelector(".save-btn");
        if (saveBtn) {
            saveBtn.classList.remove("shake-error");
            void saveBtn.offsetWidth;
            saveBtn.classList.add("shake-error");
        }
        return;
    }

    const updatedData = {
        title,
        description,
        priority,
        deadline,
        duration
    };

    const taskId = article.dataset.taskId;
    if (taskId) {
        try {
            await updateTaskOnServer(taskId, updatedData);
        } catch (error) {
            console.error("Error updating task on server:", error);
        }
    }

    exitTaskEditMode(article, updatedData);
    sortScheduledTasks();
}

function cancelTaskEdits(article) {
    const originalData = article._originalTaskData || extractTaskData(article);
    exitTaskEditMode(article, originalData);
}

async function deleteTaskFromServer(taskId) {
    const response = await fetch(`/api/delete-task/${encodeURIComponent(taskId)}`, {
        method: "DELETE"
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to delete task");
    }
    return result;
}

async function handleDeleteTask(article) {
    const taskId = article.dataset.taskId;
    if (taskId) {
        try {
            await deleteTaskFromServer(taskId);
        } catch (error) {
            console.error("Error deleting task on server:", error);
        }
    }
    article.remove();
}

if (taskHolderDiv) {
    taskHolderDiv.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (button) {
            const article = button.closest(".task-article");
            if (!article) return;

            if (button.id === "edit-task-btn" || button.classList.contains("edit-task-btn")) {
                if (article.classList.contains("is-editing")) {
                    saveTaskEdits(article);
                } else {
                    enterTaskEditMode(article);
                }
            } else if (button.classList.contains("cancel-btn")) {
                cancelTaskEdits(article);
            } else if (button.id === "delete-task-btn" || button.classList.contains("delete")) {
                handleDeleteTask(article);
            }
            return;
        }

        // Toggle expand/collapse when clicking on a task's info-holder (outside of edit mode)
        const infoHolder = event.target.closest(".info-holder");
        if (infoHolder) {
            const article = infoHolder.closest(".task-article");
            if (!article || article.classList.contains("is-editing")) return;

            // Avoid collapsing if the user is highlighting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) return;

            article.classList.toggle("is-expanded");
        }
    });

    taskHolderDiv.addEventListener("keydown", (event) => {
        const article = event.target.closest(".task-article.is-editing");
        if (!article) return;

        if (event.key === "Enter") {
            event.preventDefault();
            saveTaskEdits(article);
        } else if (event.key === "Escape") {
            event.preventDefault();
            cancelTaskEdits(article);
        }
    });
}


// Creating new tasks & live input validation
const new_task_title_input = document.getElementById("task-title-inp");
const new_task_description_input = document.getElementById("task-description-inp");
const new_task_priority_input = document.getElementById("task-priority-inp");
const new_task_deadline_input = document.getElementById("task-deadline-inp");
const new_task_duration_input = document.getElementById("task-duration-inp");
const create_task_btn = document.getElementById("create-task-btn");

const newTaskInputs = [
    new_task_title_input,
    new_task_description_input,
    new_task_priority_input,
    new_task_deadline_input,
    new_task_duration_input
].filter(Boolean);

function getNewTaskValidation() {
    const title = new_task_title_input?.value.trim() || "";
    const description = new_task_description_input?.value.trim() || "";
    const priority = new_task_priority_input?.value || "";
    const deadline = new_task_deadline_input?.value.trim() || "";
    const duration = new_task_duration_input?.value.trim() || "";

    const validTitle = title.length > 0;
    const validDescription = description.length > 0;
    const validPriority = ["Low", "Medium", "High"].includes(priority);
    const validDeadline = deadline.length > 0 && !Number.isNaN(Date.parse(deadline));
    const durationNum = Number(duration);
    const validDuration = duration.length > 0 && !Number.isNaN(durationNum) && durationNum > 0;

    return {
        isValid: validTitle && validDescription && validPriority && validDeadline && validDuration,
        checks: {
            title: validTitle,
            description: validDescription,
            priority: validPriority,
            deadline: validDeadline,
            duration: validDuration
        },
        values: {
            title,
            description,
            priority,
            deadline,
            duration
        }
    };
}

function updateScheduleButtonState() {
    if (!create_task_btn) return;
    const { isValid } = getNewTaskValidation();

    create_task_btn.classList.toggle("valid-task-input", isValid);
    create_task_btn.classList.toggle("invalid-task-input", !isValid);
}

newTaskInputs.forEach((inputEl) => {
    const onFieldChange = () => {
        inputEl.classList.remove("field-error");
        updateScheduleButtonState();
    };
    inputEl.addEventListener("input", onFieldChange);
    inputEl.addEventListener("change", onFieldChange);

    inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handleCreateTask();
        }
    });
});

function createTaskArticleElement(data) {
    const article = document.createElement("article");
    article.className = "task-article";

    const infoHolder = document.createElement("div");
    infoHolder.className = "info-holder";

    for (let i = 0; i < 5; i++) {
        const taskInfo = document.createElement("div");
        taskInfo.className = i >= 2 ? "task-info short-info" : "task-info";
        infoHolder.appendChild(taskInfo);
    }

    const buttonHolder = document.createElement("div");
    buttonHolder.className = "button-holder";

    const editBtn = document.createElement("button");
    editBtn.id = "edit-task-btn";
    editBtn.className = "ammend-task-btn";
    editBtn.textContent = "Edit";

    const deleteBtn = document.createElement("button");
    deleteBtn.id = "delete-task-btn";
    deleteBtn.className = "ammend-task-btn delete";
    deleteBtn.textContent = "Delete";

    buttonHolder.appendChild(editBtn);
    buttonHolder.appendChild(deleteBtn);

    article.appendChild(infoHolder);
    article.appendChild(buttonHolder);

    renderTaskInfoView(article, data);
    return article;
}

async function saveTaskToServer(taskData) {
    const response = await fetch("/api/save-task", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(taskData)
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || "Failed to save task");
    }
    return result;
}

async function loadTasksFromServer() {
    if (!taskHolderDiv) return;

    try {
        const response = await fetch("/api/get-tasks");
        if (!response.ok) {
            throw new Error("Failed to fetch tasks");
        }

        const tasks = await response.json();
        if (!Array.isArray(tasks)) return;

        // Remove existing task articles before rendering fetched tasks
        taskHolderDiv.querySelectorAll(".task-article").forEach((el) => el.remove());

        tasks.forEach((task) => {
            const article = createTaskArticleElement({
                id: task.id,
                title: task.title || "",
                description: task.description || "",
                priority: task.priority || "Low",
                deadline: task.deadline || "",
                duration: task.duration || ""
            });
            taskHolderDiv.appendChild(article);
        });

        sortScheduledTasks();
    } catch (error) {
        console.error("Error loading tasks from server:", error);
    }
}

async function handleCreateTask() {
    const { isValid, checks, values } = getNewTaskValidation();

    if (!isValid) {
        new_task_title_input?.classList.toggle("field-error", !checks.title);
        new_task_description_input?.classList.toggle("field-error", !checks.description);
        new_task_priority_input?.classList.toggle("field-error", !checks.priority);
        new_task_deadline_input?.classList.toggle("field-error", !checks.deadline);
        new_task_duration_input?.classList.toggle("field-error", !checks.duration);

        if (create_task_btn) {
            create_task_btn.classList.remove("shake-error");
            void create_task_btn.offsetWidth;
            create_task_btn.classList.add("shake-error");
        }
        return;
    }

    let createdTaskId;
    try {
        const result = await saveTaskToServer(values);
        createdTaskId = result.taskId;
    } catch (error) {
        console.error("Error saving task to server:", error);
    }

    if (taskHolderDiv) {
        const newArticle = createTaskArticleElement({
            ...values,
            id: createdTaskId
        });
        taskHolderDiv.appendChild(newArticle);
        sortScheduledTasks();
    }

    // Clear form inputs after scheduling
    if (new_task_title_input) new_task_title_input.value = "";
    if (new_task_description_input) new_task_description_input.value = "";
    if (new_task_priority_input) new_task_priority_input.value = "Low";
    if (new_task_deadline_input) new_task_deadline_input.value = "";
    if (new_task_duration_input) new_task_duration_input.value = "";

    newTaskInputs.forEach((inputEl) => inputEl.classList.remove("field-error"));
    updateScheduleButtonState();
    closeMobileTaskSheet();
}

if (create_task_btn) {
    create_task_btn.addEventListener("click", handleCreateTask);
}

// Initialize Schedule button validation colour and load saved tasks from server
updateScheduleButtonState();
loadTasksFromServer();

// Google Calendar connection status check
const googleCalendarBtn = document.getElementById("google-calendar-btn");

function setGoogleButtonConnected() {
    if (!googleCalendarBtn) return;
    googleCalendarBtn.classList.add("connected");
    googleCalendarBtn.textContent = "Google Calendar Connected";
    googleCalendarBtn.removeAttribute("href");
    googleCalendarBtn.setAttribute("aria-disabled", "true");
}

if (googleCalendarBtn) {
    googleCalendarBtn.addEventListener("click", (event) => {
        if (googleCalendarBtn.classList.contains("connected")) {
            event.preventDefault();
        }
    });
}

async function checkGoogleConnectionStatus() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("google") === "connected") {
        setGoogleButtonConnected();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    try {
        const response = await fetch("/api/auth/google/status");
        if (!response.ok) return;
        const data = await response.json();
        if (data.connected) {
            setGoogleButtonConnected();
        }
    } catch (error) {
        console.error("Error checking Google Calendar connection status:", error);
    }
}

checkGoogleConnectionStatus();


