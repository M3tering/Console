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
    buttonElement.textContent = "Working…";
    buttonElement.disabled = true;
    buttonElement.setAttribute('aria-busy', 'true');
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
      buttonElement.removeAttribute('aria-busy');
    }
  }
}

// Shared themed feedback for built-in applications and extensions.
let notificationTimer;
function showNotification(message, type) {
  const area = document.getElementById('notification-area');
  if (!area) return;
  clearTimeout(notificationTimer);
  const notification = document.createElement('div');
  notification.className = 'notification ' + (type === 'error' ? 'error' : 'success');
  notification.textContent = message;
  area.replaceChildren(notification);
  notificationTimer = setTimeout(() => notification.remove(), 6000);
}
