/**
 * UI Actions Handler
 * Provides functions for invoking module actions from the frontend
 */

/**
 * Invoke an action from a UI module
 * @param {string} moduleId - The module identifier
 * @param {string} actionId - The action identifier
 * @param {HTMLElement} [buttonElement] - Optional button element to show loading state
 * @returns {Promise<{success: boolean, message?: string, data?: any}>}
 */
async function invokeAction(moduleId, actionId, buttonElement) {
  // Show loading state if button provided
  let originalContent = null;
  if (buttonElement) {
    originalContent = buttonElement.innerHTML;
    buttonElement.innerHTML = "...";
    buttonElement.disabled = true;
  }

  try {
    const response = await fetch(`/api/actions/${moduleId}/${actionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();

    // Show result feedback
    if (result.success) {
      showNotification(result.message || "Action completed successfully", "success");
    } else {
      showNotification(result.message || "Action failed", "error");
    }

    return result;
  } catch (error) {
    console.error("Action invocation failed:", error);
    showNotification("Failed to invoke action: " + error.message, "error");
    return { success: false, message: error.message };
  } finally {
    // Restore button state
    if (buttonElement && originalContent !== null) {
      buttonElement.innerHTML = originalContent;
      buttonElement.disabled = false;
    }
  }
}

/**
 * Show a notification message using NES.css styling
 * @param {string} message - The message to display
 * @param {string} type - 'success' or 'error'
 */
function showNotification(message, type) {
  // Remove any existing notification
  const existing = document.getElementById("action-notification");
  if (existing) {
    existing.remove();
  }

  // Create notification element
  const notification = document.createElement("div");
  notification.id = "action-notification";
  notification.className = `nes-container ${type === "success" ? "is-success" : "is-error"}`;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.innerHTML = `
    <p style="margin: 0; font-size: 12px;">${message}</p>
  `;

  document.body.appendChild(notification);

  // Play click sound for feedback
  if (typeof clickButton === "function") {
    clickButton();
  }

  // Auto-remove after 4 seconds
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// Add CSS animation styles
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(styleSheet);
