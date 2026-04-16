/**
 * Attaches robust drag-and-drop functionality to the questions list.
 * Make sure your question containers have the class 'question-item' and an attribute 'data-index'.
 */

function initializeDragAndDrop() {
    const list = document.getElementById('questions-list'); // Ensure this matches your HTML ID
    if (!list) return;

    let draggedItem = null;

    // 1. Make items draggable
    const items = list.querySelectorAll('.question-item');
    items.forEach(item => {
        item.setAttribute('draggable', 'true');
        item.style.cursor = 'grab';
    });

    // 2. Handle Drag Start
    list.addEventListener('dragstart', (e) => {
        const target = e.target.closest('.question-item');
        if (target) {
            draggedItem = target;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', target.dataset.index);
            setTimeout(() => target.style.opacity = '0.5', 0);
        }
    });

    // 3. Handle Drag Over (allows dropping)
    list.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
        
        const target = e.target.closest('.question-item');
        if (target && target !== draggedItem) {
            // Determine if we should place the dragged item before or after the target
            const rect = target.getBoundingClientRect();
            const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
            list.insertBefore(draggedItem, next ? target.nextSibling : target);
        }
    });

    // 4. Handle Drop & Reorder State Array
    list.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedItem) {
            draggedItem.style.opacity = '1';
            updateStateFromDOMOrder();
        }
    });

    // 5. Cleanup on drag end
    list.addEventListener('dragend', (e) => {
        const target = e.target.closest('.question-item');
        if (target) {
            target.style.opacity = '1';
        }
        draggedItem = null;
    });

    // Helper: Rebuilds window.state.questions based on new DOM order
    function updateStateFromDOMOrder() {
        const currentItems = list.querySelectorAll('.question-item');
        const reorderedQuestions = [];
        
        currentItems.forEach(item => {
            const originalIndex = parseInt(item.getAttribute('data-index'), 10);
            reorderedQuestions.push(window.state.questions[originalIndex]);
        });

        // Update the global state
        window.state.questions = reorderedQuestions;

        // Force a re-render so indices are updated correctly
        if (typeof renderQuestions === 'function') {
            renderQuestions(); 
        }
        if (typeof updatePreview === 'function') {
            updatePreview();
        }
        // Force save
        if (typeof StorageManager !== 'undefined') {
            StorageManager.saveLocalState();
        }
    }
}

// Attach observer to re-initialize drag-and-drop whenever questions are added/removed
const observer = new MutationObserver(() => {
    initializeDragAndDrop();
});

document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('questions-list');
    if (list) {
        observer.observe(list, { childList: true });
        initializeDragAndDrop();
    }
});
