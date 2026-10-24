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

