/**
 * EMA Studio - Project Storage & Management
 * Handles Auto-saving, Importing, Exporting, and Resetting the studio state.
 */

const StorageManager = {
    STORAGE_KEY: 'ema_studio_project_state',

    init() {
        this.injectUI();
        this.loadLocalState();
        
        // Auto-save every 5 seconds if changes occurred, or hook this directly into your updatePreview() function
        setInterval(() => this.saveLocalState(), 5000);
    },

    injectUI() {
        // Create the control container
        const controls = document.createElement('div');
        controls.className = 'project-controls';
        controls.style.cssText = 'display: flex; gap: 10px; padding: 10px; background: #f8f9fa; border-bottom: 1px solid #ddd; justify-content: flex-end; align-items: center;';

        controls.innerHTML = `
            <span style="margin-right: auto; font-size: 14px; color: #666;" id="save-status">Status: Up to date</span>
            <input type="file" id="import-file" accept=".json" style="display: none;">
            <button id="btn-import" style="padding: 5px 10px; cursor: pointer;">📂 Import Project</button>
            <button id="btn-export" style="padding: 5px 10px; cursor: pointer;">💾 Export Project</button>
            <button id="btn-reset" style="padding: 5px 10px; cursor: pointer; background: #dc3545; color: white; border: none; border-radius: 4px;">⚠️ Reset</button>
        `;

        // Prepend to body or a specific header if you have one
        document.body.insertBefore(controls, document.body.firstChild);

        // Event Listeners
        document.getElementById('btn-export').addEventListener('click', () => this.exportProject());
        document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
        document.getElementById('import-file').addEventListener('change', (e) => this.importProject(e));
        document.getElementById('btn-reset').addEventListener('click', () => this.resetProject());
    },

    saveLocalState() {
        if (!window.state) return;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(window.state));
        
        const status = document.getElementById('save-status');
        if (status) {
            status.textContent = `Status: Auto-saved at ${new Date().toLocaleTimeString()}`;
        }
    },

    loadLocalState() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try {
                const parsedState = JSON.parse(saved);
                // Confirm with user if they want to load the saved state
                if (confirm("We found an unsaved session from a previous visit. Would you like to restore it?")) {
                    window.state = parsedState;
                    this.triggerUIRefresh();
                } else {
                    this.saveLocalState(); // Overwrite with current default state
                }
            } catch (e) {
                console.error("Failed to parse saved state", e);
            }
        }
    },

    exportProject() {
        if (!window.state) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.state, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "ema_project_backup.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    importProject(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedState = JSON.parse(e.target.result);
                window.state = importedState;
                this.saveLocalState();
                this.triggerUIRefresh();
                alert("Project imported successfully!");
            } catch (error) {
                alert("Error parsing JSON file. Please ensure it is a valid EMA Studio backup.");
            }
        };
        reader.readAsText(file);
        // Reset input
        event.target.value = '';
    },

    resetProject() {
        if (confirm("Are you sure you want to completely restart? All unsaved progress will be lost.")) {
            localStorage.removeItem(this.STORAGE_KEY);
            location.reload(); // Reloading the page will reset window.state to defaults
        }
    },

    triggerUIRefresh() {
        // This simulates a full refresh of the builder UI.
        // It looks for standard functions you might have in your tabs.
        if (typeof renderQuestions === 'function') renderQuestions();
        if (typeof updatePreview === 'function') updatePreview();
        
        // If you have functions that populate inputs based on state, call them here
        // e.g., loadStateIntoStudyTab(), loadStateIntoScheduleTab()
        alert("State loaded! (You may need to click through the tabs to see visual updates depending on your render logic).");
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    StorageManager.init();
});
