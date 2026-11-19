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
  // Capture ownership before awaiting: switching apps must not redirect feedback.
  const owner = buttonElement?.closest('.app-window') || document.getElementById(moduleId)?.closest('.app-window') || null;
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
      showNotification(result.message || "Action completed successfully", "success", owner);
    } else {
      showNotification(result.message || "Action failed", "error", owner);
    }

    return result;
  } catch (error) {
    console.error("Action invocation failed:", error);
    showNotification("Failed to invoke action: " + error.message, "error", owner);
    return { success: false, message: error.message };
  } finally {
    // Restore button state
    if (buttonElement && originalContent !== null) {
      buttonElement.innerHTML = originalContent;
      buttonElement.disabled = false;
      buttonElement.removeAttribute('aria-busy');
    }
    // Let the app refresh what it shows (and re-disable the button if nothing is left).
    document.dispatchEvent(new CustomEvent('app:action', { detail: { moduleId, actionId } }));
  }
}

// Extensions can pass their app element or app ID as the third argument.
// Pass null explicitly for a desktop-wide notification.
function showNotification(message, type, owner) {
  AppFeedback.notify(message, type, owner);
}
